using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using LSA.Enhanced.Commands;
using LSA.Enhanced.Input;
using RAGENativeUI;
using RAGENativeUI.Elements;

namespace LSA.Enhanced.Ui
{
    // RAGENativeUI 1.9.3 frontend in the loader's AppDomain. It renders the pure
    // view models, hands every game or character action to the LoaderDispatcher
    // and never reads or tasks a ped. Constructed only after UiBridge's version
    // guard, so no RNUI type loads where RNUI is missing.
    sealed class NativeMenu : IMenuSurface
    {
        const int RenderIntervalMs = 250, InterestIntervalMs = 1000, InterestMs = 1500, ConfirmWindowMs = 4000, RosterRefreshMs = 10000, AiReadIntervalMs = 5000, MaxConfigBytes = 131072;
        const int MaxNameChars = 80;
        const string LocalOpenCharacter = "local.openCharacter", LocalRefresh = "local.refresh", Title = "LSA Enhanced";
        sealed class Page
        {
            public string Name;
            public UIMenu Menu;
            public string Signature;
            public bool ResetSelection;
            public readonly Dictionary<UIMenuItem,MenuLine> Lines = new Dictionary<UIMenuItem,MenuLine>();
        }
        readonly UiContext context;
        readonly MenuPool pool = new MenuPool();
        readonly List<UIMenu> menus = new List<UIMenu>();
        readonly UIMenu main, current, roster, character, controls, ai, diagnostics;
        readonly Dictionary<UIMenu,Page> pages = new Dictionary<UIMenu,Page>();
        readonly MenuData data;
        readonly OnscreenKeyboard keyboard = new OnscreenKeyboard();
        readonly HashSet<string> busy = new HashSet<string>(StringComparer.Ordinal);
        readonly UIMenuItem editorItem;
        UIMenu hiddenForKeyboard;
        string selectedCharacterId, currentTitle;
        Page armedPage; UIMenuItem armedItem; MenuLine armedLine; string armedTarget; long armedUntil;
        List<MenuLine> aiLines;
        long nextRender, nextInterest, nextRoster, aiReadAt = -1;
        int dataVersion = -1;
        bool rendering, yielded;
        string aiConfig; bool aiCredential;

        public static IMenuSurface Create(UiContext context) => new NativeMenu(context);
        NativeMenu(UiContext context)
        {
            this.context = context;
            data = new MenuData(context.Companion,context.Clock);
            main = Menu("Main menu");
            current = Menu("Current NPC");
            roster = Menu("Characters");
            character = Menu("Character");
            controls = Menu("Controls");
            ai = Menu("AI and voice");
            diagnostics = Menu("Diagnostics");
            Bind(current,"Current NPC","Status and actions for the NPC Essential has selected.");
            Bind(roster,"Characters","Promoted characters: summon, follow, wait and edit.");
            Bind(controls,"Controls","Gestures, router keys and Essential's own keys.");
            Bind(ai,"AI and voice","The AI companion's settings (read-only here).");
            Bind(diagnostics,"Diagnostics","Native host, command bridge, AI companion and recent failures.");
            editorItem = new UIMenuItem("Character editor","Open this address in a browser for long text and full editing.");
            main.AddItem(editorItem);
            character.ParentMenu = roster;
            foreach (var pair in new[] {("current",current),("roster",roster),("character",character),("controls",controls),("ai",ai),("diagnostics",diagnostics)})
                pages[pair.Item2] = new Page {Name = pair.Item1,Menu = pair.Item2};
        }
        UIMenu Menu(string subtitle)
        {
            var menu = new UIMenu(Title,subtitle);
            menu.MouseControlsEnabled = false; menu.MouseEdgeEnabled = false;
            menu.OnItemSelect += Selected;
            menu.OnCheckboxChange += Toggled;
            menu.OnScrollerChange += Scrolled;
            menu.OnMenuOpen += Opened;
            menu.OnIndexChange += (sender,index) => Disarm();
            menu.OnMenuClose += sender => Disarm();
            pool.Add(menu); menus.Add(menu);
            return menu;
        }
        void Bind(UIMenu child,string text,string description)
        {
            var item = new UIMenuItem(text,description);
            main.AddItem(item); main.BindMenuToItem(child,item);
        }

        // ---- IMenuSurface
        public bool AnyOpen => hiddenForKeyboard != null || keyboard.Active || pool.IsAnyMenuOpen();
        public void Toggle(string page)
        {
            if (keyboard.Active || hiddenForKeyboard != null) return;
            if (pool.IsAnyMenuOpen()) {
                bool switchToCurrent = page == "current" && !current.Visible;
                Disarm(); pool.CloseAllMenus();
                if (!switchToCurrent) return;
            }
            // Another plugin's RNUI menu, such as Essential's F7 menu, owns the
            // controls; with none of ours open, RNUI's cross-plugin flag means theirs.
            if (OtherMenusVisible()) { context.Hud.Show(context.Catalog.Describe("input_busy")); return; }
            // The quick page closes on Back; from the main menu it returns there.
            if (page == "current") current.ParentMenu = null;
            (page == "current" ? current : main).Visible = true;
        }
        bool OtherMenusVisible()
        {
            if (pool.IsAnyMenuOpen()) return false;
            try { return UIMenu.IsAnyMenuVisible; } catch { return false; }
        }
        public void CloseAll()
        {
            Disarm();
            keyboard.Cancel(); hiddenForKeyboard = null;
            pool.CloseAllMenus();
        }
        public void Tick()
        {
            if (keyboard.Active && EssentialTextInputOpen()) {
                // Essential opened its own text input: never read its result as ours.
                keyboard.Abandon(); hiddenForKeyboard = null;
                context.Hud.Show(context.Catalog.Describe("input_busy"));
            }
            keyboard.Tick();
            data.Pump();
            if (!pool.IsAnyMenuOpen()) { yielded = false; return; }
            // RNUI checks the console but not the pause menu; stay hidden while paused.
            if (context.Paused()) return;
            long now = context.Clock.Monotonic;
            if (armedItem != null && now > armedUntil) Disarm();
            if (now >= nextInterest) { context.Bridge.RequestSnapshots(InterestMs); nextInterest = now + InterestIntervalMs; }
            if (YieldToEssential()) return;
            var menu = menus.FirstOrDefault(item => item.Visible);
            if (menu != null && pages.TryGetValue(menu,out var page)) {
                if (data.Version != dataVersion) { dataVersion = data.Version; nextRender = 0; }
                if (now >= nextRender) { Render(page); nextRender = now + RenderIntervalMs; }
                if ((menu == roster || menu == character) && now >= nextRoster) { data.RequestCharacters(); nextRoster = now + RosterRefreshMs; }
            }
            pool.ProcessMenus();
        }
        // Essential's own text input and F7 menu win: two menus must never share
        // the same controls.
        // Needs a fresh runtime snapshot (the P2 bridge). Without one, only opening
        // the menu over another plugin's menu is refused (see Toggle).
        bool YieldToEssential()
        {
            var snapshot = Snapshot(context.Clock.Utc);
            var gates = snapshot?.Gates;
            if (gates == null || !snapshot.Fresh(context.Clock.Utc,InputGates.SnapshotMaxAgeMs) || !(gates.TextInputOpen || gates.ControlsMenuOpen)) return false;
            if (!yielded) { yielded = true; context.Hud.Show(context.Catalog.Describe("input_busy")); }
            CloseAll();
            return true;
        }
        bool EssentialTextInputOpen()
        {
            long utc = context.Clock.Utc;
            var snapshot = Snapshot(utc);
            return snapshot?.Gates != null && snapshot.Fresh(utc,InputGates.SnapshotMaxAgeMs) && snapshot.Gates.TextInputOpen;
        }
        NativeSnapshot Snapshot(long utc) => context.Router()?.Snapshot(utc) ?? NativeSnapshot.Parse(context.Bridge.Snapshot());
        CharacterRow Row() => selectedCharacterId == null ? null : data.Characters?.FirstOrDefault(item => item.CharacterId == selectedCharacterId);

        // ---- Events
        void Opened(UIMenu menu)
        {
            if (rendering) return;
            long now = context.Clock.Monotonic;
            context.Bridge.RequestSnapshots(InterestMs); nextInterest = now + InterestIntervalMs;
            if (!data.CompanionReachable) data.Probe();
            if (menu == main) { editorItem.RightLabel = Plain(EditorAddress()); current.ParentMenu = main; return; }
            if (!pages.TryGetValue(menu,out var page)) return;
            Invalidate(page);
            if (menu == roster || menu == character) { data.RequestCharacters(); nextRoster = now + RosterRefreshMs; }
            if (menu == ai) aiReadAt = -1;
        }
        void Selected(UIMenu sender,UIMenuItem item,int index)
        {
            if (rendering || !pages.TryGetValue(sender,out var page) || !page.Lines.TryGetValue(item,out var line) || line.Info || !line.Enabled || line.Toggle) return;
            if (line.Options != null) { SaveChoice(page,item,line); return; }
            if (line.Command == null || line.Command.StartsWith("local.",StringComparison.Ordinal)) { Local(page,line); return; }
            if (line.Command == CommandCatalog.CharacterRename || line.Command == CommandCatalog.CharacterMemoryAdd) { TypeText(page,line); return; }
            if (line.Confirm && !(armedItem == item && context.Clock.Monotonic <= armedUntil)) { Arm(page,item,line); return; }
            // The second select must still mean the same NPC or character.
            if (line.Confirm && armedTarget != Target(page)) { Disarm(); context.Hud.Show(context.Catalog.Describe("target_changed")); return; }
            Disarm();
            Run(page,line,new CommandArgs());
        }
        void Toggled(UIMenu sender,UIMenuCheckboxItem item,bool on)
        {
            if (rendering || !pages.TryGetValue(sender,out var page) || !page.Lines.TryGetValue(item,out var line) || !line.Toggle) return;
            Disarm();
            if (line.Command == ControlsView.GesturesCommand) {
                var router = context.Router();
                if (router != null) router.GesturesPaused = !on;
                Invalidate(page); return;
            }
            if (line.Command == CommandCatalog.CharacterMemorySelect) Run(page,line,new CommandArgs {MemoryId = line.Key.Substring("memory:".Length),Flag = on});
        }
        void Scrolled(UIMenu sender,UIMenuScrollerItem item,int oldIndex,int newIndex)
        {
            if (rendering || !pages.TryGetValue(sender,out var page) || !page.Lines.TryGetValue(item,out var line) || line.Options == null) return;
            Disarm();
            // The chord window is session-local and applies at once; character
            // fields are saved only when the player selects the row.
            if (line.Command == ControlsView.ChordWindowCommand && newIndex >= 0 && newIndex < line.Options.Length
                && int.TryParse(line.Options[newIndex],NumberStyles.None,CultureInfo.InvariantCulture,out int window)) context.Router()?.SetSessionChordWindow(window);
        }

        // ---- Actions
        void SaveChoice(Page page,UIMenuItem item,MenuLine line)
        {
            if (line.Command == ControlsView.ChordWindowCommand || !(item is UIMenuListScrollerItem<string> scroller)) return;
            int index = scroller.Index;
            if (index < 0 || index >= line.Options.Length || line.Options[index] == line.Value) return;
            var args = new CommandArgs {Value = line.Options[index]};
            // The relationship patch replaces state and description together.
            if (line.Command == CommandCatalog.CharacterRelationship) args.Text = Row()?.RelationshipDescription ?? "";
            Run(page,line,args);
        }
        void Local(Page page,MenuLine line)
        {
            switch (line.Command ?? line.Key) {
                case LocalOpenCharacter: OpenCharacter(line.Value,page.Menu); break;
                case LocalRefresh: case "refresh":
                    if (page.Menu == roster || page.Menu == character) data.RequestCharacters();
                    data.Probe(); aiReadAt = -1; Invalidate(page); break;
                case "log": context.Log("[UX] diagnostics " + string.Join("; ",DiagnosticsLines().Where(item => item.Info).Select(item => item.Text + "=" + item.Right))); context.Hud.Show("Diagnostics written to RagePluginHook.log"); break;
            }
        }
        void OpenCharacter(string characterId,UIMenu from)
        {
            if (characterId == null) return;
            selectedCharacterId = characterId;
            var page = pages[character]; page.ResetSelection = true; Invalidate(page);
            Disarm();
            from.Visible = false;
            character.ParentMenu = from;
            character.Visible = true;
        }
        void TypeText(Page page,MenuLine line)
        {
            var row = Row(); if (row == null) return;
            bool rename = line.Command == CommandCatalog.CharacterRename;
            string characterId = row.CharacterId;
            Disarm();
            // Open the keyboard first: if that fails the menu simply stays visible.
            try {
                keyboard.Open(rename ? row.Name : "",rename ? MaxNameChars : OnscreenKeyboard.MaxLength,text => {
                    var menu = hiddenForKeyboard; hiddenForKeyboard = null;
                    if (menu != null) menu.Visible = true;
                    if (text == null || Row()?.CharacterId != characterId) return;
                    Run(page,line,new CommandArgs {Text = text});
                });
            } catch { context.Hud.Show(context.Catalog.Describe("menu_unavailable")); return; }
            hiddenForKeyboard = page.Menu; page.Menu.Visible = false;
        }
        void Run(Page page,MenuLine line,CommandArgs args)
        {
            if (page.Menu == character) {
                var row = Row();
                if (row == null) return;
                args.CharacterId = row.CharacterId; args.ExpectedRevision = row.Revision;
            }
            string key = BusyKey(page,line);
            busy.Add(key); Invalidate(page);
            args.OnDone = (reason,body) => { busy.Remove(key); Invalidate(page); Completed(line,reason,body); };
            context.Dispatcher.Dispatch(line.Command,"menu",args);
        }
        void Completed(MenuLine line,string reason,string body)
        {
            switch (line.Command) {
                case CommandCatalog.CharacterRename: case CommandCatalog.CharacterRelationship: case CommandCatalog.CharacterAvailability:
                case CommandCatalog.CharacterMemorySelect: case CommandCatalog.CharacterMemoryAdd:
                    // The reply carries the new revision; anything else reloads the roster.
                    if (reason != null) data.RequestCharacters(); else data.ApplyReply(body);
                    break;
                case CommandCatalog.CharacterSummon: case CommandCatalog.CharacterFollow: case CommandCatalog.CharacterWait:
                case CommandCatalog.CharacterDismiss: case CommandCatalog.CharacterDespawn: case CommandCatalog.CurrentPromote:
                    data.RequestCharacters();
                    break;
            }
        }
        string BusyKey(Page page,MenuLine line) => page.Name + ":" + (page.Menu == character ? selectedCharacterId : "") + ":" + line.Key;
        void Arm(Page page,UIMenuItem item,MenuLine line)
        {
            Disarm();
            armedPage = page; armedItem = item; armedLine = line; armedTarget = Target(page); armedUntil = context.Clock.Monotonic + ConfirmWindowMs;
            item.Text = "Confirm: " + Plain(line.Text);
            item.Description = Plain(ConfirmText(page,line));
        }
        void Disarm()
        {
            if (armedItem != null && armedLine != null) { armedItem.Text = Plain(armedLine.Text); armedItem.Description = Plain(armedLine.Description); }
            armedPage = null; armedItem = null; armedLine = null; armedTarget = null;
        }
        // What a confirmation is about: Essential's current NPC right now, or the
        // character page's character.
        string Target(Page page)
        {
            if (page.Menu == character) return "character:" + selectedCharacterId;
            long utc = context.Clock.Utc;
            var snapshot = Snapshot(utc);
            var npc = snapshot != null && snapshot.Fresh(utc,InputGates.SnapshotMaxAgeMs) ? snapshot.Current : null;
            return "npc:" + (npc != null && npc.Present ? npc.EncounterId + "|" + npc.OwnerAlias : "none");
        }
        string ConfirmText(Page page,MenuLine line)
        {
            string verb = line.Text.ToLowerInvariant();
            if (page.Menu == character) {
                var row = Row();
                return row == null ? "Select again within 4 seconds to confirm." : "Select again within 4 seconds to " + verb + " " + row.Name + " (…" + row.IdSuffix + ").";
            }
            return "Select again within 4 seconds to " + verb + " " + (currentTitle ?? "this NPC") + ".";
        }

        // ---- Rendering
        void Invalidate(Page page) { page.Signature = null; nextRender = 0; }
        void Render(Page page)
        {
            var lines = Build(page,out string subtitle);
            foreach (var line in lines)
                if (line.Command != null && busy.Contains(BusyKey(page,line))) { line.Right = "Working…"; line.Enabled = false; line.Toggle = false; line.Options = null; }
            string signature = subtitle + "#" + string.Join("#",lines.Select(line => line.Signature));
            if (signature == page.Signature) return;
            rendering = true;
            try {
                string selectedKey = null;
                int selection = page.Menu.CurrentSelection;
                if (selection >= 0 && selection < page.Menu.MenuItems.Count && page.Lines.TryGetValue(page.Menu.MenuItems[selection],out var selected)) selectedKey = selected.Key;
                if (armedPage == page) Disarm();
                page.Menu.Clear(); page.Lines.Clear();
                page.Menu.SubtitleText = Plain(subtitle);
                int target = -1;
                foreach (var line in lines) {
                    var item = Item(line);
                    page.Menu.AddItem(item); page.Lines[item] = line;
                    if (line.Key == selectedKey) target = page.Menu.MenuItems.Count - 1;
                }
                if (page.Menu.MenuItems.Count > 0) page.Menu.CurrentSelection = page.ResetSelection || target < 0 ? 0 : target;
                page.ResetSelection = false;
                page.Signature = signature;
            } finally { rendering = false; }
        }
        static UIMenuItem Item(MenuLine line)
        {
            string text = Plain(line.Text), description = Plain(line.Description);
            if (line.Toggle) return new UIMenuCheckboxItem(text,line.Value == "on",description) {Enabled = line.Enabled};
            if (line.Options != null) {
                var scroller = new UIMenuListScrollerItem<string>(text,description,(line.OptionLabels ?? line.Options).Select(Plain)) {Enabled = line.Enabled};
                int index = Array.IndexOf(line.Options,line.Value);
                scroller.Index = index < 0 ? 0 : index;
                return scroller;
            }
            var item = new UIMenuItem(text,description) {Enabled = line.Enabled || line.Info};
            if (!string.IsNullOrEmpty(line.Right)) item.RightLabel = Plain(line.Right);
            return item;
        }
        List<MenuLine> Build(Page page,out string subtitle)
        {
            var settings = context.Settings();
            long utc = context.Clock.Utc;
            if (page.Menu == current) {
                var snapshot = Snapshot(utc);
                var npc = snapshot != null && snapshot.Fresh(utc,InputGates.SnapshotMaxAgeMs) ? snapshot.Current : null;
                string alias = npc != null && npc.Owned ? npc.OwnerAlias : null;
                if (npc != null && npc.Present) data.RequestDescribe(npc.EncounterId,alias);
                var describe = npc != null && npc.Present ? data.DescribeFor(npc.EncounterId,alias) : null;
                var model = CurrentNpcView.Build(snapshot,utc,describe,context.Bridge.Available,data.CompanionReachable,settings);
                currentTitle = model.Present ? model.Title : null;
                if (model.Owned && describe != null && describe.Kind == "promoted" && describe.CharacterId != null)
                    model.Lines.Add(new MenuLine {Key = "details",Text = "Character details",Command = LocalOpenCharacter,Value = describe.CharacterId,Description = "Rename, relationship, availability and memories."});
                subtitle = model.Title;
                return model.Lines;
            }
            if (page.Menu == roster) {
                subtitle = "Characters";
                var lines = new List<MenuLine>();
                if (data.CharactersError != null) lines.Add(MenuLine.Fact("error",data.Characters == null ? "Characters unavailable" : "Last refresh failed",context.Catalog.Describe(data.CharactersError),"The AI companion must be running with promoted characters enabled."));
                if (data.Characters == null) { if (data.CharactersError == null) lines.Add(MenuLine.Fact("loading","Loading characters…","")); }
                else if (data.Characters.Count == 0) lines.Add(MenuLine.Fact("empty","No promoted characters yet","","Promote an NPC from the Current NPC page."));
                else foreach (var row in data.Characters)
                    lines.Add(new MenuLine {Key = "character:" + row.CharacterId,Text = row.Name,Right = row.StatusLabel,Command = LocalOpenCharacter,Value = row.CharacterId,
                        Description = CurrentNpcView.Capitalize(row.RelationshipState ?? "associate") + " · " + row.Memories.Count + " memories · …" + row.IdSuffix});
                lines.Add(MenuLine.Action("refresh","Refresh",LocalRefresh,"Reload the list from the AI companion."));
                return lines;
            }
            if (page.Menu == character) {
                var row = Row();
                if (row == null) {
                    subtitle = "Character";
                    return new List<MenuLine> {data.Characters == null ? MenuLine.Fact("loading","Loading character…","") : MenuLine.Fact("missing","Character not found","","It may have been removed in the character editor.")};
                }
                subtitle = row.Name;
                return CharacterList.Actions(row,data.CompanionReachable,context.Bridge.Available);
            }
            if (page.Menu == controls) {
                subtitle = "Controls";
                var router = context.Router();
                return ControlsView.Build(settings,context.Essential(),router?.State ?? "disabled",router?.Conflict,router?.GesturesPaused ?? false,router?.ChordWindowMs ?? GestureTiming.Default.ChordWindowMs,router?.ActiveBindings ?? new GestureBinding[0]);
            }
            if (page.Menu == ai) {
                subtitle = "AI and voice";
                long now = context.Clock.Monotonic;
                if (aiLines == null || aiReadAt < 0 || now - aiReadAt >= AiReadIntervalMs) { aiReadAt = now; ReadAiConfig(); aiLines = AiVoiceView.Build(aiConfig,aiCredential); }
                return new List<MenuLine>(aiLines);
            }
            subtitle = "Diagnostics";
            return DiagnosticsLines();
        }
        List<MenuLine> DiagnosticsLines()
        {
            var router = context.Router();
            long utc = context.Clock.Utc;
            var snapshot = Snapshot(utc);
            return DiagnosticsView.Build(new DiagnosticsInput {
                HostStatus = context.HostStatus(),RouterState = router?.State,Conflict = router?.Conflict,SettingsRevision = context.Settings()?.Revision,
                EndpointState = context.EndpointState(),CatalogSha = context.Catalog.Sha256,BridgeAvailable = context.Bridge.Available,CompanionReachable = data.CompanionReachable,
                SnapshotAgeMs = snapshot == null ? -1 : Math.Max(0,utc - snapshot.BuiltAtUtc),Outstanding = context.Dispatcher.Outstanding,RecentReasons = context.Dispatcher.RecentReasons});
        }
        // Public companion settings only; the credential file is checked for
        // presence and never opened.
        void ReadAiConfig()
        {
            string server = Path.Combine(context.PluginsPath ?? "","LosSantosAliveServer");
            try { var info = new FileInfo(Path.Combine(server,"e1.config.json")); aiConfig = info.Exists && info.Length <= MaxConfigBytes ? File.ReadAllText(info.FullName) : null; } catch { aiConfig = null; }
            try { aiCredential = File.Exists(Path.Combine(server,".env")); } catch { aiCredential = false; }
        }
        string EditorAddress()
        {
            string origin = context.Origin();
            return origin != null && origin.StartsWith("http://",StringComparison.Ordinal) ? origin.Substring(7) : "Unavailable";
        }
        // Names and descriptions can come from saved profiles; keep GTA's ~
        // formatting codes and control characters out of menu text.
        static string Plain(string text) => text == null ? "" : new string(text.Select(c => c == '~' ? '-' : char.IsControl(c) ? ' ' : c).ToArray());
    }
}
