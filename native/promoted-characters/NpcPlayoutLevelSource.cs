using System;
using System.Runtime.CompilerServices;
using LosSantosAlive.Audio;
using Rage;
namespace LSA.PromotedCharacters {
    // Read-only view of the level Essential's OWN playback class reports for a ped.
    // Essential owns the single audio pipeline (NpcSpatialAudio, the NAudio provider
    // that renders every provider's PCM: OpenAI, ElevenLabs and local TTS all reach it
    // through QueueTaggedAudioChunk). This type only calls its public, side-effect-free
    // getters; it never queues, plays, mutes, pans or changes gain.
    internal interface IPlayoutLevelSource {
        bool Available { get; }
        // false: no trustworthy reading this tick (callers must treat it as silence,
        // never as an estimate). level is Essential's per-ped 0..1 level; audible is
        // Essential's "sound is currently audible for this ped" flag; turnBuffered is
        // Essential's exact-turn buffer probe (diagnostic only, see docs).
        bool TryRead(Ped ped, string pedId, string turnId, long generation,
            out float level, out bool audible, out bool turnBuffered);
    }

    internal sealed class EssentialPlayoutLevelSource : IPlayoutLevelSource {
        bool failed;
        public bool Available => !failed;
        public bool TryRead(Ped ped, string pedId, string turnId, long generation,
            out float level, out bool audible, out bool turnBuffered) {
            level = 0f; audible = false; turnBuffered = false;
            if (failed || ped == null) return false;
            try { return Read(ped, pedId, turnId, generation, out level, out audible, out turnBuffered); }
            catch {
                // Missing/changed Essential member (MissingMethodException, TypeLoad)
                // or any runtime fault: stop reading for this run. The mouth stays
                // closed and speech is unaffected; nothing is estimated in its place.
                failed = true; level = 0f; audible = false; turnBuffered = false;
                try { Game.LogTrivial("[VP] playout_level=unavailable mouth=closed"); } catch { }
                return false;
            }
        }
        // Kept in its own non-inlined method so a missing Essential member throws
        // here, inside TryRead's try block, instead of while JIT-compiling the caller.
        [MethodImpl(MethodImplOptions.NoInlining)]
        static bool Read(Ped ped, string pedId, string turnId, long generation,
            out float level, out bool audible, out bool turnBuffered) {
            audible = NpcSpatialAudio.IsAudibleAudioPlaying(ped);
            float rms = NpcSpatialAudio.GetLastChunkRms(ped);
            turnBuffered = NpcSpatialAudio.HasBufferedAudioForTurn(pedId, turnId, generation);
            level = 0f;
            if (float.IsNaN(rms) || float.IsInfinity(rms) || rms < 0f) return false;
            level = audible ? (rms > 1f ? 1f : rms) : 0f;
            return true;
        }
    }
}
