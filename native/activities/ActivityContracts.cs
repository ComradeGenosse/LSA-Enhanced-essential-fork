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
            try { return Exact(value, "version", "type", "nativeRun", "adapterEpoch", "contractSha256", "capabilities", "limits") && VersionOf(value) && value["type"] as string == "hello" && IsUuid(value["nativeRun"] as string) && IsUuid(value["adapterEpoch"] as string) && value["contractSha256"] as string == contractSha && Sha.IsMatch(contractSha) && CapabilityMap(value["capabilities"] as Dictionary<string, object>) && LimitMap(value["limits"] as Dictionary<string, object>); }
            catch { return false; }
        }
        public static bool HelloClient(IDictionary<string, object> value, string contractSha)
        {
            try { return Exact(value, "version", "type", "contractSha256", "clientRun") && VersionOf(value) && value["type"] as string == "hello" && value["contractSha256"] as string == contractSha && IsUuid(value["clientRun"] as string); }
            catch { return false; }
        }
        public static bool Lease(IDictionary<string, object> value, int expectedSequence)
        {
            try { return Exact(value, "version", "type", "sequence", "leaseTtlMs") && Sequenced(value, expectedSequence) && value["type"] as string == "lease" && NonNegative(value["leaseTtlMs"], LeaseTtlMs) && Convert.ToInt32(value["leaseTtlMs"], CultureInfo.InvariantCulture) >= 1; }
            catch { return false; }
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
