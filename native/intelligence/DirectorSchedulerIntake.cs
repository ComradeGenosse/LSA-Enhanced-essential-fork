using System;
using LosSantosAlive.Bridge.SpecialTurns;
using Rage;

namespace LSA.Intelligence
{
    // 13a/#3A: the only call site for Essential's REAL stock scheduler.
    // Never schedule from an observation, prompt or unverified ticket. The
    // independent PS2/PS3, player/Core and backend owner checks are all
    // still necessary and are sampled on the native owner fiber.
    internal sealed class DirectorSchedulerIntake
    {
        readonly DirectorAdmission admission;
        readonly Func<SpecialGeminiTurnRequest,bool> stockSubmit;
        readonly bool enabled;

        // Production injects only the actual pinned Core scheduler method;
        // no synthetic player, generated NPC turn or alternate executor.
        internal static DirectorSchedulerIntake Production(
            DirectorAdmission admission,bool enabled=false)
        {
            return new DirectorSchedulerIntake(admission,
                SpecialGeminiTurnScheduler.Submit,enabled);
        }

        // Tests can replace the ONE stock boundary with a recorder. Disabled
        // takes priority over even an all-positive fake proof and function.
        internal DirectorSchedulerIntake(DirectorAdmission admission,
            Func<SpecialGeminiTurnRequest,bool> stockSubmit,bool enabled=false)
        {
            this.admission=admission??throw new ArgumentNullException(nameof(admission));
            this.stockSubmit=stockSubmit??throw new ArgumentNullException(nameof(stockSubmit));
            this.enabled=enabled;
        }

        internal bool Dispatch(string ticket,string context,
            DirectorC06Policy.Snapshot nativeProof,Ped speaker,Ped player)
        {
            if(!enabled || string.IsNullOrWhiteSpace(ticket) ||
               !DirectorStockTurnRequest.ValidContext(context))
                return false;
            // Consumes a previously SUBMITTED native ticket exactly once,
            // rechecking the source-backed C-06 and both takeover epochs.
            // A denied/throwing scheduler is terminal: no retries.
            var original=admission.TryClaimStockIntake(ticket);
            if(original==null)return false;
            var prepared=DirectorStockTurnRequest.Prepare(
                original,nativeProof,speaker,player,context);
            if(prepared==null) {
                admission.AbandonStockIntake(ticket);
                return false;
            }
            try {
                if(stockSubmit(prepared))return true;
            }catch {}
            // Core rejected or faulted before a real turn was accepted.
            // Never leave an unusable C-11 reservation occupied.
            admission.AbandonStockIntake(ticket);
            return false;
        }
    }
}
