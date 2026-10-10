using System;
using LosSantosAlive.Bridge.SpecialTurns;
using Rage;

namespace LSA.Intelligence
{
    // Source-compatible preparation of Essential's *existing* special-turn
    // request. This class deliberately cannot schedule speech: no Submit,
    // SendNow, new fiber, callback, or second execution engine lives here.
    // The live native C-06 snapshot is still unable to prove all gates, so
    // production never produces a request eligible for active dispatch.
    internal static class DirectorStockTurnRequest
    {
        internal static bool ValidContext(string context)=>
            !string.IsNullOrWhiteSpace(context) && context.Length<=160 &&
            context.IndexOfAny(new[]{'\r','\n','\0','\t'})<0;

        internal static SpecialGeminiTurnRequest Prepare(
            DirectorAdmission.Request original,
            DirectorC06Policy.Snapshot nativeProof,
            Ped speaker,Ped player,string context)
        {
            if(!DirectorAdmission.Valid(original) || original.Operation!="submit" ||
                !DirectorC06Policy.Safe(original,nativeProof) ||
                speaker==null || player==null || speaker==player ||
                !speaker.Exists() || speaker.IsDead ||
                !player.Exists() || player.IsDead ||
                !ValidContext(context))
                return null;
            // This is one speech-only candidate, not a generic autonomous
            // command. Stock Essential retains its own final eligibility gate.
            return new SpecialGeminiTurnRequest {
                SpeakerPed=speaker,
                ListenerPed=player,
                SpeechTargetPed=player,
                Content=context,
                Reason="ps6_observer",
                DedupeKey="ps:"+original.TicketId,
                FaceListener=false,
                InterruptExisting=false,
                DelayMilliseconds=0,
                CancelIfPlayerStartsTurn=true,
                RequireCurrentPlayerConversation=false,
                SkipIfSpeakerBusy=true
            };
        }
    }
}
