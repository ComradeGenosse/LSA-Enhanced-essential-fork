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
        readonly Action<string,string> diagnostic;
        void Trace(string status,string reason) {try{diagnostic?.Invoke(status,reason);}catch{}}

        // Production injects only the actual pinned Core scheduler method;
        // no synthetic player, generated NPC turn or alternate executor.
        internal static DirectorSchedulerIntake Production(
            DirectorAdmission admission,bool enabled=false,
            Action<string,string> diagnostic=null)
        {
            return new DirectorSchedulerIntake(admission,
                SpecialGeminiTurnScheduler.Submit,enabled,diagnostic);
        }

        // Tests can replace the ONE stock boundary with a recorder. Disabled
        // takes priority over even an all-positive fake proof and function.
        internal DirectorSchedulerIntake(DirectorAdmission admission,
            Func<SpecialGeminiTurnRequest,bool> stockSubmit,bool enabled=false,
            Action<string,string> diagnostic=null)
        {
            this.admission=admission??throw new ArgumentNullException(nameof(admission));
            this.stockSubmit=stockSubmit??throw new ArgumentNullException(nameof(stockSubmit));
            this.enabled=enabled;this.diagnostic=diagnostic;
        }

        internal bool Dispatch(string ticket,string context,
            DirectorC06Policy.Snapshot nativeProof,Ped speaker,Ped player)
        {
            if(!enabled || string.IsNullOrWhiteSpace(ticket) ||
               !DirectorStockTurnRequest.ValidContext(context)) {
                Trace("rejected","disabled_or_invalid_context");return false;
            }
            // Consumes a previously SUBMITTED native ticket exactly once,
            // rechecking the source-backed C-06 and both takeover epochs.
            // A denied/throwing scheduler is terminal: no retries.
            var original=admission.TryClaimStockIntake(ticket);
            if(original==null){Trace("rejected","stock_ticket_unavailable");return false;}
            var prepared=DirectorStockTurnRequest.Prepare(
                original,nativeProof,speaker,player,context);
            if(prepared==null) {
                Trace("rejected","native_c06_or_actor_denied");
                admission.AbandonStockIntake(ticket);
                return false;
            }
            try {
                if(stockSubmit(prepared)) {
                    Trace("accepted","core_scheduler_accepted");return true;
                }
            }catch {
                Trace("rejected","core_scheduler_exception");
                admission.AbandonStockIntake(ticket);return false;
            }
            // Core rejected or faulted before a real turn was accepted.
            // Never leave an unusable C-11 reservation occupied.
            Trace("rejected","core_scheduler_rejected");
            admission.AbandonStockIntake(ticket);
            return false;
        }
    }
}
