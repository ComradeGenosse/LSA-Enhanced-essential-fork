using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using LSA.Enhanced.Commands;
using LSA.Enhanced.Input;
using LSA.Enhanced.Settings;

namespace LSA.Enhanced.Ui
{
    // Pure view models for the native menu. They map runtime snapshots, the
    // companion's JSON and loader settings into display lines and actions; the
    // RNUI layer only renders them and dispatches commands. All player-facing
    // fixed text lives here or in the command catalog.
    public sealed class MenuLine
    {
        public string Key, Text, Right, Description, Command, Value;
        public bool Enabled = true, Info, Confirm, Toggle;   // Toggle: an on/off checkbox; Value is "on" or "off"
        public string[] Options, OptionLabels;              // a left/right choice; Value is one of Options
        public static MenuLine Fact(string key,string text,string right,string description = null) => new MenuLine {Key = key,Text = text,Right = right,Description = description,Info = true,Enabled = true};
        public static MenuLine Action(string key,string text,string command,string description,bool enabled = true,bool confirm = false) => new MenuLine {Key = key,Text = text,Command = command,Description = description,Enabled = enabled,Confirm = confirm};
        public string Signature => Key + "|" + Text + "|" + Right + "|" + Enabled + "|" + Command + "|" + Value + "|" + Toggle + "|" + (Options == null ? "" : string.Join(",",Options)) + "|" + Description;
        public static MenuLine Choice(string key,string text,string command,string value,string[] options,string[] labels,string description,bool enabled = true) =>
            new MenuLine {Key = key,Text = text,Command = command,Value = value,Options = options,OptionLabels = labels ?? options,Description = description,Enabled = enabled};
        public static MenuLine Switch(string key,string text,string command,bool on,string description,bool enabled = true) =>
            new MenuLine {Key = key,Text = text,Command = command,Value = on ? "on" : "off",Toggle = true,Description = description,Enabled = enabled};
    }
    public sealed class Describe
    {
        public string Kind = "unknown", Name, CharacterId, Relationship, Status, Voice;
        public string ActivityIntent, ActivityStep, ActivityStatus, ActivityReason, ActivityPhrase;
        public bool ActivityPresent;
        public string[] Facts = new string[0];
        static readonly Regex Uuid = new Regex("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$");
        public static Describe Parse(string json)
        {
            try {
                var value = new JavaScriptSerializer {MaxJsonLength = 32768,RecursionLimit = 6}.DeserializeObject(json ?? "") as Dictionary<string,object>;
                if (value == null) return null;
                var result = new Describe {Kind = Text(value,"kind",16) ?? "unknown",Name = Text(value,"name",80),Relationship = Text(value,"relationship",16),Status = Text(value,"status",16),Voice = Text(value,"voice",40)};
                string id = Text(value,"characterId",36); result.CharacterId = id != null && Uuid.IsMatch(id) ? id : null;
                if (value.TryGetValue("facts",out var facts) && facts is object[] items) result.Facts = items.OfType<string>().Where(item => item.Length > 0 && item.Length <= 120).Take(3).ToArray();
                if (value.TryGetValue("activity",out var activity) && activity is Dictionary<string,object> row) {
                    result.ActivityPresent = row.TryGetValue("present",out var present) && present is bool flag && flag;
                    result.ActivityIntent = Token(row,"intent"); result.ActivityStep = Token(row,"step");
                    result.ActivityStatus = Token(row,"status"); result.ActivityReason = Token(row,"reason");
                    result.ActivityPhrase = Text(row,"phrase",120);
                }
                if (result.Kind != "promoted" && result.Kind != "encounter") result.Kind = "unknown";
                return result;
            } catch { return null; }
        }
        static string Text(Dictionary<string,object> value,string key,int max) => value.TryGetValue(key,out var item) && item is string text && text.Length > 0 && text.Length <= max && !text.Any(char.IsControl) ? text : null;
        static string Token(Dictionary<string,object> value,string key) => value.TryGetValue(key,out var item) && item is string text && Regex.IsMatch(text,"^[a-z][a-z0-9_]{0,47}$") ? text : null;
    }
    public sealed class CurrentNpcModel
    {
        public string Title = "Current NPC", EncounterId, OwnerAlias;
        public bool Present, Owned;
        public readonly List<MenuLine> Lines = new List<MenuLine>();
        // The encounter is part of the signature, so a different NPC always
        // rebuilds the page (and cancels a pending confirmation).
        public string Signature => Title + "#" + EncounterId + "#" + OwnerAlias + "#" + string.Join("#",Lines.Select(line => line.Signature));
    }
    public static class CurrentNpcView
    {
        public const string ClearTalkCommand = "local.clearTalkTarget";
        public static CurrentNpcModel Build(NativeSnapshot snapshot,long utcNow,Describe describe,bool hostAvailable,bool companionAvailable,EnhancedSettings settings)
        {
            var model = new CurrentNpcModel();
            if (!hostAvailable) {
                model.Lines.Add(MenuLine.Fact("status","LSA native host","Unavailable","The P2 native host is not running, so current-NPC actions are off. Mark and Text still work."));
                return model;
            }
            if (snapshot == null || !snapshot.Fresh(utcNow,InputGates.SnapshotMaxAgeMs)) {
                model.Lines.Add(MenuLine.Fact("status","Current NPC","Waiting for the game","Essential refreshes this while the game runs; a paused game shows nothing new."));
                return model;
            }
            var npc = snapshot.Current;
            if (npc == null || !npc.Present) {
                if (snapshot.TalkTarget != null && snapshot.TalkTarget.Present) AddTalk(model,snapshot.TalkTarget);
                else model.Lines.Add(MenuLine.Fact("status","No current NPC","","Mark or talk to an NPC with Essential first."));
                return model;
            }
            model.Present = true; model.Owned = npc.Owned; model.EncounterId = npc.EncounterId; model.OwnerAlias = npc.OwnerAlias;
            bool matches = describe != null && (npc.Owned ? describe.Kind == "promoted" : describe.Kind != "promoted");
            string name = matches ? describe.Name : null;
            model.Title = name ?? (npc.Owned ? "Promoted character" : "Current NPC");
            model.Lines.Add(MenuLine.Fact("type","Status",npc.Owned ? (npc.Suspended ? "Promoted, suspended" : "Promoted") : "Not promoted"));
            if (npc.Owned) model.Lines.Add(MenuLine.Fact("mode","Mode",npc.Mode == "follow" ? "Following" : npc.Mode == "wait" ? "Waiting" : npc.Mode == "activity" ? "Activity" : "Idle"));
            if (matches && describe.Kind == "promoted" && describe.Relationship != null) model.Lines.Add(MenuLine.Fact("relationship","Relationship",Capitalize(describe.Relationship)));
            if (matches && describe.Facts.Length > 0) model.Lines.Add(MenuLine.Fact("role","Role",describe.Facts[0]));
            if (matches && describe.Voice != null) model.Lines.Add(MenuLine.Fact("voice","Voice",describe.Voice));
            if (!companionAvailable) model.Lines.Add(MenuLine.Fact("companion","AI companion","Unavailable","Names and P2 actions need the AI companion."));
            if (!npc.Safe) model.Lines.Add(MenuLine.Fact("blocked","P2 control","Blocked now","Cutscenes, missions, script-owned peds and directed interactions block control."));
            bool ask = settings == null || settings.OrdinaryNpc == "ask";
            if (npc.Owned) {
                model.Lines.Add(MenuLine.Action("follow","Follow",CommandCatalog.CurrentFollow,"Follow you as a companion (P2).",companionAvailable));
                model.Lines.Add(MenuLine.Action("wait","Wait here",CommandCatalog.CurrentWait,"Wait at this spot (P2).",companionAvailable));
                model.Lines.Add(MenuLine.Action("dismiss","Dismiss",CommandCatalog.CurrentDismiss,"Release this incarnation. The saved character is kept.",companionAvailable,true));
                var companionActivity = matches && describe != null && describe.ActivityPresent;
                var activityPresent = companionActivity || npc.ActivityPresent;
                var activityIntent = companionActivity ? describe.ActivityIntent : npc.ActivityIntent;
                var activityStatus = companionActivity ? describe.ActivityStatus : npc.ActivityStatus;
                var activityReason = companionActivity ? describe.ActivityReason : npc.ActivityReason;
                var label = activityPresent ? ActivityLabel(activityIntent) + " · " + ActivityLabel(activityStatus) : "No activity";
                var detail = companionActivity && describe.ActivityPhrase != null ? describe.ActivityPhrase :
                    activityReason == null ? "Player-assigned activity for this character." : "Reason: " + activityReason.Replace('_',' ');
                model.Lines.Add(MenuLine.Fact("activity","Activity",label,detail));
                model.Lines.Add(MenuLine.Action("assign","Assign Activity...","local.openActivities","Follow me, wait here, sit here, or resume the previous activity.",companionAvailable));
                model.Lines.Add(MenuLine.Action("activityPause","Pause Activity",CommandCatalog.ActivityPause,"Pause the current activity. Resume starts a new attempt.",companionAvailable && activityPresent && activityStatus != "paused"));
                model.Lines.Add(MenuLine.Action("activityResume","Resume Activity",CommandCatalog.ActivityResume,"Resume after a fresh check. This does not reuse the old attempt.",companionAvailable && activityStatus == "paused"));
                model.Lines.Add(MenuLine.Action("activityCancel","Cancel Activity",CommandCatalog.ActivityCancel,"Stop the activity this addon started.",companionAvailable && activityPresent));
                model.Lines.Add(MenuLine.Action("activityStatus","Activity Status",CommandCatalog.ActivityStatus,"Show the current activity, step and result.",companionAvailable));
                model.Lines.Add(MenuLine.Action("activityHistory","Activity history",CommandCatalog.ActivityHistory,"The last few finished activities.",companionAvailable));
            } else {
                model.Lines.Add(MenuLine.Action("promote","Promote",CommandCatalog.CurrentPromote,"Make this NPC a persistent character with saved memories.",companionAvailable && npc.Human,true));
                if (ask) {
                    model.Lines.Add(MenuLine.Action("askFollow","Ask to follow",CommandCatalog.CurrentFollow,"Ask in character: \"" + (settings?.Phrase("follow") ?? "Follow me.") + "\""));
                    model.Lines.Add(MenuLine.Action("askWait","Ask to wait",CommandCatalog.CurrentWait,"Ask in character: \"" + (settings?.Phrase("wait") ?? "Wait here.") + "\""));
                }
            }
            if (snapshot.TalkTarget != null && snapshot.TalkTarget.Present) AddTalk(model,snapshot.TalkTarget);
            return model;
        }
        static void AddTalk(CurrentNpcModel model,TalkTargetInfo talk)
        {
            var lines = new List<MenuLine> {
                MenuLine.Fact("talk","Explicit talk target",talk.PttCommitted ? "Talking" : "Selected","The highlighted NPC is used for Follow, Wait, Promote and this page."),
                MenuLine.Action("clearTalk","Clear target",ClearTalkCommand,"Forget this highlighted NPC.")
            };
            if (talk.CycleCount > 0) lines.Insert(1,MenuLine.Fact("talkCycle","Candidate",talk.CycleIndex + "/" + talk.CycleCount));
            if (!talk.PttCommitted && talk.ExpiresInMs > 0) lines.Insert(lines.Count - 1,MenuLine.Fact("talkExpires","Selection expires",Math.Max(1,(talk.ExpiresInMs + 999) / 1000) + " s"));
            model.Lines.InsertRange(0,lines);
        }
        public static string Capitalize(string text) => string.IsNullOrEmpty(text) ? text : char.ToUpperInvariant(text[0]) + text.Substring(1);
        public static string ActivityLabel(string token)
        {
            if (token == "accompany" || token == "follow_person") return "Follow me";
            if (token == "hold_position") return "Wait here";
            if (token == "sit_here" || token == "sit_on_ground") return "Sit here";
            if (token == "resume_previous" || token == "resume_ambient") return "Resume previous activity";
            if (token == "running") return "Running";
            if (token == "paused") return "Paused";
            if (token == "completed") return "Completed";
            if (token == "failed") return "Failed";
            if (token == "cancelled") return "Cancelled";
            if (token == "superseded") return "Replaced";
            if (token == "abandoned") return "Stopped";
            if (token == "expired") return "Timed out";
            return string.IsNullOrEmpty(token) ? "Activity" : Capitalize(token);
        }
        public static CurrentNpcModel Assign(bool companionAvailable)
        {
            var model = new CurrentNpcModel {Title = "Assign Activity"};
            model.Lines.Add(MenuLine.Action("followMe","Follow me",CommandCatalog.ActivityAssign,"Follow you. Essential keeps the follow.",companionAvailable,true));
            model.Lines.Add(MenuLine.Action("waitHere","Wait here",CommandCatalog.ActivityAssign,"Wait at this spot.",companionAvailable,true));
            model.Lines.Add(MenuLine.Action("sitHere","Sit here",CommandCatalog.ActivityAssign,"Sit on the ground.",companionAvailable,true));
            model.Lines.Add(MenuLine.Action("resumePrevious","Resume previous activity",CommandCatalog.ActivityAssign,"Return to ambient behavior. This does not restore an old task.",companionAvailable,true));
            model.Lines[0].Value = "accompany"; model.Lines[1].Value = "hold_position"; model.Lines[2].Value = "sit_here"; model.Lines[3].Value = "resume_previous";
            return model;
        }
    }
    public sealed class MemoryRow
    {
        public string MemoryId, Preview, Category;
        public bool Selected;
        public int Importance;
    }
    public sealed class CharacterRow
    {
        public string CharacterId, Name, RuntimeStatus, Status, RelationshipState, RelationshipDescription, Voice;
        public long Revision;
        public readonly List<MemoryRow> Memories = new List<MemoryRow>();
        public bool Spawned => RuntimeStatus == "spawned";
        public bool Suspended => RuntimeStatus == "suspended";
        public string IdSuffix => CharacterId.Substring(CharacterId.Length - 4);
        public string StatusLabel => RuntimeStatus == "spawned" ? "In world" : RuntimeStatus == "suspended" ? "Suspended" : Status == "dead" ? "Dead" : Status == "retired" ? "Retired" : "Absent";
    }
    public static class CharacterList
    {
        public const int MaxCharacters = 500, MemoryPreviewChars = 60;
        static readonly Regex Uuid = new Regex("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$");
        // The companion's legacy "list" response: an array of full profiles. Only
        // the fields the menu shows are kept; biography and notes are dropped.
        public static List<CharacterRow> Parse(string json)
        {
            try {
                var items = new JavaScriptSerializer {MaxJsonLength = 10 * 1024 * 1024,RecursionLimit = 12}.DeserializeObject(json ?? "") as object[];
                if (items == null) return null;
                var rows = new List<CharacterRow>();
                foreach (var item in items.Take(MaxCharacters)) {
                    var row = ParseProfile(item as Dictionary<string,object>);
                    if (row != null) rows.Add(row);
                }
                return rows.OrderBy(row => row.Name,StringComparer.OrdinalIgnoreCase).ToList();
            } catch { return null; }
        }
        public static CharacterRow ParseProfile(Dictionary<string,object> value)
        {
            if (value == null || !(value.TryGetValue("characterId",out var id) && id is string characterId && Uuid.IsMatch(characterId))) return null;
            var row = new CharacterRow {CharacterId = characterId,Name = Text(value,"name",80) ?? "Unnamed",Status = Text(value,"status",16) ?? "available",RuntimeStatus = Text(value,"runtimeStatus",16) ?? Text(value,"status",16) ?? "available"};
            row.Revision = value.TryGetValue("revision",out var revision) ? Convert.ToInt64(revision,CultureInfo.InvariantCulture) : 0;
            if (value.TryGetValue("relationship",out var relationship) && relationship is Dictionary<string,object> details) { row.RelationshipState = Text(details,"state",16) ?? "associate"; row.RelationshipDescription = details.TryGetValue("description",out var text) && text is string description && description.Length <= 600 ? description : ""; }
            if (value.TryGetValue("voiceReference",out var voice) && voice is Dictionary<string,object> reference) row.Voice = Text(reference,"voice",40);
            if (value.TryGetValue("memories",out var memories) && memories is object[] list)
                foreach (var memory in list.OfType<Dictionary<string,object>>().Take(128)) {
                    if (!(memory.TryGetValue("memoryId",out var memoryId) && memoryId is string mid && Uuid.IsMatch(mid))) continue;
                    string text = memory.TryGetValue("text",out var raw) && raw is string body ? body : "";
                    row.Memories.Add(new MemoryRow {MemoryId = mid,Preview = Preview(text),Category = Text(memory,"category",16) ?? "note",Selected = memory.TryGetValue("selectedForContext",out var selected) && selected is bool flag && flag,
                        Importance = memory.TryGetValue("importance",out var importance) && importance is int number ? number : 50});
                }
            return row;
        }
        public static string Preview(string text)
        {
            string flat = Regex.Replace(text ?? "","\\s+"," ").Trim();
            flat = new string(flat.Where(c => !char.IsControl(c)).ToArray());
            return flat.Length <= MemoryPreviewChars ? flat : flat.Substring(0,MemoryPreviewChars - 1) + "…";
        }
        static string Text(Dictionary<string,object> value,string key,int max) => value.TryGetValue(key,out var item) && item is string text && text.Length <= max && !text.Any(char.IsControl) ? text : null;
        public static readonly string[] Relationships = {"associate","friend","trusted","strained","neutral"};
        public static readonly string[] Availability = {"available","dead","retired"};
        public static List<MenuLine> Actions(CharacterRow row,bool companionAvailable,bool hostAvailable)
        {
            bool live = companionAvailable && hostAvailable;
            var lines = new List<MenuLine> {
                MenuLine.Fact("status","Status",row.StatusLabel),
                MenuLine.Action("summon","Summon",CommandCatalog.CharacterSummon,"Recreate this character near you in a safe outdoor spot.",live && !row.Spawned && row.Status != "retired"),
                MenuLine.Action("follow","Follow",CommandCatalog.CharacterFollow,"Follow you.",live && (row.Spawned || row.Suspended)),
                MenuLine.Action("wait","Wait here",CommandCatalog.CharacterWait,"Wait at their spot.",live && (row.Spawned || row.Suspended)),
                MenuLine.Action("dismiss","Dismiss",CommandCatalog.CharacterDismiss,"Release this incarnation. The saved character is kept.",live && (row.Spawned || row.Suspended),true),
                MenuLine.Action("despawn","Despawn",CommandCatalog.CharacterDespawn,"Delete the ped this addon summoned (" + row.Name + ", …" + row.IdSuffix + "). Adopted peds are refused.",live && (row.Spawned || row.Suspended),true),
                MenuLine.Action("rename","Rename",CommandCatalog.CharacterRename,"Change the name with the on-screen keyboard.",companionAvailable),
                MenuLine.Choice("relationship","Relationship",CommandCatalog.CharacterRelationship,Choose(row.RelationshipState,Relationships),Relationships,Relationships.Select(CurrentNpcView.Capitalize).ToArray(),"Choose with left/right, then select to save. Associate, friend, trusted, strained or neutral.",companionAvailable),
                MenuLine.Choice("availability","Availability",CommandCatalog.CharacterAvailability,Choose(row.Status,Availability),Availability,Availability.Select(CurrentNpcView.Capitalize).ToArray(),"Choose with left/right, then select to save. Retired characters cannot be summoned.",companionAvailable),
                MenuLine.Action("memoryAdd","Add a short memory",CommandCatalog.CharacterMemoryAdd,"Type a memory with the on-screen keyboard (longer text: use the editor).",companionAvailable),
            };
            foreach (var memory in row.Memories) lines.Add(MenuLine.Switch("memory:" + memory.MemoryId,memory.Preview.Length == 0 ? "(empty memory)" : memory.Preview,CommandCatalog.CharacterMemorySelect,memory.Selected,
                "Checked memories are part of this character's dialogue context, most important first, within its size budget. " + DescribeCategory(memory),companionAvailable));
            if (row.Memories.Count == 0) lines.Add(MenuLine.Fact("memories","Memories","None yet"));
            return lines;
        }
        static string Choose(string value,string[] options) => value != null && Array.IndexOf(options,value) >= 0 ? value : options[0];
        static string DescribeCategory(MemoryRow memory) => CurrentNpcView.Capitalize(memory.Category) + ", importance " + memory.Importance + ".";
    }
    public static class ControlsView
    {
        public const string GesturesCommand = "local.gestures", ChordWindowCommand = "local.chordWindow";
        public const int MinChordWindowMs = 40, MaxChordWindowMs = 250, ChordWindowStepMs = 10;
        // 40-250 ms in 10 ms steps, plus the current value if the file uses another.
        public static int[] ChordWindowOptions(int current)
        {
            var values = new SortedSet<int>();
            for (int value = MinChordWindowMs; value <= MaxChordWindowMs; value += ChordWindowStepMs) values.Add(value);
            if (current >= MinChordWindowMs && current <= MaxChordWindowMs) values.Add(current);
            return values.ToArray();
        }
        public static List<MenuLine> Build(EnhancedSettings settings,EssentialBindings essential,string routerState,string conflict,bool gesturesPaused,int chordWindowMs,IReadOnlyList<GestureBinding> active,string talkState = null,string talkConflict = null)
        {
            var lines = new List<MenuLine>();
            if (settings == null) return lines;
            lines.Add(MenuLine.Switch("gestures","Gestures",GesturesCommand,!gesturesPaused,"Pause or resume LSA gestures for this session. The menu key keeps working.",settings.InputEnabled));
            var windows = ChordWindowOptions(chordWindowMs);
            lines.Add(MenuLine.Choice("chordWindow","Chord window",ChordWindowCommand,chordWindowMs.ToString(CultureInfo.InvariantCulture),windows.Select(value => value.ToString(CultureInfo.InvariantCulture)).ToArray(),
                windows.Select(value => value + " ms").ToArray(),"How long the second key may follow the first. Applies at once, for this session only; LSA.Enhanced.json keeps the saved value.",settings.InputEnabled));
            lines.Add(MenuLine.Fact("router","Router",routerState == "ready" ? "Ready" : routerState == "disabled" ? "Off (input.enabled)" : routerState.StartsWith("gated",StringComparison.Ordinal) ? "Waiting for gameplay" : CurrentNpcView.Capitalize(routerState),conflict));
            for (int index = 0; index < settings.KeyNames.Count; index++) lines.Add(MenuLine.Fact("key:" + settings.KeyNames[index],"Router key " + settings.KeyNames[index],PhysicalKeys.Name(settings.KeyCodes[index]),"Map this key in your Steam Input layout."));
            foreach (var binding in active) lines.Add(MenuLine.Fact("binding:" + binding.Id,Gesture(binding,settings),Label(binding.Command)));
            if (essential != null) foreach (var key in essential.All) lines.Add(MenuLine.Fact("essential:" + key.Setting,"Essential " + key.Setting,key.Display,"Essential's own keys; change them in its F7 menu."));
            if (conflict != null) lines.Add(MenuLine.Fact("conflict","Conflict",conflict,"A router key must not equal an Essential key."));
            bool shared = essential != null && settings.KeyCodes.Any(vk => (essential.Mark.State == EssentialKeyState.Bound && essential.Mark.Vk == vk) || (essential.Text.State == EssentialKeyState.Bound && essential.Text.Vk == vk));
            lines.Add(MenuLine.Fact("essentialInMenus","Essential keys in menus",shared ? "Talk keys stay active" : "Still active",shared ? "Mark/text gestures pause in menus; explicit menu actions still work. Talk and marked-talk keep their original keys." : "Essential polls its own keys (Talk, Marked Talk) even while an LSA menu is open; LSA gestures pause instead."));
            string talkLabel = settings.TalkEnabled ? (string.IsNullOrEmpty(talkState) ? "On" : talkState) : "Off";
            lines.Add(MenuLine.Fact("talkTarget","Talk target",talkLabel,settings.TalkEnabled ? "Tap the talk key to highlight a nearby NPC. Hold it to speak to that exact NPC. Essential's own Talk key is not pressed." : "Set talkTargeting.enabled to choose an NPC before talking."));
            if (settings.TalkEnabled) {
                lines.Add(MenuLine.Fact("talkKey","Talk target key",settings.TalkKeyName ?? "Unset","Map the controller Talk button to this key in Steam Input. Leave Essential's TalkKey unchanged."));
                lines.Add(MenuLine.Fact("talkHold","Talk hold",settings.TalkHoldMs.ToString(CultureInfo.InvariantCulture) + " ms","A shorter press cycles targets."));
                lines.Add(MenuLine.Fact("talkRadius","Talk radius",settings.TalkRadiusMeters.ToString("0.#",CultureInfo.InvariantCulture) + " m"));
                lines.Add(MenuLine.Fact("talkTimeout","Selection timeout",Math.Max(1,settings.TalkSelectionTimeoutMs / 1000).ToString(CultureInfo.InvariantCulture) + " s"));
            }
            if (!string.IsNullOrEmpty(talkConflict)) lines.Add(MenuLine.Fact("talkConflict","Talk target paused",talkConflict,"This key matches one of Essential's keys, so talk targeting is paused."));
            return lines;
        }
        static string Gesture(GestureBinding binding,EnhancedSettings settings)
        {
            string keys = string.Join(" + ",binding.Keys.Select(key => settings.KeyNames[key] + " (" + PhysicalKeys.Name(settings.KeyCodes[key]) + ")"));
            switch (binding.Kind) {
                case GestureKind.Tap: return "Tap " + keys;
                case GestureKind.Chord: return "Chord " + keys;
                case GestureKind.ChordHold: return "Hold " + keys + " (" + settings.Timing.HoldMs + " ms)";
                case GestureKind.Hold: return "Hold " + keys;
                default: return "Double-tap " + keys;
            }
        }
        public static string Label(string command)
        {
            switch (command) {
                case CommandCatalog.EssentialMark: return "Mark (Essential)";
                case CommandCatalog.EssentialText: return "Text (Essential)";
                case CommandCatalog.CurrentFollow: return "Follow current NPC";
                case CommandCatalog.CurrentWait: return "Wait current NPC";
                case CommandCatalog.UiMainMenu: return "LSA menu";
                case CommandCatalog.UiQuickMenu: return "Current NPC page";
                default: return command;
            }
        }
    }
    public sealed class DiagnosticsInput
    {
        public string HostStatus, RouterState, Conflict, SettingsRevision, EndpointState, EssentialPin, CatalogSha;
        public bool BridgeAvailable, CompanionReachable;
        public long SnapshotAgeMs = -1;
        public int Outstanding;
        public string TalkState, TalkConflict, IndicatorState;
        public IReadOnlyList<string> RecentReasons = new string[0];
    }
    public static class DiagnosticsView
    {
        public static List<MenuLine> Build(DiagnosticsInput input)
        {
            var lines = new List<MenuLine> {
                MenuLine.Fact("host","Native host",input.HostStatus ?? "none"),
                MenuLine.Fact("bridge","Command bridge",input.BridgeAvailable ? "Available" : "Unavailable"),
                MenuLine.Fact("snapshot","Snapshot age",input.SnapshotAgeMs < 0 ? "None" : input.SnapshotAgeMs + " ms"),
                MenuLine.Fact("companion","AI companion",input.CompanionReachable ? "Reachable" : "Not reachable",input.EndpointState),
                MenuLine.Fact("router","Input router",input.RouterState ?? "none",input.Conflict),
                MenuLine.Fact("settings","LSA.Enhanced.json",input.SettingsRevision == "defaults" ? "Defaults" : (input.SettingsRevision ?? "?").Substring(0,Math.Min(8,(input.SettingsRevision ?? "?").Length))),
                MenuLine.Fact("catalog","Command catalog",(input.CatalogSha ?? "?").Substring(0,Math.Min(8,(input.CatalogSha ?? "?").Length))),
                MenuLine.Fact("pending","Pending requests",input.Outstanding.ToString(CultureInfo.InvariantCulture)),
                MenuLine.Fact("talk","Talk target",input.TalkState ?? "Off",input.TalkConflict),
                MenuLine.Fact("indicator","Talk indicator",input.IndicatorState ?? "Off"),
            };
            if (input.RecentReasons.Count == 0) lines.Add(MenuLine.Fact("reasons","Recent failures","None"));
            else foreach (var reason in input.RecentReasons.Reverse().Take(10)) lines.Add(MenuLine.Fact("reason:" + lines.Count,"Recent",reason));
            lines.Add(MenuLine.Action("refresh","Re-check",null,"Refresh this page."));
            lines.Add(MenuLine.Action("log","Write diagnostics to RagePluginHook.log",null,"Adds one [UX] diagnostics line to the RPH log."));
            return lines;
        }
    }
    public static class AiVoiceView
    {
        // Read-only summary of the companion's public e1.config.json; credentials
        // are reported as present or missing only, and their values are never read.
        public static List<MenuLine> Build(string configJson,bool credentialFilePresent)
        {
            var lines = new List<MenuLine>();
            Dictionary<string,object> config = null;
            try { config = new JavaScriptSerializer {MaxJsonLength = 131072,RecursionLimit = 8}.DeserializeObject(configJson ?? "") as Dictionary<string,object>; } catch { }
            if (config == null) { lines.Add(MenuLine.Fact("config","Companion settings","Not found","Plugins/LosSantosAliveServer/e1.config.json")); }
            else {
                void Add(string key,string label,params string[] path) { string value = Find(config,path); if (value != null) lines.Add(MenuLine.Fact(key,label,value)); }
                Add("provider","Provider","provider"); Add("model","Reasoning model","reasoningModel"); Add("effort","Reasoning effort","reasoningEffort");
                Add("transcription","Transcription model","transcriptionModel"); Add("tts","Speech model","ttsModel"); Add("voice","Default voice","ttsVoice");
                Add("assignment","Voice assignment","voiceAssignment"); Add("speed","Speech speed","ttsSpeed"); Add("acting","Acting","actingEnabled");
                Add("streaming","Structured streaming","structuredStreamingEnabled"); Add("earlyTts","Early speech","earlyTtsEnabled");
                Add("identity","Persistent identity","persistentIdentity","enabled"); Add("characters","Promoted characters","promotedCharacters","enabled"); Add("intelligence","Perception","intelligence","mode");
            }
            lines.Add(MenuLine.Fact("credentials","OpenAI key file",credentialFilePresent ? "Present" : "Missing","Only presence is shown; key values are never read."));
            lines.Add(MenuLine.Fact("restart","Changing these","Edit e1.config.json","Applies after the AI companion restarts; in-game editing arrives with the settings service."));
            return lines;
        }
        static string Find(Dictionary<string,object> value,string[] path)
        {
            object current = value;
            foreach (var key in path) { if (!(current is Dictionary<string,object> map) || !map.TryGetValue(key,out current)) return null; }
            switch (current) {
                case bool flag: return flag ? "On" : "Off";
                case string text: return text.Length == 0 || text.Length > 40 || text.Any(char.IsControl) ? null : text;
                case int number: return number.ToString(CultureInfo.InvariantCulture);
                case decimal number: return number.ToString(CultureInfo.InvariantCulture);
                default: return null;
            }
        }
    }
}
