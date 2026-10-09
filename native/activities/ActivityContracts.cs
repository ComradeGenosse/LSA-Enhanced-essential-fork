using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;

namespace LSA.Activities
{
    public static class ActivityContracts
    {
        public const int Version = 1;
        public const int FrameBytes = 8192;
        public const int LeaseTtlMs = 5000;
        public const int CallbackRing = 64;
        public const int EvidenceCap = 8;
        public const int NativeQueue = 64;
        public const int CompanionQueue = 256;
        public const int MaxActors = 4;
        public static readonly string[] CapabilityIds = { "hold_position","follow_person","resume_ambient","sit_on_ground","stop_and_face","approach_person","enter_vehicle_seat","exit_vehicle","follow_vehicle","begin_driving","scenario_here","scenario_at","walk_away_from","take_cover","grab_item","give_item","take_item","clear_held_item","walk_to","drive_to","chase_person","directed_interaction","perform_activity" };
        public static readonly string[] ModeCapabilities = { "hold_position","follow_person","sit_on_ground","stop_and_face","follow_vehicle","begin_driving","scenario_here","take_cover","chase_person","directed_interaction" };
        public static readonly string[] DiagnosticKeys = { "activities","paused","executions","anchors","dispatches","accepted","established","completed","failed","superseded","timedOut","detached","staleReceipts","callbackDropped","adapterDeferred","updateMicrosP95","leaseExpiries","breakerTrips","extensionReissues" };
        public static readonly string[] ReasonCodes = { "already_satisfied","actor_not_owned","actor_unavailable","actor_dead","actor_retired","actor_injured","scripted_state","directed_interaction","reflex_active","on_foot_required","in_vehicle_required","driver_required","vehicle_invalid","vehicle_moving","seat_occupied","seat_unavailable","target_invalid","target_retired","target_out_of_range","place_unresolved","place_unsupported","capability_unavailable","capability_disabled","policy_denied","role_blocked","state_blocked","queue_not_accepted","handler_false","handler_exception","approach_failed","no_progress","navigation_failed","accept_timeout","establish_timeout","complete_timeout","hold_limit","activity_deadline","goal_deadline","superseded_player","superseded_essential","superseded_reflex","superseded_activity","control_released","far_release","lease_lost","epoch_changed","clock_reset","cancelled_by_player","cancelled_by_engine","preempted","stale_receipt","budget_exhausted","repeated_failure","bubble_exceeded","unsupported_combination","activity_busy","activity_limit","vehicle_mismatch","target_changed" };
        static readonly HashSet<string> Capabilities = new HashSet<string>(CapabilityIds);
        static readonly HashSet<string> Modes = new HashSet<string>(ModeCapabilities);
        static readonly HashSet<string> Reasons = new HashSet<string>(ReasonCodes);
        static readonly Regex Uuid = new Regex("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", RegexOptions.Compiled);
        static readonly Regex Sha = new Regex("^[a-f0-9]{64}$", RegexOptions.Compiled);
        static readonly Regex Alias = new Regex("^promoted\\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", RegexOptions.Compiled);
        public static bool IsUuid(string value) => value != null && Uuid.IsMatch(value);
        // Private passive C-05 annotation. Structural validity does not grant
        // transport support, actor ownership, a lease or execution authority.
        public static bool DialogueActionAnnotation(IDictionary<string,object> value,int expectedSequence)
        {
            try {
                if(!Exact(value,"version","type","sequence","dialogueActionVersion","publicationId","tuple","binding","canonicalAction","publishedAtMs") || !Sequenced(value,expectedSequence) || value["type"] as string!="dialogue.action.pending" || !(value["dialogueActionVersion"] is int v && v==1) || !IsUuid(value["publicationId"] as string))return false;
                var tuple=value["tuple"] as Dictionary<string,object>;var binding=value["binding"] as Dictionary<string,object>;
                if(!Exact(tuple,"pedId","turnId","generationId","sessionNonce") || !ShortIdentity(tuple["pedId"]) || !ShortIdentity(tuple["turnId"]) || !SafeInteger(tuple["generationId"],0) || !SafeInteger(tuple["sessionNonce"],1) || !Exact(binding,"encounterId","incarnationId","hostContext") || !IsUuid(binding["encounterId"] as string) || !IsUuid(binding["incarnationId"] as string))return false;
                var host=binding["hostContext"] as Dictionary<string,object>;var action=value["canonicalAction"] as string;
                return Exact(host,"hostContextVersion","hostRunId","worldEpoch") && host["hostContextVersion"] is int hv && hv==1 && IsUuid(host["hostRunId"] as string) && host["worldEpoch"] is int epoch && epoch>0 && action!=null && Regex.IsMatch(action,@"^[a-z][a-z0-9_]{0,63}\z") && SafeInteger(value["publishedAtMs"],0);
            }catch{return false;}
        }
        static bool ShortIdentity(object value) => value is string text && text.Length>0 && text.Length<=128;
        static bool SafeInteger(object value,long min) => (value is int || value is long) && Convert.ToInt64(value)>=min && Convert.ToInt64(value)<=9007199254740991L;
        public static bool IsReason(string value) => value != null && Reasons.Contains(value);
        public static bool IsCapability(string value) => value != null && Capabilities.Contains(value);
        public static bool IsMode(string value) => value != null && Modes.Contains(value);
        public static bool UnsignedDue(uint now, uint start, int budgetMs) => budgetMs >= 0 && unchecked(now - start) >= (uint)budgetMs;
        public static bool Exact(IDictionary<string, object> value, params string[] keys)
        {
            if (value == null || value.Count != keys.Length) return false;
            foreach (var key in keys) if (!value.ContainsKey(key)) return false;
            return true;
        }
        public static bool NonNegative(object value, int max = int.MaxValue)
        {
            if (value is bool || value is string || value == null) return false;
            try { var number = Convert.ToInt64(value, CultureInfo.InvariantCulture); return number >= 0 && number <= max; } catch { return false; }
        }
        public static bool HelloNative(IDictionary<string, object> value, string contractSha)
        {
            try { return HostEnvelope(value, "version", "type", "nativeRun", "adapterEpoch", "contractSha256", "capabilities", "limits") && VersionOf(value) && value["type"] as string == "hello" && IsUuid(value["nativeRun"] as string) && IsUuid(value["adapterEpoch"] as string) && value["contractSha256"] as string == contractSha && Sha.IsMatch(contractSha) && CapabilityMap(value["capabilities"] as Dictionary<string, object>) && LimitMap(value["limits"] as Dictionary<string, object>); }
            catch { return false; }
        }
        public static bool HelloClient(IDictionary<string, object> value, string contractSha)
        {
            try { return HostEnvelope(value, "version", "type", "contractSha256", "clientRun") && VersionOf(value) && value["type"] as string == "hello" && value["contractSha256"] as string == contractSha && IsUuid(value["clientRun"] as string); }
            catch { return false; }
        }
        static bool HostEnvelope(IDictionary<string,object> value,params string[] keys)
        {
            if(value==null) return false;
            bool extended=value.ContainsKey("hostContextVersion") || value.ContainsKey("hostRunId") || value.ContainsKey("worldEpoch");
            if(!extended) return Exact(value,keys);
            var all=new List<string>(keys);all.AddRange(new[]{"hostContextVersion","hostRunId","worldEpoch"});
            return Exact(value,all.ToArray()) && value["hostContextVersion"] is int v && v==1 && IsUuid(value["hostRunId"] as string) && value["worldEpoch"] is int epoch && epoch>0;
        }
        public static bool Lease(IDictionary<string, object> value, int expectedSequence)
        {
            try { return Exact(value, "version", "type", "sequence", "leaseTtlMs") && Sequenced(value, expectedSequence) && value["type"] as string == "lease" && NonNegative(value["leaseTtlMs"], LeaseTtlMs) && Convert.ToInt32(value["leaseTtlMs"], CultureInfo.InvariantCulture) >= 1; }
            catch { return false; }
        }

        public static bool ExecutionFrame(IDictionary<string, object> value, int expectedSequence)
        {
            try {
                if (!Sequenced(value, expectedSequence)) return false;
                var type = value["type"] as string;
                if (type == "actor.acquire")
                    return Exact(value,"version","type","sequence","requestId","characterId","ownerAlias","ownershipToken","leaseId") &&
                        UuidField(value,"requestId") && UuidField(value,"characterId") && UuidField(value,"ownershipToken") && UuidField(value,"leaseId") &&
                        value["ownerAlias"] is string alias && Alias.IsMatch(alias);
                if (type == "actor.release")
                    return Exact(value,"version","type","sequence","requestId","encounterId","leaseId") &&
                        UuidField(value,"requestId") && UuidField(value,"encounterId") && UuidField(value,"leaseId");
                if (type == "anchor.resolve") {
                    if (!Exact(value,"version","type","sequence","requestId","encounterId","leaseId","refs") ||
                        !UuidField(value,"requestId") || !UuidField(value,"encounterId") || !UuidField(value,"leaseId") ||
                        !(value["refs"] is object[] refs) || refs.Length > 8) return false;
                    foreach (var item in refs) if (!ResolveRef(item as Dictionary<string,object>)) return false;
                    return true;
                }
                if (type == "step.preflight")
                    return Exact(value,"version","type","sequence","requestId","encounterId","leaseId","capability","args","preconditions") &&
                        UuidField(value,"requestId") && UuidField(value,"encounterId") && UuidField(value,"leaseId") &&
                        Act2Capability(value["capability"] as string) && StepArgs(value["args"] as Dictionary<string,object>, value["capability"] as string) &&
                        TokenArray(value["preconditions"] as object[],32);
                if (type == "step.begin")
                    return Exact(value,"version","type","sequence","requestId","executionId","activityId","stepId","attempt","encounterId","leaseId","leaseEpoch","capability","args","timeouts","completion","violated","onLeaseLoss") &&
                        UuidField(value,"requestId") && UuidField(value,"executionId") && UuidField(value,"activityId") && UuidField(value,"stepId") &&
                        UuidField(value,"encounterId") && UuidField(value,"leaseId") && NonNegative(value["attempt"],8) && Convert.ToInt32(value["attempt"],CultureInfo.InvariantCulture) >= 1 &&
                        NonNegative(value["leaseEpoch"]) && Act2Capability(value["capability"] as string) &&
                        StepArgs(value["args"] as Dictionary<string,object>, value["capability"] as string) &&
                        Timeouts(value["timeouts"] as Dictionary<string,object>) && Completion(value["completion"] as Dictionary<string,object>) &&
                        TokenArray(value["violated"] as object[],32) && ((value["onLeaseLoss"] as string) == "detach" || (value["onLeaseLoss"] as string) == "cancel_if_current");
                if (type == "step.cancel")
                    return Exact(value,"version","type","sequence","requestId","executionId","mode") &&
                        UuidField(value,"requestId") && UuidField(value,"executionId") &&
                        ((value["mode"] as string) == "detach" || (value["mode"] as string) == "cancel_if_current");
                if (type == "step.query") {
                    if (!Exact(value,"version","type","sequence","requestId","executionIds") || !UuidField(value,"requestId") || !(value["executionIds"] is object[] ids) || ids.Length > 8) return false;
                    foreach (var id in ids) if (!(id is string text) || !IsUuid(text)) return false;
                    return true;
                }
                return false;
            } catch { return false; }
        }
        static bool UuidField(IDictionary<string,object> value,string key) => value.TryGetValue(key,out var item) && item is string text && IsUuid(text);
        static bool Act2Capability(string value) => value == "hold_position" || value == "follow_person" || value == "resume_ambient" || value == "sit_on_ground";
        static bool Token(string value) => value != null && Regex.IsMatch(value,"^[a-z][a-z0-9_]{0,47}$");
        static bool TokenArray(object[] value,int max)
        {
            if (value == null || value.Length > max) return false;
            foreach (var item in value) if (!(item is string text) || !Token(text)) return false;
            return true;
        }
        static bool ResolveRef(Dictionary<string,object> value)
        {
            if (!Exact(value,"role","slot") || !(value["role"] is string role) || !(value["slot"] is Dictionary<string,object> slot)) return false;
            if (role == "target") return Exact(slot,"kind") && slot["kind"] as string == "player";
            if (role == "place") {
                if (!Exact(slot,"kind","place") || slot["kind"] as string != "place" || !(slot["place"] is Dictionary<string,object> place)) return false;
                return Exact(place,"kind") && place["kind"] as string == "here";
            }
            return false;
        }
        static bool StepArgs(Dictionary<string,object> value,string capability)
        {
            if (value == null) return false;
            if (capability == "follow_person") {
                if (!Exact(value,"target") || !(value["target"] is Dictionary<string,object> target) || !Exact(target,"kind","captureRef")) return false;
                var kind = target["kind"] as string;
                return (kind == "player" || kind == "capture") && target["captureRef"] is string targetRef && IsUuid(targetRef);
            }
            if (capability == "hold_position") {
                if (!Exact(value,"place") || !(value["place"] is Dictionary<string,object> place) || !Exact(place,"kind","placeRef")) return false;
                return place["kind"] as string == "place" && place["placeRef"] is string placeRef && IsUuid(placeRef);
            }
            return value.Count == 0;
        }
        static bool Timeouts(Dictionary<string,object> value)
        {
            if (!Exact(value,"acceptMs","establishMs","completeMs","holdMaxMs") || !NonNegative(value["acceptMs"],3600000)) return false;
            foreach (var key in new[]{"establishMs","completeMs","holdMaxMs"}) if (value[key] != null && !NonNegative(value[key],3600000)) return false;
            return true;
        }
        static bool Completion(Dictionary<string,object> value)
        {
            if (!Exact(value,"adapter","until") || !(value["adapter"] is string adapter) ||
                (adapter != "hold_mode" && adapter != "follow_mode" && adapter != "pose_mode" && adapter != "resume_ambient")) return false;
            if (value["until"] == null) return true;
            if (!(value["until"] is Dictionary<string,object> until) || !(until["kind"] is string kind)) return false;
            if (kind == "player_command") return Exact(until,"kind");
            if (kind == "duration") return Exact(until,"kind","bucket") && until["bucket"] is string bucket && (bucket == "short" || bucket == "medium" || bucket == "long");
            if (kind == "player_returns") return Exact(until,"kind","radius") && until["radius"] is string radius && (radius == "near" || radius == "medium");
            return false;
        }

        public static bool ActorFacts(IDictionary<string, object> value)
        {
            try {
                if (!Exact(value, "version", "type", "sequence", "encounterId", "alive", "injured", "scripted", "suspended", "inDirectedInteraction", "reflexActive", "inVehicle", "isDriver", "controlIntent", "stateRegistered", "distanceBand", "gameMs") || !(value["sequence"] is int sequence) || !Sequenced(value, sequence) || value["type"] as string != "actor.facts" || !IsUuid(value["encounterId"] as string)) return false;
                foreach (var key in new[] { "alive", "injured", "scripted", "suspended", "inDirectedInteraction", "reflexActive", "inVehicle", "isDriver", "controlIntent", "stateRegistered" }) if (!(value[key] is bool)) return false;
                var band = value["distanceBand"] as string;
                return (band == "at" || band == "near" || band == "medium" || band == "far") && NonNegative(value["gameMs"]) && Convert.ToInt64(value["gameMs"], CultureInfo.InvariantCulture) <= uint.MaxValue;
            } catch { return false; }
        }
        public static bool Diagnostics(IDictionary<string, object> value)
        {
            try {
                if (value == null || value.Count != 3 + DiagnosticKeys.Length || !(value["sequence"] is int sequence) || !Sequenced(value, sequence) || value["type"] as string != "diagnostics") return false;
                foreach (var key in DiagnosticKeys) if (!NonNegative(value.ContainsKey(key) ? value[key] : null)) return false;
                return true;
            } catch { return false; }
        }
        static bool VersionOf(IDictionary<string, object> value) => value != null && value.ContainsKey("version") && value["version"] is int version && version == Version;
        static bool Sequenced(IDictionary<string, object> value, int expected) => VersionOf(value) && value.ContainsKey("sequence") && value["sequence"] is int sequence && sequence == expected && sequence >= 1;
        static bool CapabilityMap(Dictionary<string, object> value)
        {
            if (value == null || value.Count != CapabilityIds.Length) return false;
            foreach (var id in CapabilityIds) if (!value.TryGetValue(id, out var item) || !(item is bool)) return false;
            return true;
        }
        static bool LimitMap(Dictionary<string, object> value)
        {
            return value != null && Exact(value, "characters", "anchors", "pendingPerActor", "callbackRing", "frameBytes", "nativeQueue", "companionQueue", "receiptsPerSecond", "factsPerSecond") &&
                Int(value, "characters") == MaxActors && Int(value, "anchors") == 32 && Int(value, "pendingPerActor") == 1 && Int(value, "callbackRing") == CallbackRing &&
                Int(value, "frameBytes") == FrameBytes && Int(value, "nativeQueue") == NativeQueue && Int(value, "companionQueue") == CompanionQueue && Int(value, "receiptsPerSecond") == 4 && Int(value, "factsPerSecond") == 2;
        }
        static int Int(Dictionary<string, object> value, string key) => Convert.ToInt32(value[key], CultureInfo.InvariantCulture);
    }
}
