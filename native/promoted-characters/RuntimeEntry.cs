using System;
using System.Diagnostics;
using System.Threading;
using System.Web.Script.Serialization;
using LosSantosAlive.Integrations;
using LSA.SessionIdentity;
using Rage;
namespace LSA.PromotedCharacters
{
    // Loaded only in the existing Essential domain after the core pin check.
    public static class RuntimeEntry
    {
        static PromotedCharactersIntegration integration;
        static LSA.Intelligence.IntelligenceIntegration intelligence;
        static LSA.Reactions.ReactionIntegration reactions;
        static HostContext host;
        static int startClaim;
        static volatile bool stopping,finished;
        public static bool Ready=>integration?.IsReady==true && !stopping;
        public static bool Alive=>!finished;
        // Private test-build defaults: one reversible flag rather than dozens of
        // independently omitted/disabled switches. No false witness/owner proof
        // and no facial animation; all existing ACT/C-06/PS4 gates still apply.
        static void ApplyPersonalTestDefaults(Config config)
        {
            if(!config.personalTestMode)return;
            config.intelligence=config.intelligence??new IntelligenceConfig();
            config.intelligence.mode="shadow";
            config.intelligence.directorMode="experimental";
            config.intelligence.radio="shadow";
            config.intelligence.protagonistEvidence="negotiated_v1";
            // Explicit partial producer dictionaries otherwise disable every
            // unlisted producer. In personal test mode request the full set.
            config.intelligence.producers=null;
            config.activities=config.activities??new ActivitiesConfig();
            config.activities.mode="on";
            config.activities.dialogueReceipts=true;
            config.reactions=config.reactions??new ReactionsConfig();
            config.reactions.mode="on";
            config.reactions.enabled=new[]{"nod","shrug"};
            config.reactions.allowDuringOwnedBehavior=false;
            config.npcVoicePresence=config.npcVoicePresence??new VoicePresenceConfig();
            config.npcVoicePresence.mode="shadow";
            config.npcVoicePresence.mouthEnabled=false; // facial overlay disabled
            config.memoryK=config.memoryK??new NativeMemoryKConfig();
            config.memoryK.capabilities=config.memoryK.capabilities??new System.Collections.Generic.Dictionary<string,object>();
            config.memoryK.capabilities["ps1.producers"]="on";
            foreach(var family in new[]{"crash","rollover","airborne","water","wanted","wasted","busted"})
                config.memoryK.capabilities["events."+family]="on";
        }
        public static bool Start(string text)
        {
            if(integration!=null || finished || stopping || text==null || text.Length>4096) return false;
            var config=new JavaScriptSerializer {MaxJsonLength=4096}.Deserialize<Config>(text);
            if(config==null || !config.enabled) return false;
            ApplyPersonalTestDefaults(config);
            LSA.Intelligence.NativeProducerPolicy producerPolicy;
            try {producerPolicy=LSA.Intelligence.NativeProducerPolicy.FromConfig(
                config.memoryK?.capabilities,config.intelligence?.producers,config.intelligence?.radio);}
            catch(ArgumentException) {LSA.Intelligence.IntelligenceIntegration.LogStatus("[PS] native_producer_configuration_invalid");return false;}
            // Keep the raw optional value: serializer bool conversion can
            // accept strings. Only a literal JSON true opts into collection.
            bool collectDialogueReceipts=config.activities?.dialogueReceipts is bool && (bool)config.activities.dialogueReceipts;
            // This setting comes from the native-owned Plugins/LSA.PromotedCharacters.json,
            // not an untrusted PS6 request. Only exact literal strings count.
            // Misconfigured or missing values always retain the native 4/min limit.
            int directorAttemptsPerMinute=config.intelligence?.mode=="shadow" &&
                config.intelligence?.directorMode=="experimental" &&
                config.intelligence?.directorAttemptPreset is string &&
                (string)config.intelligence.directorAttemptPreset=="testing"
                ? LSA.Intelligence.DirectorAdmission.TestingMaxAttempts
                : LSA.Intelligence.DirectorAdmission.NormalMaxAttempts;
            // Remoting can call Start concurrently. Only one caller may create
            // the owner fiber, including before that fiber has initialized.
            if(Interlocked.CompareExchange(ref startClaim,1,0)!=0) return false;
            // Remoting only schedules; native work executes in a game fiber.
            GameFiber.StartNew(()=>{
                string exitReason="host_unavailable";
                HostInterruptionEvidence focusEvidence=null;
                try {
                    // Background sampler uses OS window state only, never GTA
                    // natives. Evidence is logged on this owner fiber after resume.
                    focusEvidence=new HostInterruptionEvidence(HostInterruptionEvidence.ReadProcessForeground);
                    GameFiber.Yield();
                    if(stopping) return;
                    host=new HostContext();
                    integration=new PromotedCharactersIntegration(config.worldProfileId,config.pipeName,config.identityPipeName,host);
                    if(config.activities?.mode=="shadow") { try { integration.EnableActivityShadow(config.activities.pipeName,collectDialogueReceipts);} catch {Game.LogTrivial("[ACT] optional_host_unavailable");} }
                    else if(config.activities?.mode=="on") { try { integration.EnableActivityExecution(config.activities.pipeName,collectDialogueReceipts);} catch {Game.LogTrivial("[ACT] optional_host_unavailable");} }
                    try { integration.ConfigureVoicePresence(config.npcVoicePresence?.mode ?? "off",
                        config.npcVoicePresence?.mouthEnabled is bool && (bool)config.npcVoicePresence.mouthEnabled,
                        VoiceOpenLevel(config.npcVoicePresence?.mouthOpenLevel),
                        config.npcVoicePresence?.levelLog is bool && (bool)config.npcVoicePresence.levelLog); }
                    catch { Game.LogTrivial("[VP] observer_configuration_failed"); }
                    integration.Prepare();
                    IntegrationManager.Register(integration);
                    if(config.intelligence?.mode=="shadow") {
                        try {
                            intelligence=new LSA.Intelligence.IntelligenceIntegration(integration.PerceptionRoster,config.intelligence.pipeName,host,config.intelligence.directorMode=="shadow" || config.intelligence.directorMode=="experimental",config.intelligence.directorMode=="experimental",config.intelligence.radio,directorAttemptsPerMinute,integration.SampleMemoryNativeAuthority,
                                integration.SampleMemoryCurrentOwnerPlayer,producerPolicy,
                                config.intelligence.protagonistEvidence=="negotiated_v1");
                            integration.OwnerRetired+=intelligence.OwnerRetired;
                            IntegrationManager.Register(intelligence);intelligence.Initialize();
                        } catch {Game.LogTrivial("[PS] optional_host_unavailable");}
                    }
                    // Cosmetic conversation reactions: default off, own pipe, no ACT/P2 involvement.
                    if(config.reactions?.mode=="shadow" || config.reactions?.mode=="on") {
                        try {
                            var reactionOptions=new LSA.Reactions.ReactionOptions {Mode=config.reactions.mode,
                                AllowDuringOwnedBehavior=config.reactions.allowDuringOwnedBehavior is bool && (bool)config.reactions.allowDuringOwnedBehavior,
                                Diagnostics=config.reactions.diagnostics is bool && (bool)config.reactions.diagnostics};
                            foreach(var name in config.reactions.disabled ?? new string[0])
                                if(LSA.Reactions.ReactionCatalog.IsKnown(name))reactionOptions.Disabled.Add(name);
                            foreach(var name in config.reactions.enabled ?? new string[0])
                                if(LSA.Reactions.ReactionCatalog.IsKnown(name))reactionOptions.Enabled.Add(name);
                            reactions=new LSA.Reactions.ReactionIntegration(reactionOptions,config.reactions.pipeName,host.HostRunId,()=>host.WorldEpoch,()=>host.MonotonicMs,OwnedByLsaBehavior);
                            var reactionHost=reactions;
                            host.WorldChanged+=(epoch,reason)=>reactionHost.WorldChanged(reason);
                            IntegrationManager.Register(reactions);reactions.Initialize();
                        } catch {Game.LogTrivial("[RX] optional_host_unavailable");}
                    }
                    Game.LogTrivial(integration.IsAvailable?"[P2] integrations_installed":"[P2] integration_unavailable");
                    var statusClock=Stopwatch.StartNew();long nextStatus=0,lastWake=-1;
                    while(!stopping && integration.IsAvailable) {
                        var wake=statusClock.ElapsedMilliseconds;
                        HostInterruptionEvidence.FocusTransition transition;
                        while(focusEvidence!=null && focusEvidence.TryRead(out transition))
                            LSA.Intelligence.IntelligenceIntegration.LogStatus(
                                "[P2] focus_changed observed_utc="+transition.Utc.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")+
                                " foreground="+(transition.Foreground==1?"yes":transition.Foreground==0?"no":"unknown")+
                                " host_run="+host.HostRunId+" world_epoch="+host.WorldEpoch);
                        if(HostInterruptionEvidence.OwnerFiberGap(lastWake,wake))
                            LSA.Intelligence.IntelligenceIntegration.LogStatus(
                                "[P2] owner_fiber_gap observed_utc="+DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")+
                                " gap_ms="+(wake-lastWake)+" host_run="+host.HostRunId+
                                " world_epoch="+host.WorldEpoch+" cause=unverified");
                        lastWake=wake;
                        if(intelligence!=null && statusClock.ElapsedMilliseconds>=nextStatus) {
                            nextStatus=statusClock.ElapsedMilliseconds+10000;
                            ReportStatus();
                        }
                        GameFiber.Sleep(100);
                    }
                } catch {exitReason="host_failed";LSA.Intelligence.IntelligenceIntegration.LogStatus("[P2] host_initialization_failed");}
                finally {
                    try {focusEvidence?.Dispose();}catch{}
                    EssentialInputInterception.ReleaseAll();
                    if(stopping) exitReason="host_stop_requested";
                    LSA.Intelligence.IntelligenceIntegration.LogStatus("[P2] host_exit reason="+exitReason+" p2_reason="+(integration?.UnavailabilityReason??"not_initialized"));
                    if(intelligence!=null) ReportStatus();
                    // Native clip cleanup must run from ReactionIntegration.Update on Core, not this lifetime fiber.
                    try {reactions?.RequestShutdown();} catch {}
                    try {intelligence?.Shutdown(exitReason);} finally {try {integration?.RequestShutdown();} finally {finished=true;Game.LogTrivial("[P2] native_host_stopped");}}
                }
            },"LSA character host lifetime");
            return true;
        }
        // A promoted ped must carry positively current P2/ACT idle proof.
        // Ordinary unpromoted peds are not owned by P2/ACT; the executor still
        // independently requires the exact Essential conversation speaker and
        // a fresh safe-state preflight before and during every animation tick.
        // Missing/retired roster authority is never accepted as *promoted* idle.
        static bool OwnedByLsaBehavior(Ped ped) {
            var owner=integration;
            if(owner==null || ped==null || !ped.Exists() || ped.IsDead) return true;
            foreach(var participant in owner.PerceptionRoster()) {
                if(participant.Ped==null || !participant.Ped.Equals(ped)) continue;
                if(participant.Current?.Invoke()!=true) return true;
                var sample=participant.PrimaryOwner?.Invoke() as PrimaryBehaviorOwner;
                if(sample==null || sample.mode!="idle") return true;
                return sample.owner!="p2" && sample.owner!="act";
            }
            // No P2/ACT roster membership: possible ordinary Essential speaker.
            // No gesture is admitted until ReactionExecutor.ReadFacts confirms
            // current speaker, player exclusion, no active tasks and safe natives.
            return false;
        }
        public static void Stop() { stopping=true; EssentialInputInterception.ReleaseAll(); }
        public static bool LeaseInput(int mark,int text) => !stopping && EssentialInputInterception.Lease(mark,text);
        public static bool LeaseTalkInput(int talk) => !stopping && EssentialInputInterception.LeaseTalk(talk);
        public static bool PulseInput(int vk) => !stopping && EssentialInputInterception.Pulse(vk);
        public static void ReleaseInput() => EssentialInputInterception.Release();
        public static void ReleaseTalkInput() => EssentialInputInterception.ReleaseTalk();
        // UX phase 1 bridge. Strings only; DomainHost reflects into these. Callers
        // never touch game state: work is queued for the integration's Update.
        public static string Submit(string envelope) {var owner=integration;return owner!=null && !stopping?owner.SubmitLocal(envelope):"native_unavailable";}
        public static string TryTakeResult(string id)=>integration?.TakeLocalResult(id);
        public static string Snapshot() {var owner=integration;return owner!=null && !stopping?owner.LocalSnapshot():null;}
        public static void RequestSnapshots(int forMs) {var owner=integration;if(owner!=null && !stopping) owner.RequestLocalSnapshots(forMs);}
        static void ReportStatus() {
            // Observe from the existing host fiber even if Core stops dispatching Update.
            // This never drives sampling or emits new factual frames.
            LSA.Intelligence.IntelligenceIntegration.LogStatus("[PS] host_status p2_available="+(integration?.IsAvailable==true)+" p2_reason="+(integration?.UnavailabilityReason??"not_initialized")+" "+intelligence.RuntimeStatus()+" "+(integration?.IdentityRuntimeStatus??"identity_status=none"));
        }
        public sealed class Config
        {
            public bool personalTestMode {get;set;}=true;
            public bool enabled {get;set;} public string worldProfileId {get;set;}
            public string pipeName {get;set;}="LSA.PromotedCharacters.v1";
            public string identityPipeName {get;set;}="LSA.SessionIdentity.v1";
            public IntelligenceConfig intelligence {get;set;}=new IntelligenceConfig();
            public ActivitiesConfig activities {get;set;}=new ActivitiesConfig();
            public ReactionsConfig reactions {get;set;}=new ReactionsConfig();
            public NativeMemoryKConfig memoryK {get;set;}
            public VoicePresenceConfig npcVoicePresence {get;set;}=new VoicePresenceConfig();
        }
        public sealed class VoicePresenceConfig {
            public string mode {get;set;}="off";
            // Only a literal JSON true opts into unverified Enhanced facial natives.
            public object mouthEnabled {get;set;}=false;
            // Essential RMS level (0.002..0.5) at which the mouth opens; anything else
            // falls back to the default. Calibrate with levelLog.
            public object mouthOpenLevel {get;set;}
            // Literal JSON true enables rate-limited read-only "[VP] level ..." logging.
            public object levelLog {get;set;}=false;
        }
        internal static float VoiceOpenLevel(object value) {
            try {
                if(value==null||value is bool||value is string) return 0.015f;
                double v=Convert.ToDouble(value,System.Globalization.CultureInfo.InvariantCulture);
                return (v>=0.002&&v<=0.5)?(float)v:0.015f;
            } catch {return 0.015f;}
        }
        public sealed class NativeMemoryKConfig {public System.Collections.Generic.Dictionary<string,object> capabilities {get;set;}}
        public sealed class IntelligenceConfig {public string mode {get;set;}="off";public string directorMode {get;set;}="off";public string radio {get;set;}="off";public object directorAttemptPreset {get;set;}="normal";public string pipeName {get;set;}="LSA.Intelligence.v1";public string protagonistEvidence {get;set;}="off";public System.Collections.Generic.Dictionary<string,object> producers {get;set;}}
        // Default off. Only the literal strings "shadow" and "on" enable anything; "on" is the only mode that animates.
        public sealed class ReactionsConfig {public string mode {get;set;}="off";public string pipeName {get;set;}="LSA.Reactions.v1";public string[] disabled {get;set;}=new string[0];public string[] enabled {get;set;}=new string[0];public object allowDuringOwnedBehavior {get;set;}=false;public object diagnostics {get;set;}=false;}
        public sealed class ActivitiesConfig {public object dialogueReceipts {get;set;}=false;public string mode {get;set;}="off";public string pipeName {get;set;}="LSA.Activities.v1";}
    }
}
