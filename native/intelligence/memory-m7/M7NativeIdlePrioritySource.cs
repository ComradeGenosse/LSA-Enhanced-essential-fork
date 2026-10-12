using System;
using System.Collections.Generic;
using LSA.Intelligence;

namespace LSA.Intelligence
{
    // T7 passive owner-fiber diagnostic producer. K exclusively wires the
    // existing native sampler/pipe. NO secondary GTA fiber/transport/AI.
    // IMPORTANT: pinned Core does not expose complete ORIGINAL normal-turn
    // and Essential in-flight/terminal idle proofs. Never publish the M7
    // verified-native-idle kind from this diagnostic snapshot.
    internal static class M7NativeIdlePrioritySource
    {
        internal const string DiagnosticKind = "native_idle_diagnostic_v1";
        internal const string VerifiedKind = "verified_native_idle_v1";
        internal static readonly string[] UnsupportedPinnedCoreFields = {
            "playerTurnSourceCurrent", "playerTurnIdle",
            "essentialTurnKnown", "essentialTurnIdle"
        };
        internal sealed class Snapshot
        {
            internal string Kind, HostRunId, SpeakerCaptureRef, OwnerIncarnationId;
            internal int WorldEpoch;
            internal uint GameTick;
            internal IDictionary<string, bool> PriorityEvidence;
            internal bool NativeVerified;
            internal string[] MissingCoreCapabilities;
        }
        // Called only with the original C-06 native sample assembled on the
        // authorized existing host owner fiber. Never accept a JS/M7 flag or
        // a microphone silence timer as a native source of negative facts.
        internal static Snapshot Assess(DirectorC06Policy.Snapshot native,
            string hostRunId, int worldEpoch, uint gameTick)
        {
            var p=new Dictionary<string,bool>(StringComparer.Ordinal) {
                ["ownerProofCurrent"]=native?.OwnerProofCurrent==true,
                ["speakerOwned"]=native?.SpeakerOwned==true,
                ["speakerAlive"]=native?.SpeakerAlive==true,
                ["playerIsLocal"]=native?.PlayerIsLocal==true,
                ["playerAlive"]=native?.PlayerAlive==true,
                ["ownerPrimaryModeKnown"]=native?.OwnerPrimaryModeKnown==true,
                ["ownerIdle"]=native?.OwnerIdle==true,
                ["micStateKnown"]=native?.MicStateKnown==true,
                ["micIdle"]=native?.MicIdle==true,
                ["conversationStateKnown"]=native?.ConversationStateKnown==true,
                ["conversationIdle"]=native?.ConversationIdle==true,
                ["textInputKnown"]=native?.TextInputKnown==true,
                ["textInputIdle"]=native?.TextInputIdle==true,
                ["controlsInputKnown"]=native?.ControlsInputKnown==true,
                ["controlsInputIdle"]=native?.ControlsInputIdle==true,
                ["scriptStateKnown"]=native?.ScriptStateKnown==true,
                ["scriptSafe"]=native?.ScriptSafe==true,
                ["actorReflexKnown"]=native?.ActorReflexKnown==true,
                ["actorReflexIdle"]=native?.ActorReflexIdle==true,
                // Existing DirectorC06 original turn receipt is PS3/grant-
                // scoped, not a global C-01 normal player-turn completion.
                ["playerTurnSourceCurrent"]=false,
                ["playerTurnIdle"]=false,
                ["essentialTurnKnown"]=false,
                ["essentialTurnIdle"]=false,
                ["playbackKnown"]=native?.PlaybackKnown==true,
                ["playbackIdle"]=native?.PlaybackIdle==true
            };
            return new Snapshot {
                Kind=DiagnosticKind,NativeVerified=false,
                HostRunId=hostRunId,WorldEpoch=worldEpoch,
                GameTick=gameTick,
                SpeakerCaptureRef=native?.SpeakerCaptureRef,
                OwnerIncarnationId=native?.OwnerIncarnationId,
                PriorityEvidence=p,MissingCoreCapabilities=UnsupportedPinnedCoreFields
            };
        }
    }
}
