using System;

namespace LSA.Intelligence
{
    // C-06 is a separately proven native fact, not a model judgment or a
    // PS3 inference. Every field must come from an authoritative *current*
    // owner-fiber read. Default Snapshot values deny.
    internal static class DirectorC06Policy
    {
        internal sealed class Snapshot
        {
            public string HostRunId,SpeakerCaptureRef,PlayerCaptureRef,OwnerIncarnationId;
            public int WorldEpoch,OwnerProofRevision,PlayerTurnVersion,PolicyVersion;
            public bool SpeakerAnchorCurrent,SpeakerOwned,SpeakerObserver,SpeakerAlive;
            public bool PlayerAnchorCurrent,PlayerIsLocal,PlayerAlive;
            public bool OwnerProofCurrent,OwnerPrimaryModeKnown,OwnerIdle;
            public bool PlayerTurnSourceCurrent,PlayerTurnIdle,MicStateKnown,MicIdle;
            public bool EssentialTurnKnown,EssentialTurnIdle,PlaybackKnown,PlaybackIdle;
            public bool ScriptStateKnown,ScriptSafe,ActorReflexKnown,ActorReflexIdle;
            public bool ObservationReceiptCurrent,ResponseGrantCurrent;
        }
        // Admission must be idle; playback completion may be legitimately busy.
        internal static bool Safe(DirectorAdmission.Request r,Snapshot s)
        {
            return CurrentPlayback(r,s) && s.OwnerIdle &&
                s.EssentialTurnIdle && s.PlaybackIdle;
        }
        // Terminal proof rechecks the original identity, current native
        // ownership, player priority, PS3 grant and host, but not idle flags.
        // Exact native turn/generation and audio completion are checked apart.
        internal static bool CurrentPlayback(DirectorAdmission.Request r,Snapshot s)
        {
            return r!=null && s!=null &&
                r.HostRunId==s.HostRunId && r.WorldEpoch==s.WorldEpoch &&
                r.SpeakerCaptureRef==s.SpeakerCaptureRef &&
                r.PlayerCaptureRef==s.PlayerCaptureRef &&
                r.OwnerIncarnationId==s.OwnerIncarnationId &&
                r.ProofRevision==s.OwnerProofRevision &&
                r.PlayerTurnVersion==s.PlayerTurnVersion &&
                r.PolicyVersion==s.PolicyVersion &&
                s.SpeakerAnchorCurrent && s.SpeakerOwned && s.SpeakerObserver && s.SpeakerAlive &&
                s.PlayerAnchorCurrent && s.PlayerIsLocal && s.PlayerAlive &&
                s.OwnerProofCurrent && s.OwnerPrimaryModeKnown &&
                s.PlayerTurnSourceCurrent && s.PlayerTurnIdle &&
                s.MicStateKnown && s.MicIdle &&
                s.EssentialTurnKnown &&
                s.PlaybackKnown &&
                s.ScriptStateKnown && s.ScriptSafe &&
                s.ActorReflexKnown && s.ActorReflexIdle &&
                s.ObservationReceiptCurrent && s.ResponseGrantCurrent;
        }
    }
}
