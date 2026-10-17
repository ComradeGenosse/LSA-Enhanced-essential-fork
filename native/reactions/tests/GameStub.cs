using System;
using System.Collections.Generic;

// Minimal offline stand-ins for exactly the RAGE / Essential surface the
// reaction executor touches. Member names are checked against the pinned
// LosSantosAlive.dll metadata in docs/plans/npc-gestures-findings.md; RAGE
// behavior itself is NOT simulated beyond what each test scripts.
namespace Rage
{
    public class Ped
    {
        public uint Handle;
        public IntPtr MemoryAddress = new IntPtr(0x1000);
        public bool Alive = true, IsDead, IsMale = true;
        public bool Exists() => Alive;
        // RAGE may hand out different wrappers for one entity: equal handles are the same ped.
        public override bool Equals(object obj) => obj is Ped other && other.Handle == Handle;
        public override int GetHashCode() => (int)Handle;
    }
    public class Player { public Ped Character = new Ped { Handle = 1 }; }
    public static class Game
    {
        public static Player LocalPlayer = new Player();
        public static void LogTrivial(string text) { }
    }
}

namespace Rage.Native
{
    public sealed class NativeArgument
    {
        internal object Value;
        NativeArgument(object value) { Value = value; }
        public static implicit operator NativeArgument(string v) => new NativeArgument(v);
        public static implicit operator NativeArgument(Rage.Ped v) => new NativeArgument(v);
        public static implicit operator NativeArgument(int v) => new NativeArgument(v);
        public static implicit operator NativeArgument(float v) => new NativeArgument(v);
        public static implicit operator NativeArgument(bool v) => new NativeArgument(v);
    }
    public static class NativeFunction
    {
        public static readonly List<string> Calls = new List<string>();
        public static readonly List<object[]> Args = new List<object[]>();
        public static Func<string, object[], object> Script = (name, args) => null;
        public static T CallByName<T>(string name, params NativeArgument[] nativeArgs) where T : struct
        {
            var args = Array.ConvertAll(nativeArgs, a => a.Value);
            Calls.Add(name); Args.Add(args);
            var value = Script(name, args);
            if (value == null) return default(T);
            return (T)Convert.ChangeType(value, typeof(T));
        }
        public static void Reset() { Calls.Clear(); Args.Clear(); Script = (n, a) => null; }
    }
}

namespace LosSantosAlive.Audio
{
    public class NpcPlaybackStartedEvent { public Rage.Ped SpeakerPed; public string PedId, TurnId; public long GenerationId; }
    public class NpcPlaybackEndedEvent
    {
        public Rage.Ped SpeakerPed; public string PedId, TurnId, Reason; public long GenerationId;
        public bool WasInterrupted, HadAudio, PlaybackStarted;
    }
    public static class NpcPlaybackCoordinator
    {
        public static event Action<NpcPlaybackStartedEvent> PlaybackStarted;
        public static event Action<NpcPlaybackEndedEvent> PlaybackEnded;
        public static void RaiseStarted(NpcPlaybackStartedEvent e) => PlaybackStarted?.Invoke(e);
        public static void RaiseEnded(NpcPlaybackEndedEvent e) => PlaybackEnded?.Invoke(e);
        public static int Subscribers => (PlaybackStarted?.GetInvocationList().Length ?? 0) + (PlaybackEnded?.GetInvocationList().Length ?? 0);
    }
}

namespace LosSantosAlive.NPC.Items
{
    public class NpcHeldItemState { public bool IsHoldingItem { get; set; } }
}

namespace LosSantosAlive.NPC
{
    public class NpcState
    {
        public bool InDirectedInteraction, HasActiveReflex, HandsUpMode, WantsHandsUp, KneelMode, SitOnGroundMode,
            AttackPlayer, FleePlayer, TakeCoverMode, IntimidatePlayerWithWeapon, ActivityInProgress,
            FollowPlayerOnFoot, FollowPaused, StopAndFaceTargetMode, ApproachTargetMode, ChaseTargetMode, WalkAway,
            HasDestination, DriveToDestination, TurnAroundMode, WalkBackwardsToTargetMode, LeanAgainstVehicleMode, AccompliceMode;
        public Items.NpcHeldItemState HeldItem;
    }
    public static class NpcStateStore
    {
        public static NpcState Current;
        public static NpcState TryGetState(Rage.Ped ped) => Current;
    }
    public static class NpcTargeting
    {
        public static Rage.Ped Conversation, Speaker;
        public static bool HumanPed = true;
        public static Rage.Ped GetPlayerConversationPed() => Conversation;
        public static Rage.Ped GetCurrentSpeakerPed() => Speaker;
        public static bool IsValidHumanPed(Rage.Ped ped) => HumanPed;
    }
}
