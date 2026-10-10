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
            // Original PS3 observation and response entitlement must match; a
            // truthful C-06 idle sample alone never authorizes an unrelated grant.
            public string ObservationId,DecisionKey;
            public int WorldEpoch,OwnerProofRevision,PlayerTurnVersion,PolicyVersion,ObservationRevision;
            public bool SpeakerAnchorCurrent,SpeakerOwned,SpeakerObserver,SpeakerAlive;
            public bool PlayerAnchorCurrent,PlayerIsLocal,PlayerAlive;
            public bool OwnerProofCurrent,OwnerPrimaryModeKnown,OwnerIdle;
            public bool PlayerTurnSourceCurrent,PlayerTurnIdle,MicStateKnown,MicIdle;
            // Source-pinned NpcTargeting negative player/dialogue state. The
            // pinned GetCurrentSpeakerPed forwards to GetPlayerConversationPed:
            // these are NOT independent global turn ownership sources.
            // Missing selected target cannot certify asynchronous idle.
            public bool ConversationStateKnown,ConversationIdle;
            // The public Essential text editor and controls menu are genuine
            // player-input negative signals. Neither proves that a submitted
            // or remotely executing text turn has completed.
            public bool TextInputKnown,TextInputIdle,ControlsInputKnown,ControlsInputIdle;
            // The pinned Core exposes a narrower special-turn revision, not a
            // complete global player-turn arbiter. Diagnostic only, never a grant.
            public bool SpecialTurnVersionKnown;
            public long SpecialTurnVersion=-1;
            public bool EssentialTurnKnown,EssentialTurnIdle,PlaybackKnown,PlaybackIdle;
            public bool ScriptStateKnown,ScriptSafe,ActorReflexKnown,ActorReflexIdle;
            public bool ObservationReceiptCurrent,ResponseGrantCurrent;
        }
        // Admission must be idle; playback completion may be legitimately busy.
        internal static bool Safe(DirectorAdmission.Request r,Snapshot s)
        {
            // Idle checks are only required before a stock turn starts.
            // During a legitimate Core playback, the current speaker and
            // queued-audio state can be busy *because of our own NPC*.
            return CurrentPlayback(r,s) && s.OwnerIdle &&
                s.EssentialTurnIdle && s.PlaybackIdle && s.ConversationIdle;
        }
        // After a *bound* original turn begins, admission receipts are no
        // longer an idle grant: PS3 (<=2s) and the cross-process quiet sample
        // (250ms) legitimately expire while speech is generated or played.
        // Requiring those expired receipts at playback start/end would make
        // every normal spoken answer fail. Check fresh native identity,
        // player safety, incumbent P2 owner and script/reflex facts instead.
        // The immutable original ticket and Core/player epochs are independently
        // fenced by DirectorAdmission.SafeReserved.
        internal static bool CurrentOccupiedPlayback(DirectorAdmission.Request r,Snapshot s)
        {
            return r!=null && s!=null &&
                !string.IsNullOrWhiteSpace(r.HostRunId) &&
                !string.IsNullOrWhiteSpace(r.SpeakerCaptureRef) &&
                !string.IsNullOrWhiteSpace(r.PlayerCaptureRef) &&
                !string.IsNullOrWhiteSpace(r.OwnerIncarnationId) &&
                r.HostRunId==s.HostRunId && r.WorldEpoch>0 &&
                r.WorldEpoch==s.WorldEpoch &&
                r.SpeakerCaptureRef==s.SpeakerCaptureRef &&
                r.PlayerCaptureRef==s.PlayerCaptureRef &&
                r.OwnerIncarnationId==s.OwnerIncarnationId &&
                r.ProofRevision>0 && r.ProofRevision==s.OwnerProofRevision &&
                s.SpeakerAnchorCurrent && s.SpeakerOwned &&
                s.SpeakerObserver && s.SpeakerAlive &&
                s.PlayerAnchorCurrent && s.PlayerIsLocal && s.PlayerAlive &&
                s.OwnerProofCurrent && s.OwnerPrimaryModeKnown &&
                s.MicStateKnown && s.MicIdle &&
                s.ConversationStateKnown &&
                s.TextInputKnown && s.TextInputIdle &&
                s.ControlsInputKnown && s.ControlsInputIdle &&
                s.ScriptStateKnown && s.ScriptSafe &&
                s.ActorReflexKnown && s.ActorReflexIdle;
        }
        // Terminal proof rechecks the original identity, current native
        // ownership, player priority, PS3 grant and host, but not idle flags.
        // Exact native turn/generation and audio completion are checked apart.
        internal static bool CurrentPlayback(DirectorAdmission.Request r,Snapshot s)
        {
            return r!=null && s!=null &&
                // Policy is also called by offline code outside the request
                // decoder: missing tuples never compare equal by null==null.
                !string.IsNullOrWhiteSpace(r.HostRunId) &&
                !string.IsNullOrWhiteSpace(r.SpeakerCaptureRef) &&
                !string.IsNullOrWhiteSpace(r.PlayerCaptureRef) &&
                !string.IsNullOrWhiteSpace(r.OwnerIncarnationId) &&
                !string.IsNullOrWhiteSpace(r.ObservationId) &&
                !string.IsNullOrWhiteSpace(r.DecisionKey) &&
                r.WorldEpoch>0 && r.ProofRevision>0 && r.ObservationRevision>0 &&
                r.HostRunId==s.HostRunId && r.WorldEpoch==s.WorldEpoch &&
                r.SpeakerCaptureRef==s.SpeakerCaptureRef &&
                r.PlayerCaptureRef==s.PlayerCaptureRef &&
                r.OwnerIncarnationId==s.OwnerIncarnationId &&
                r.ProofRevision==s.OwnerProofRevision &&
                r.PlayerTurnVersion==s.PlayerTurnVersion &&
                r.PolicyVersion==s.PolicyVersion &&
                r.ObservationId==s.ObservationId && r.ObservationRevision==s.ObservationRevision &&
                r.DecisionKey==s.DecisionKey &&
                s.SpeakerAnchorCurrent && s.SpeakerOwned && s.SpeakerObserver && s.SpeakerAlive &&
                s.PlayerAnchorCurrent && s.PlayerIsLocal && s.PlayerAlive &&
                s.OwnerProofCurrent && s.OwnerPrimaryModeKnown &&
                s.PlayerTurnSourceCurrent && s.PlayerTurnIdle &&
                s.MicStateKnown && s.MicIdle &&
                s.ConversationStateKnown &&
                s.TextInputKnown && s.TextInputIdle &&
                s.ControlsInputKnown && s.ControlsInputIdle &&
                s.EssentialTurnKnown &&
                s.PlaybackKnown &&
                s.ScriptStateKnown && s.ScriptSafe &&
                s.ActorReflexKnown && s.ActorReflexIdle &&
                s.ObservationReceiptCurrent && s.ResponseGrantCurrent;
        }
    }
}
