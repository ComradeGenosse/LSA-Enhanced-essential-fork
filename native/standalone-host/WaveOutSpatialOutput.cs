using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using LSA.Standalone;
using Rage;

namespace LSA.Standalone.RageHost
{
    // Deliberately bounded first S3 device backend: Windows waveOut PCM, one
    // independent stereo voice/device handle per native-authorized actor.
    // This is positional distance/panning, NOT GTA mixer integration,
    // occlusion, HRTF, radio ducking, vehicle-cabin acoustics or proved hearing.
    internal sealed class WaveOutSpatialOutput : IPhysicalAudioOutput, IDisposable
    {
        internal sealed class SpatialMix
        {
            internal readonly double Left, Right;
            internal SpatialMix(double left, double right)
            { Left = Math.Max(0, Math.Min(1, left)); Right = Math.Max(0, Math.Min(1, right)); }
        }
        private sealed class Buffer
        {
            internal IntPtr Samples, Header;
            internal int SourceLength;
        }
        private sealed class Voice
        {
            internal OwnershipLease Lease;
            internal IntPtr Device;
            internal readonly List<Buffer> Buffers = new List<Buffer>();
            internal readonly List<byte> Envelope = new List<byte>(); // 20ms windows
            internal int Submitted, Played;
            internal long WindowEnergy;
            internal int WindowSamples;
            internal bool Sealed, Failed;
            internal int EndBytes;
        }

        private const int Rate = 24000, SourceBytesPerSecond = Rate * 2;
        private const int MaxDevicePending = SourceBytesPerSecond; // 1s per actor
        private const int MMSYSERR_NOERROR = 0, WAVERR_STILLPLAYING = 33;
        private const uint TIME_MS = 1, TIME_SAMPLES = 2, TIME_BYTES = 4;
        private const ushort WAVE_FORMAT_PCM = 1;
        private const uint WHDR_DONE = 1;
        private readonly NativeAuthority authority;
        private readonly IOwnerContext owner;
        private readonly Dictionary<Guid, Voice> voices = new Dictionary<Guid, Voice>();
        private readonly Func<ActorRef, SpatialMix> sampleSpatial;
        private bool disposed;

        [StructLayout(LayoutKind.Sequential)]
        private struct WaveFormat
        {
            public ushort FormatTag, Channels;
            public uint SamplesPerSec, AvgBytesPerSec;
            public ushort BlockAlign, BitsPerSample, ExtraSize;
        }
        [StructLayout(LayoutKind.Sequential)]
        private struct WaveHeader
        {
            public IntPtr Data;
            public uint Length, BytesRecorded;
            public IntPtr User;
            public uint Flags, Loops;
            public IntPtr Next, Reserved;
        }
        [StructLayout(LayoutKind.Sequential)]
        private struct MmTime
        {
            public uint Type, Value, Reserved;
        }
        [DllImport("winmm.dll", ExactSpelling = true)]
        private static extern int waveOutOpen(out IntPtr device, uint id,
            ref WaveFormat format, IntPtr callback, IntPtr instance, uint flags);
        [DllImport("winmm.dll", ExactSpelling = true)]
        private static extern int waveOutPrepareHeader(IntPtr device, IntPtr header, uint size);
        [DllImport("winmm.dll", ExactSpelling = true)]
        private static extern int waveOutWrite(IntPtr device, IntPtr header, uint size);
        [DllImport("winmm.dll", ExactSpelling = true)]
        private static extern int waveOutUnprepareHeader(IntPtr device, IntPtr header, uint size);
        [DllImport("winmm.dll", ExactSpelling = true)]
        private static extern int waveOutGetPosition(IntPtr device, ref MmTime time, uint size);
        [DllImport("winmm.dll", ExactSpelling = true)]
        private static extern int waveOutReset(IntPtr device);
        [DllImport("winmm.dll", ExactSpelling = true)]
        private static extern int waveOutClose(IntPtr device);

        internal WaveOutSpatialOutput(NativeAuthority authority, IOwnerContext owner,
            Func<ActorRef, SpatialMix> sampleSpatial)
        {
            this.authority = authority ?? throw new ArgumentNullException(nameof(authority));
            this.owner = owner ?? throw new ArgumentNullException(nameof(owner));
            this.sampleSpatial = sampleSpatial ?? throw new ArgumentNullException(nameof(sampleSpatial));
        }
        private bool Valid(OwnershipLease lease)
        {
            return !disposed && owner.IsOwner && lease != null &&
                lease.Kind == LeaseKind.Audio && authority.IsLeaseCurrent(lease);
        }
        public bool TryBegin(OwnershipLease lease, Guid id, int sampleRate, out string rejection)
        {
            rejection = "device_not_authorized";
            if (!Valid(lease) || sampleRate != Rate || id == Guid.Empty ||
                voices.ContainsKey(id) || voices.Count >= NativeAudioRegistry.MaxStreams) return false;
            rejection = "spatial_unavailable";
            try { if (sampleSpatial(lease.Actor) == null) return false; }
            catch { return false; }
            var fmt = new WaveFormat {
                FormatTag = WAVE_FORMAT_PCM, Channels = 2, SamplesPerSec = Rate,
                AvgBytesPerSec = Rate * 4, BlockAlign = 4, BitsPerSample = 16
            };
            IntPtr device;
            rejection = "device_open_failed";
            if (waveOutOpen(out device, unchecked((uint)-1), ref fmt,
                IntPtr.Zero, IntPtr.Zero, 0) != MMSYSERR_NOERROR) return false;
            voices.Add(id, new Voice { Device = device, Lease = lease });
            rejection = "device_opened_not_played";
            return true;
        }
        public bool TryPush(OwnershipLease lease, Guid id, byte[] pcm, out string rejection)
        {
            rejection = "device_not_authorized";
            Voice v;
            if (!Valid(lease) || !voices.TryGetValue(id, out v) ||
                !v.Lease.SameClaim(lease) || v.Sealed || v.Failed) return false;
            rejection = "bad_pcm";
            if (pcm == null || pcm.Length < 2 || pcm.Length % 2 != 0 ||
                pcm.Length > NativeAudioRegistry.MaxChunkBytes) return false;
            // Query device position before deciding credits. No invented progress.
            if (!Refresh(v)) { rejection = "device_progress_failed"; return false; }
            rejection = "device_backpressure";
            if (v.Submitted - v.Played > MaxDevicePending - pcm.Length) return false;
            SpatialMix mix;
            rejection = "spatial_unavailable";
            try { mix = sampleSpatial(lease.Actor); }
            catch { return false; }
            if (mix == null) return false;
            byte[] stereo = new byte[pcm.Length * 2];
            for (int i = 0; i < pcm.Length; i += 2)
            {
                short sample = (short)(pcm[i] | (pcm[i + 1] << 8));
                short left = (short)Math.Max(short.MinValue,
                    Math.Min(short.MaxValue, Math.Round(sample * mix.Left)));
                short right = (short)Math.Max(short.MinValue,
                    Math.Min(short.MaxValue, Math.Round(sample * mix.Right)));
                int dest = i * 2;
                stereo[dest] = (byte)left; stereo[dest + 1] = (byte)(left >> 8);
                stereo[dest + 2] = (byte)right; stereo[dest + 3] = (byte)(right >> 8);
            }
            var b = new Buffer { SourceLength = pcm.Length };
            try
            {
                b.Samples = Marshal.AllocHGlobal(stereo.Length);
                Marshal.Copy(stereo, 0, b.Samples, stereo.Length);
                var hdr = new WaveHeader { Data = b.Samples, Length = (uint)stereo.Length };
                b.Header = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(WaveHeader)));
                Marshal.StructureToPtr(hdr, b.Header, false);
                uint size = (uint)Marshal.SizeOf(typeof(WaveHeader));
                if (waveOutPrepareHeader(v.Device, b.Header, size) != MMSYSERR_NOERROR)
                    throw new InvalidOperationException("prepare_failed");
                v.Buffers.Add(b); // cleanup owns the prepared header from here
                if (waveOutWrite(v.Device, b.Header, size) != MMSYSERR_NOERROR)
                    throw new InvalidOperationException("write_failed");
                v.Submitted += pcm.Length;
                // The lip envelope comes from source PCM accepted by this
                // exact device, and is indexed by driver-played sample count.
                // Do NOT multiply by listener attenuation: a talking NPC
                // keeps moving its mouth even when the player stands far away.
                // Network/TTS availability alone never advances this clock.
                for (int j = 0; j + 1 < pcm.Length; j += 2)
                {
                    short sample = (short)(pcm[j] | (pcm[j + 1] << 8));
                    v.WindowEnergy += Math.Abs((int)sample);
                    v.WindowSamples++;
                    if (v.WindowSamples == 480) // 20ms at 24k mono
                    {
                        v.Envelope.Add((byte)Math.Min(100,
                            v.WindowEnergy * 100 / (v.WindowSamples * 16384L)));
                        v.WindowEnergy = 0;
                        v.WindowSamples = 0;
                    }
                }
                rejection = "device_buffer_accepted_not_played";
                return true;
            }
            catch
            {
                // A partially prepared/written WAVEHDR is never retried. Fence the
                // stream; owner will cancel it, reset and release all buffers.
                v.Failed = true;
                rejection = "device_write_failed";
                if (!v.Buffers.Contains(b))
                { if (b.Header != IntPtr.Zero) Marshal.FreeHGlobal(b.Header);
                  if (b.Samples != IntPtr.Zero) Marshal.FreeHGlobal(b.Samples); }
                return false;
            }
        }
        public bool TrySeal(OwnershipLease lease, Guid id, int sourceBytes, out string rejection)
        {
            rejection = "device_not_authorized";
            Voice v;
            if (!Valid(lease) || !voices.TryGetValue(id, out v) ||
                !v.Lease.SameClaim(lease) || v.Failed || v.Sealed ||
                sourceBytes < 2 || sourceBytes != v.Submitted) return false;
            v.Sealed = true;
            v.EndBytes = sourceBytes;
            if (v.WindowSamples > 0)
            {
                v.Envelope.Add((byte)Math.Min(100,
                    v.WindowEnergy * 100 / (v.WindowSamples * 16384L)));
                v.WindowSamples = 0; v.WindowEnergy = 0;
            }
            rejection = "awaiting_device_playback";
            return true;
        }
        public bool TryRead(OwnershipLease lease, Guid id, out AudioPlaybackSnapshot snapshot)
        {
            snapshot = null;
            Voice v;
            if (!Valid(lease) || !voices.TryGetValue(id, out v) ||
                !v.Lease.SameClaim(lease)) return false;
            if (!Refresh(v)) v.Failed = true;
            bool completed = v.Sealed && !v.Failed &&
                v.Played == v.EndBytes && v.Buffers.Count == 0;
            int index = v.Played <= 0 ? -1 : (v.Played - 1) / 960;
            int mouth = index >= 0 && index < v.Envelope.Count ? v.Envelope[index] : 0;
            snapshot = new AudioPlaybackSnapshot(
                v.Failed ? "failed" : completed ? "playback_completed" :
                v.Played > 0 ? "playback_started" :
                v.Submitted > 0 ? "device_accepted" : "authorized",
                v.Played, v.Submitted, completed ? 0 : mouth);
            return true;
        }
        private static bool Refresh(Voice v)
        {
            if (v.Failed) return false;
            // Microsoft recommends TIME_SAMPLES; WinMM drivers may return
            // a different supported MMTIME format. Never misinterpret bytes
            // (stereo device) as samples (per channel).
            var time = new MmTime { Type = TIME_SAMPLES };
            uint timeSize = (uint)Marshal.SizeOf(typeof(MmTime));
            if (waveOutGetPosition(v.Device, ref time, timeSize) != MMSYSERR_NOERROR)
                return false;
            long sourceBytes;
            if (time.Type == TIME_SAMPLES)
                sourceBytes = (long)time.Value * 2L; // mono 16-bit source
            else if (time.Type == TIME_BYTES)
                sourceBytes = (long)(time.Value / 4) * 2L; // stereo 16-bit device
            else if (time.Type == TIME_MS)
                sourceBytes = (long)time.Value * Rate * 2L / 1000L;
            else return false; // unsupported output position representation
            int reported = (int)Math.Min(v.Submitted, sourceBytes);
            if (reported < v.Played) return false; // regression/device reset
            v.Played = reported;
            uint headerSize = (uint)Marshal.SizeOf(typeof(WaveHeader));
            for (int i = v.Buffers.Count - 1; i >= 0; i--)
            {
                var b = v.Buffers[i];
                var hdr = (WaveHeader)Marshal.PtrToStructure(b.Header, typeof(WaveHeader));
                if ((hdr.Flags & WHDR_DONE) == 0) continue;
                int code = waveOutUnprepareHeader(v.Device, b.Header, headerSize);
                if (code == WAVERR_STILLPLAYING) continue;
                if (code != MMSYSERR_NOERROR) return false;
                Marshal.FreeHGlobal(b.Header);
                Marshal.FreeHGlobal(b.Samples);
                v.Buffers.RemoveAt(i);
            }
            return true;
        }
        public bool TryStop(Guid id, string reason)
        {
            Voice v;
            if (!owner.IsOwner || !voices.TryGetValue(id, out v)) return false;
            voices.Remove(id);
            waveOutReset(v.Device);
            uint size = (uint)Marshal.SizeOf(typeof(WaveHeader));
            foreach (var b in v.Buffers)
            {
                // Reset is synchronous and returns all queued buffers.
                waveOutUnprepareHeader(v.Device, b.Header, size);
                Marshal.FreeHGlobal(b.Header);
                Marshal.FreeHGlobal(b.Samples);
            }
            v.Buffers.Clear();
            waveOutClose(v.Device);
            return true;
        }
        public void Dispose()
        {
            if (disposed) return;
            if (!owner.IsOwner) throw new InvalidOperationException("owner_required");
            foreach (var id in new List<Guid>(voices.Keys)) TryStop(id, "shutdown");
            disposed = true;
        }
    }

    internal sealed class RageSpatialAudioSource
    {
        private readonly IOwnerContext owner;
        private readonly RageActorResolver resolver;
        internal RageSpatialAudioSource(IOwnerContext owner, RageActorResolver resolver)
        { this.owner = owner; this.resolver = resolver; }

        internal WaveOutSpatialOutput.SpatialMix Sample(ActorRef actor)
        {
            if (!owner.IsOwner || actor == null) return null;
            ActorObservation observed;
            if (!resolver.TryObserve(actor.Handle, out observed) ||
                observed.Address != actor.Address) return null;
            Ped ped = World.GetEntityByHandle<Ped>(
                new PoolHandle(unchecked((uint)actor.Handle)));
            Ped player = Game.LocalPlayer.Character;
            if (ped == null || !RphPedValidity.Exists(ped) || player == null || !RphPedValidity.Exists(player)) return null;
            Vector3 diff = ped.Position - player.Position;
            double distance = Math.Sqrt(diff.X * diff.X + diff.Y * diff.Y + diff.Z * diff.Z);
            if (double.IsNaN(distance) || double.IsInfinity(distance)) return null;
            // Lightweight stereo positional approximation. Not a GTA 3D audio bus.
            double radius = 55.0;
            double gain = Math.Max(0.0, 1.0 - distance / radius);
            gain = Math.Min(0.85, gain * gain);
            Vector3 right = player.RightVector;
            double pan = distance < 0.1 ? 0 :
                Math.Max(-1, Math.Min(1,
                    (diff.X * right.X + diff.Y * right.Y) /
                    Math.Max(0.1, Math.Sqrt(diff.X * diff.X + diff.Y * diff.Y))));
            double l = gain * Math.Sqrt((1 - pan) / 2);
            double r = gain * Math.Sqrt((1 + pan) / 2);
            return new WaveOutSpatialOutput.SpatialMix(l, r);
        }
    }
}
