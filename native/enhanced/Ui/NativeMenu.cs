using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Web.Script.Serialization;
using LSA.Enhanced.Commands;
using LSA.Enhanced.Input;
using LSA.Enhanced.Settings;
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
        readonly UIMenu quick, main, current, roster, character, controls, ai, diagnostics, activities, navigation, director, settingsPage, vehicleHud;
        readonly UIMenu cheatMenu, cheatVehicles, cheatFavorites, cheatPlayer, vehicleSearch;
        readonly VehicleFavorites favorites;
        readonly VehicleCatalog catalog;
        string vehicleQuery = "", selectedVehicleModel;
        int vehicleResultPage;
        readonly VehicleCheats cheats;
        readonly Dictionary<UIMenu,Page> pages = new Dictionary<UIMenu,Page>();
        readonly MenuData data;
        readonly OnscreenKeyboard keyboard = new OnscreenKeyboard();
        readonly HashSet<string> busy = new HashSet<string>(StringComparer.Ordinal);
        readonly UIMenuItem editorItem;
        UIMenu hiddenForKeyboard;
        string selectedCharacterId, currentTitle, activityTargetEncounterId, activityTargetOwnerAlias;
        CharacterActivityBinding navigationBinding, activityTargetBinding;
        Page armedPage; UIMenuItem armedItem; MenuLine armedLine; string armedTarget; long armedUntil;
        List<MenuLine> aiLines;
        long nextRender, nextInterest, nextRoster, nextReadiness, nextDirectorPoll, nextBinding, aiReadAt = -1;
        long directorBefore = -1;
        bool directorPending;
        string lastCharacterPresence;
        int dataVersion = -1;
        bool rendering, yielded;
        string aiConfig; bool aiCredential;

        public static IMenuSurface Create(UiContext context) => new NativeMenu(context);
        NativeMenu(UiContext context)
        {
            this.context = context;
            data = new MenuData(context.Companion,context.Clock);
            favorites = new VehicleFavorites(context.PluginsPath);
            catalog = new VehicleCatalog(context.PluginsPath,favorites);
            cheats = new VehicleCheats(context.Log);
            quick = Menu("Quick Controls");
            main = Menu("All tools & settings");
            main.ParentMenu = quick;
            current = Menu("Current NPC");
            roster = Menu("Characters");
            character = Menu("Character");
            controls = Menu("Gameplay Controls");
            ai = Menu("AI and voice");
            diagnostics = Menu("Diagnostics");
            activities = Menu("Assign Activity");
            navigation = Menu("Activities & Navigation");
            director = Menu("Director & Social");
            settingsPage = Menu("Settings / Browser Editor");
            cheatMenu = Menu("Cheat Menu");
            cheatVehicles = Menu("Vehicle Options");
            cheatFavorites = Menu("Vehicle Favorites");
            cheatPlayer = Menu("Player Options");
            vehicleSearch = Menu("Vehicle Search");
            vehicleHud = Menu("Vehicle Diagnostics");
            Bind(cheatMenu,"Cheat Menu","Local single-player gameplay tools; no AI required.");
            Bind(cheatVehicles,"Vehicle Options","Repair, spawn and manage cars.",cheatMenu);
            cheatFavorites.ParentMenu = cheatVehicles; // Dynamic parent items are rebuilt by Render; navigate through a local action.
            vehicleSearch.ParentMenu = cheatVehicles;
            vehicleHud.ParentMenu = cheatVehicles; // Opened using a local action, so menu refresh retains navigation.
            Bind(cheatPlayer,"Player Options","Health, armor, wanted and invincibility.",cheatMenu);
            Bind(current,"Current NPC","Status and actions for the NPC Essential has selected.");
            Bind(roster,"My Characters","Select a promoted character, summon, dismiss or manage gameplay.");
            Bind(navigation,"Activities & Navigation","ACT activity status, control and navigation readiness.");
            Bind(director,"Director & Social","Manual social scenes, availability and admission feedback.");
            Bind(controls,"Gameplay Controls","Gestures, router keys and Essential's own keys.");
            Bind(diagnostics,"Diagnostics","Native host, command bridge, AI companion and recent failures.");
            Bind(settingsPage,"Settings / Browser Editor","Full character and memory editing, AI providers and configuration.");
            Bind(ai,"AI and voice","Read-only companion configuration.",settingsPage);
            editorItem = new UIMenuItem("Browser editor","Open this address in a browser for character editing and configuration.");
            settingsPage.AddItem(editorItem);
            character.ParentMenu = roster;
            activities.ParentMenu = current;
            foreach (var pair in new[] {("quick",quick),("current",current),("roster",roster),("character",character),("controls",controls),("ai",ai),("diagnostics",diagnostics),("activities",activities),("navigation",navigation),("director",director),("cheatVehicles",cheatVehicles),("cheatFavorites",cheatFavorites),("cheatPlayer",cheatPlayer),("vehicleSearch",vehicleSearch),("vehicleHud",vehicleHud)})
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
        void Bind(UIMenu child,string text,string description,UIMenu parent = null)
        {
            var host = parent ?? main;
            var item = new UIMenuItem(text,description);
            host.AddItem(item); host.BindMenuToItem(child,item);
        }

        // ---- IMenuSurface
        public bool AnyOpen => hiddenForKeyboard != null || keyboard.Active || pool.IsAnyMenuOpen();
        public void Toggle(string page)
        {
            if (keyboard.Active || hiddenForKeyboard != null) return;
            if (pool.IsAnyMenuOpen()) {
                // F11 and controller L4+R4 use the same quick root; either
                // shortcut closes our menu safely, regardless of subpage.
                Disarm(); pool.CloseAllMenus(); return;
            }
            // Another plugin's RNUI menu, such as Essential's F7 menu, owns the
            // controls; with none of ours open, RNUI's cross-plugin flag means theirs.
            if (OtherMenusVisible()) { context.Hud.Show(context.Catalog.Describe("input_busy")); return; }
            // Keep explicit legacy 'current' entrypoint, but both shortcuts open quick.
            if (page == "current") {
                current.ParentMenu = quick;
                current.Visible = true;
            } else quick.Visible = true;
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
                if ((menu == roster || menu == character) && now >= nextRoster) {
                    data.RequestCharacters(); nextRoster = now + RosterRefreshMs;
                }
                if ((menu == character || menu == navigation && navigationBinding != null) && now >= nextBinding) {
                    data.RequestCharacterBinding(menu == character ? selectedCharacterId : navigationBinding.CharacterId);
                    nextBinding = now + AiReadIntervalMs;
                }
                if (menu == navigation && now >= nextReadiness) { data.RequestActivityReadiness(); nextReadiness = now + AiReadIntervalMs; }
                if (menu == director && now >= nextDirectorPoll) { data.RequestDirectorStatus(); nextDirectorPoll = now + 1500; }
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
            if (menu == main) { current.ParentMenu = main; navigationBinding = null; navigation.ParentMenu = main; return; }
            if (menu == settingsPage) { editorItem.RightLabel = Plain(EditorAddress()); return; }
            if (!pages.TryGetValue(menu,out var page)) return;
            Invalidate(page);
            if (menu == roster || menu == character || ((menu == current || menu == navigation) && data.Characters == null)) { data.RequestCharacters(); nextRoster = now + RosterRefreshMs; }
            if (menu == character && selectedCharacterId != null) { data.RequestCharacterBinding(selectedCharacterId); nextBinding = now + AiReadIntervalMs; }
            if (menu == navigation && navigationBinding != null) { data.RequestCharacterBinding(navigationBinding.CharacterId); nextBinding = now + AiReadIntervalMs; }
            if (menu == navigation) { data.RequestActivityReadiness(); nextReadiness = now + AiReadIntervalMs; }
            if (menu == director) { data.RequestDirectorStatus(); nextDirectorPoll = now + 1500; }
            if (menu == ai) aiReadAt = -1;
        }
        void Selected(UIMenu sender,UIMenuItem item,int index)
        {
            if (rendering || !pages.TryGetValue(sender,out var page) || !page.Lines.TryGetValue(item,out var line) || line.Info || !line.Enabled || line.Toggle) return;
            if (line.Options != null) { SaveChoice(page,item,line); return; }
            if (line.Command != null && line.Command.StartsWith("cheat.",StringComparison.Ordinal)) {
                if (line.Confirm && !(armedItem == item && context.Clock.Monotonic <= armedUntil)) { Arm(page,item,line); return; }
                Disarm(); Cheat(page,line); return;
            }
            if (line.Command == null || line.Command.StartsWith("local.",StringComparison.Ordinal)) { Local(page,line); return; }
            if (line.Command == CommandCatalog.CharacterRename || line.Command == CommandCatalog.CharacterMemoryAdd) { TypeText(page,line); return; }
            if (line.Command == CommandCatalog.DirectorSocialManual) {
                directorBefore = data.DirectorStatus?.ReceivedAt ?? -1;
                directorPending = true;
            }
            if (line.Confirm && !(armedItem == item && context.Clock.Monotonic <= armedUntil)) { Arm(page,item,line); return; }
            // The second select must still mean the same NPC or character.
            if (line.Confirm && armedTarget != Target(page)) { Disarm(); context.Hud.Show(context.Catalog.Describe("target_changed")); return; }
            Disarm();
            var args = new CommandArgs();
            if (line.Command == CommandCatalog.ActivityAssign) args.Value = line.Value;
            Run(page,line,args);
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
            if (line.Command == "local.vehicleSearchSelect" && newIndex >= 0 && newIndex < line.Options.Length) {
                selectedVehicleModel = line.Options[newIndex];
                Invalidate(page);
                return;
            }
            if (line.Command == ControlsView.ChordWindowCommand && newIndex >= 0 && newIndex < line.Options.Length
                && int.TryParse(line.Options[newIndex],NumberStyles.None,CultureInfo.InvariantCulture,out int window)) context.Router()?.SetSessionChordWindow(window);
        }

        // ---- Actions
        void SaveChoice(Page page,UIMenuItem item,MenuLine line)
        {
            if (line.Command == ControlsView.ChordWindowCommand || !(item is UIMenuListScrollerItem<string> scroller)) return;
            if (line.Command == "local.vehicleSearchSelect") {
                int selected = scroller.Index;
                if (selected >= 0 && selected < line.Options.Length) {
                    selectedVehicleModel = line.Options[selected]; Invalidate(page);
                }
                return;
            }
            if (line.Command == "local.vehicleHudMode") {
                int choice = scroller.Index;
                if (choice >= 0 && choice < line.Options.Length) { context.SetVehicleHudMode(line.Options[choice]); Invalidate(page); }
                return;
            }
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
                case "local.openAdvanced":
                    main.ParentMenu = quick;
                    page.Menu.Visible = false; main.Visible = true; break;
                case "local.openQuickCurrent":
                    current.ParentMenu = quick; Invalidate(pages[current]);
                    page.Menu.Visible = false; current.Visible = true; break;
                case "local.vehicleLogToggle":
                    context.SetVehicleTelemetryLogging(!context.VehicleTelemetryLogging());
                    context.Hud.Show(context.VehicleTelemetryLogging() ? "Vehicle CSV logging enabled" : "Vehicle CSV logging disabled");
                    Invalidate(page); break;
                case "local.openVehicleHud":
                    vehicleHud.ParentMenu = page.Menu;
                    Invalidate(pages[vehicleHud]);
                    page.Menu.Visible = false; vehicleHud.Visible = true; break;
                case "local.openVehicleSearch":
                    vehicleSearch.ParentMenu = page.Menu;
                    Invalidate(pages[vehicleSearch]);
                    page.Menu.Visible = false; vehicleSearch.Visible = true; break;
                case "local.vehicleSearchText":
                    try {
                        keyboard.Open(vehicleQuery,48,value => {
                            var prior = hiddenForKeyboard; hiddenForKeyboard = null;
                            if (prior != null) prior.Visible = true;
                            if (value == null) return;
                            vehicleQuery = value.Trim(); vehicleResultPage = 0;
                            selectedVehicleModel = null; Invalidate(pages[vehicleSearch]);
                        });
                        hiddenForKeyboard = page.Menu; page.Menu.Visible = false;
                    } catch { context.Hud.Show("Vehicle search input unavailable"); }
                    break;
                case "local.vehicleSearchReset":
                    vehicleQuery = ""; vehicleResultPage = 0; selectedVehicleModel = null;
                    Invalidate(pages[vehicleSearch]); break;
                case "local.vehicleSearchPrev":
                    vehicleResultPage = Math.Max(0,vehicleResultPage - 1);
                    selectedVehicleModel = null; Invalidate(pages[vehicleSearch]); break;
                case "local.vehicleSearchNext":
                    vehicleResultPage = Math.Min(catalog.Search(vehicleQuery,vehicleResultPage).Pages - 1,vehicleResultPage + 1);
                    selectedVehicleModel = null; Invalidate(pages[vehicleSearch]); break;
                case "local.openCheatFavorites":
                    cheatFavorites.ParentMenu = page.Menu;
                    Invalidate(pages[cheatFavorites]);
                    page.Menu.Visible = false; cheatFavorites.Visible = true; break;
                case "local.openDirector":
                    director.ParentMenu = page.Menu; Invalidate(pages[director]);
                    page.Menu.Visible = false; director.Visible = true; break;
                case "local.openNavigation":
                    if (page.Menu == character) {
                        var original = data.CharacterBinding;
                        if (original == null || !original.Safe || original.CharacterId != selectedCharacterId ||
                            original.EncounterId != line.ExpectedEncounterId || original.OwnershipToken != line.ExpectedOwnershipToken) {
                            context.Hud.Show(context.Catalog.Describe("target_changed")); break;
                        }
                        navigationBinding = original;
                    } else navigationBinding = null;
                    navigation.ParentMenu = page.Menu; Invalidate(pages[navigation]);
                    page.Menu.Visible = false; navigation.Visible = true; break;
                case "local.openActivities":
                    activityTargetEncounterId = line.ExpectedEncounterId;
                    activityTargetOwnerAlias = line.ExpectedOwnerAlias;
                    activityTargetBinding = line.BindingCharacterId != null ? navigationBinding : null;
                    if (activityTargetEncounterId == null || activityTargetBinding != null &&
                        (activityTargetBinding.CharacterId != line.BindingCharacterId || activityTargetBinding.OwnershipToken != line.ExpectedOwnershipToken)) {
                        context.Hud.Show(context.Catalog.Describe("target_changed")); break;
                    }
                    activities.ParentMenu = page.Menu; Invalidate(pages[activities]);
                    page.Menu.Visible = false; activities.Visible = true; break;
                case LocalRefresh: case "refresh":
                    if (page.Menu == roster || page.Menu == character) data.RequestCharacters();
                    if (page.Menu == character || page.Menu == navigation && navigationBinding != null) data.RequestCharacterBinding(page.Menu == character ? selectedCharacterId : navigationBinding.CharacterId);
                    if (page.Menu == director) data.RequestDirectorStatus();
                    if (page.Menu == navigation) data.RequestActivityReadiness();
                    data.Probe(); aiReadAt = -1; Invalidate(page); break;
                case "log": context.Log("[UX] diagnostics " + string.Join("; ",DiagnosticsLines().Where(item => item.Info).Select(item => item.Text + "=" + item.Right))); context.Hud.Show("Diagnostics written to RagePluginHook.log"); break;
                case CurrentNpcView.ClearTalkCommand: context.ClearTalkTarget(); Invalidate(page); break;
            }
        }
        void Cheat(Page page,MenuLine line)
        {
            string cmd = line.Command.Substring("cheat.".Length);
            if (cmd == "spawn" || cmd == "addFavorite" || cmd == "addCatalog") {
                try {
                    keyboard.Open("",32,value => {
                        var prior = hiddenForKeyboard; hiddenForKeyboard = null;
                        if (prior != null) prior.Visible = true;
                        if (value == null) return;
                        string result = cmd == "spawn" ? cheats.Spawn(value) :
                            cmd == "addFavorite" ? (favorites.Add(value) ? "Favorite added" : "Invalid/duplicate favorite or file not writable") :
                            !cheats.IsVehicleModel(value) ? "Model not installed as a vehicle" :
                            (catalog.AddCustom(value) ? "Addon model added to search" : "Already listed, invalid, full or not writable");
                        if (cmd == "addCatalog" && result == "Addon model added to search") {
                            vehicleQuery = value.Trim(); vehicleResultPage = 0; selectedVehicleModel = null;
                            Invalidate(pages[vehicleSearch]);
                        }
                        context.Hud.Show(result);
                        Invalidate(page);
                    });
                    hiddenForKeyboard = page.Menu; page.Menu.Visible = false;
                } catch { context.Hud.Show("Vehicle input unavailable"); }
                return;
            }
            string message;
            switch (cmd) {
                case "saveCurrent": {
                    string model = cheats.CurrentModel();
                    message = model == null ? "Current vehicle model unknown" :
                        (favorites.Add(model) ? "Favorite saved: " + model : "Duplicate, full or file not writable");
                    break;
                }
                case "spawnFavorite": message = cheats.Spawn(line.Value); break;
                case "spawnSearch": message = selectedVehicleModel == null ? "Select a result first" : cheats.Spawn(selectedVehicleModel); break;
                case "favoriteSearch": message = selectedVehicleModel == null ? "Select a result first" :
                    favorites.Add(selectedVehicleModel) ? "Favorite saved: " + selectedVehicleModel : "Already favorited, full or not writable"; break;
                case "removeFavorite": message = favorites.Remove(line.Value) ? "Favorite removed: " + line.Value : "Could not remove favorite"; break;
                default: message = cheats.Apply(cmd); break;
            }
            context.Hud.Show(message);
            Invalidate(page);
            if (cmd == "removeFavorite") Invalidate(pages[cheatFavorites]);
        }
        void OpenCharacter(string characterId,UIMenu from)
        {
            if (characterId == null) return;
            selectedCharacterId = characterId;
            data.RequestCharacterBinding(characterId);
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
            args.ExpectedEncounterId = line.ExpectedEncounterId;
            args.ExpectedOwnerAlias = line.ExpectedOwnerAlias;
            args.ExpectedOwnershipToken = line.ExpectedOwnershipToken;
            if (line.BindingCharacterId != null) args.CharacterId = line.BindingCharacterId;
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
                case CommandCatalog.DirectorSocialManual:
                    if (reason != null) directorPending = false;
                    else data.RequestDirectorStatus();
                    break;
                case CommandCatalog.CharacterRename: case CommandCatalog.CharacterRelationship: case CommandCatalog.CharacterAvailability:
                case CommandCatalog.CharacterMemorySelect: case CommandCatalog.CharacterMemoryAdd:
                    // The reply carries the new revision; anything else reloads the roster.
                    if (reason != null) data.RequestCharacters(); else data.ApplyReply(body);
                    break;
                case CommandCatalog.CharacterSummon: case CommandCatalog.CharacterFollow: case CommandCatalog.CharacterWait:
                case CommandCatalog.CharacterDismiss: case CommandCatalog.CharacterDespawn: case CommandCatalog.CurrentPromote:
                    // Force fresh native evidence after spawn/follow/retirement.
                    // A stale pre-spawn roster response cannot consume this refresh.
                    data.InvalidateCharacterBinding();
                    data.RequestCharacters(refreshAfterInFlight:true);
                    if (selectedCharacterId != null) data.RequestCharacterBinding(selectedCharacterId);
                    nextRoster = 0; nextBinding = 0;
                    break;
                case CommandCatalog.ActivityAssign: case CommandCatalog.ActivityPause: case CommandCatalog.ActivityResume: case CommandCatalog.ActivityCancel:
                    RefreshActivityDescribe();
                    break;
                case CommandCatalog.ActivityStatus:
                    if (reason == null) context.Hud.Show(ActivityReply(body,false));
                    RefreshActivityDescribe();
                    break;
                case CommandCatalog.ActivityHistory:
                    if (reason == null) context.Hud.Show(ActivityReply(body,true));
                    RefreshActivityDescribe();
                    break;
            }
        }
        void RefreshActivityDescribe()
        {
            var snapshot = Snapshot(context.Clock.Utc);
            var npc = snapshot?.Current;
            if (npc != null && npc.Present) data.RequestDescribe(npc.EncounterId,npc.OwnerAlias,true);
        }
        static string ActivityReply(string body,bool history)
        {
            try {
                var root = new JavaScriptSerializer {MaxJsonLength = 32768,RecursionLimit = 8}.DeserializeObject(body ?? "") as Dictionary<string,object>;
                if (root == null) return history ? "No activity history" : "No activity";
                if (!history) {
                    if (root.TryGetValue("phrase",out var phraseValue) && phraseValue is string phrase && phrase.Length > 0 && phrase.Length <= 160 && !phrase.Any(char.IsControl)) return Plain(phrase);
                    var intent = root.TryGetValue("activity",out var intentValue) ? intentValue as string : null;
                    var status = root.TryGetValue("status",out var statusValue) ? statusValue as string : null;
                    var reason = root.TryGetValue("reason",out var reasonValue) ? reasonValue as string : null;
                    if (intent == null) return "No activity";
                    var text = CurrentNpcView.ActivityLabel(intent) + ": " + CurrentNpcView.ActivityLabel(status);
                    if (reason != null) text += " (" + reason.Replace('_',' ') + ")";
                    return Plain(text);
                }
                if (!(root.TryGetValue("history",out var historyValue) && historyValue is object[] rows) || rows.Length == 0) return "No activity history";
                var items = rows.OfType<Dictionary<string,object>>().Reverse().Take(3).Select(row => {
                    var intent = row.TryGetValue("intent",out var intentValue) ? intentValue as string : null;
                    var status = row.TryGetValue("status",out var statusValue) ? statusValue as string : null;
                    return CurrentNpcView.ActivityLabel(intent) + " — " + CurrentNpcView.ActivityLabel(status);
                }).ToArray();
                return items.Length == 0 ? "No activity history" : Plain("Recent: " + string.Join("; ",items));
            } catch { return history ? "No activity history" : "No activity"; }
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
            if (page.Menu == activities) return activityTargetBinding != null
                ? "character:" + activityTargetBinding.CharacterId + "|" + activityTargetBinding.EncounterId + "|" + activityTargetBinding.OwnershipToken
                : "npc:" + activityTargetEncounterId + "|" + activityTargetOwnerAlias;
            if (page.Menu == navigation && navigationBinding != null) return "character:" + navigationBinding.CharacterId + "|" + navigationBinding.EncounterId + "|" + navigationBinding.OwnershipToken;
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
        CurrentNpcModel LiveNpcModel(long utc,EnhancedSettings settings)
        {
            var snapshot = Snapshot(utc);
            var npc = snapshot != null && snapshot.Fresh(utc,InputGates.SnapshotMaxAgeMs) ? snapshot.Current : null;
            string alias = npc != null && npc.Owned ? npc.OwnerAlias : null;
            if (npc != null && npc.Present) data.RequestDescribe(npc.EncounterId,alias);
            var describe = npc != null && npc.Present ? data.DescribeFor(npc.EncounterId,alias) : null;
            if (describe == null && npc != null && npc.Owned) describe = CharacterList.ForOwnedAlias(data.Characters,alias);
            return CurrentNpcView.Build(snapshot,utc,describe,context.Bridge.Available,data.CompanionReachable,settings);
        }
        List<MenuLine> Build(Page page,out string subtitle)
        {
            var settings = context.Settings();
            long utc = context.Clock.Utc;
            if (page.Menu == quick) {
                subtitle = "Quick Controls";
                var vehicle = context.VehicleHudView();
                bool inCar = cheats.InVehicle;
                string vehicleText = inCar ? "In vehicle / telemetry unavailable" : "On foot";
                if (inCar && vehicle?.Reading != null) {
                    var v = vehicle.Reading;
                    vehicleText = "Engine " + Math.Round(v.Engine).ToString(CultureInfo.InvariantCulture) +
                        " / Body " + Math.Round(v.Body).ToString(CultureInfo.InvariantCulture);
                    if ((v.BurstTires & v.KnownTires) != 0) vehicleText += " / PUNCTURE";
                } else if (inCar && context.VehicleHudMode() == "off")
                    vehicleText = "In vehicle / HUD off";
                var npc = LiveNpcModel(utc,settings);
                string npcStatus = "None";
                if (npc.Present) {
                    var mode = npc.Lines.FirstOrDefault(line => line.Key == "mode")?.Right;
                    npcStatus = npc.Title;
                    if (mode != null) npcStatus += " / " + mode;
                    if (npcStatus.Length > 32) npcStatus = npcStatus.Substring(0,29) + "...";
                }
                return QuickControlsView.Build(vehicleText,inCar,context.VehicleHudMode(),
                    cheats.Invincible,cheats.WantedLevel,npcStatus);
            }
            if (page.Menu == cheatVehicles) {
                subtitle = "Vehicle Options";
                return new List<MenuLine> {
                    MenuLine.Action("repair","Repair current vehicle","cheat.repair","Repair engine, body and standard vehicle components."),
                    MenuLine.Action("clean","Clean current vehicle","cheat.clean","Remove dirt."),
                    MenuLine.Action("upright","Set vehicle upright","cheat.upright","Try to place the current vehicle on its wheels."),
                    MenuLine.Action("openVehicleSearch","Browse / search vehicles","local.openVehicleSearch","Search names and models, select from a dropdown and spawn or favorite."),
                    MenuLine.Action("spawn","Spawn vehicle by model","cheat.spawn","Manual fallback: type an exact installed model name."),
                    MenuLine.Action("saveCurrent","Favorite current vehicle","cheat.saveCurrent","Save your current vehicle's model to the favorites file."),
                    MenuLine.Action("addFavorite","Add favorite by model","cheat.addFavorite","Type a vehicle model to save for later spawning."),
                    MenuLine.Action("deleteLast","Delete last spawned vehicle","cheat.deleteLast","Delete only the last unoccupied vehicle created by this cheat menu.",true,true),
                    MenuLine.Action("openFavorites","Vehicle Favorites","local.openCheatFavorites","Browse, spawn or remove saved favorites."),
                    MenuLine.Action("openVehicleHud","Vehicle Diagnostics","local.openVehicleHud","See damage, tire bursts, handling inference and diagnostics overlay settings.")
                };
            }
            if (page.Menu == vehicleSearch) {
                var result = catalog.Search(vehicleQuery,vehicleResultPage);
                vehicleResultPage = result.Page;
                subtitle = "Vehicle Search (" + result.Total + " found)";
                var lines = new List<MenuLine> {
                    MenuLine.Fact("query","Search",vehicleQuery.Length == 0 ? "All vehicles" : vehicleQuery,
                        "Enter part of a display name or model; matches rank exact, prefix, then partial."),
                    MenuLine.Action("search","Enter search text","local.vehicleSearchText",
                        "Use GTA's on-screen keyboard. Suggestions appear after confirming; the native keyboard does not support live typing events."),
                    MenuLine.Action("reset","Show all vehicles","local.vehicleSearchReset","Clear the search and browse alphabetically, favorites first.")
                };
                if (result.Items.Length == 0) {
                    selectedVehicleModel = null;
                    lines.Add(MenuLine.Fact("noresults","No matching vehicles","","Try a shorter or different name, or add an installed addon model."));
                } else {
                    string[] ids = result.Items.Select(entry => entry.Model).ToArray();
                    if (!ids.Contains(selectedVehicleModel)) selectedVehicleModel = ids[0];
                    string[] labels = result.Items.Select(entry =>
                        (entry.Favorite ? "[Fav] " : "") + entry.Label + " (" + entry.Model + ")").ToArray();
                    lines.Add(MenuLine.Choice("matches","Matching vehicles","local.vehicleSearchSelect",
                        selectedVehicleModel,ids,labels,
                        "Left/right selects a matching model. Use Spawn selected or Add favorite below."));
                    lines.Add(MenuLine.Action("spawnResult","Spawn selected","cheat.spawnSearch",
                        "Spawn the currently selected model near the player if installed."));
                    lines.Add(MenuLine.Action("favoriteResult","Favorite selected","cheat.favoriteSearch",
                        "Save the selected model in persistent vehicle favorites."));
                }
                lines.Add(MenuLine.Fact("paging","Page", (result.Page+1) + " / " + result.Pages));
                lines.Add(MenuLine.Action("prev","Previous results","local.vehicleSearchPrev","Show previous matching vehicles.",result.Page > 0));
                lines.Add(MenuLine.Action("next","Next results","local.vehicleSearchNext","Show next matching vehicles.",result.Page < result.Pages-1));
                lines.Add(MenuLine.Action("addon","Register installed addon","cheat.addCatalog",
                    "Enter an exact installed addon vehicle model, validate it in-game, and persist it in the search catalog."));
                return lines;
            }
            if (page.Menu == cheatFavorites) {
                subtitle = "Vehicle Favorites";
                var lines = new List<MenuLine>();
                if (favorites.Models.Count == 0)
                    lines.Add(MenuLine.Fact("empty","No favorites saved","", "From Vehicle Options choose Favorite current vehicle or Add favorite by model."));
                foreach (var model in favorites.Models) {
                    lines.Add(MenuLine.Action("spawn:" + model,"Spawn " + model,"cheat.spawnFavorite","Spawn this favorite vehicle next to the player."));
                    lines[lines.Count - 1].Value = model;
                    lines.Add(MenuLine.Action("remove:" + model,"Remove " + model,"cheat.removeFavorite","Remove this model from saved favorites.",true,true));
                    lines[lines.Count - 1].Value = model;
                }
                return lines;
            }
            if (page.Menu == cheatPlayer) {
                subtitle = "Player Options";
                return new List<MenuLine> {
                    MenuLine.Action("heal","Restore health","cheat.heal","Restore the current player character to maximum health."),
                    MenuLine.Action("armor","Full armor","cheat.armor","Set armor to 100."),
                    MenuLine.Action("wanted","Clear wanted level","cheat.wanted","Clear the current wanted level once."),
                    MenuLine.Action("invincible","Toggle invincibility","cheat.invincible","Toggle invincibility for the current player.",true)
                };
            }
            if (page.Menu == activities) {
                subtitle = "Assign Activity";
                bool sameActor = activityTargetBinding == null ||
                    activityTargetBinding.SameIncarnation(data.CharacterBinding) && data.CharacterBinding.Safe;
                var lines = CurrentNpcView.Assign(data.CompanionReachable && activityTargetEncounterId != null && sameActor).Lines;
                foreach (var line in lines) {
                    line.ExpectedEncounterId = activityTargetEncounterId; line.ExpectedOwnerAlias = activityTargetOwnerAlias;
                    if (activityTargetBinding != null) { line.BindingCharacterId = activityTargetBinding.CharacterId; line.ExpectedOwnershipToken = activityTargetBinding.OwnershipToken; }
                }
                return lines;
            }
            if (page.Menu == current) {
                var model = LiveNpcModel(utc,settings);
                var describe = model.Owned ? data.DescribeFor(model.EncounterId,model.OwnerAlias) ?? CharacterList.ForOwnedAlias(data.Characters,model.OwnerAlias) : null;
                currentTitle = model.Present ? model.Title : null;
                if (model.Owned && describe != null && describe.Kind == "promoted" && describe.CharacterId != null)
                    model.Lines.Add(new MenuLine {Key = "details",Text = "Character details",Command = LocalOpenCharacter,Value = describe.CharacterId,Description = "Rename, relationship, availability and memories."});
                subtitle = model.Title;
                return model.Lines;
            }
            if (page.Menu == navigation) {
                subtitle = "Activities & Navigation";
                if (navigationBinding != null) {
                    var row = data.Characters?.FirstOrDefault(item => item.CharacterId == navigationBinding.CharacterId);
                    var checkedBinding = navigationBinding.SameIncarnation(data.CharacterBinding) ? data.CharacterBinding : null;
                    subtitle = row?.Name ?? "Character changed";
                    return CharacterNavigationView.Build(row,checkedBinding,data.ActivityReadiness,data.CompanionReachable);
                }
                return GameplayNavigationView.Build(LiveNpcModel(utc,settings),data.ActivityReadiness);
            }
            if (page.Menu == director) {
                subtitle = "Director & Social";
                if (directorPending && data.DirectorStatus != null && data.DirectorStatus.ReceivedAt > directorBefore)
                    directorPending = false;
                return DirectorSocialView.Build(data.DirectorStatus,data.CompanionReachable,directorPending,directorBefore);
            }
            if (page.Menu == roster) {
                subtitle = "My Characters";
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
                var binding = data.CharacterBinding?.CharacterId == row.CharacterId &&
                    data.CharacterBinding.OwnerAlias == row.OwnerAlias &&
                    data.BindingVerifiedAt >= 0 &&
                    context.Clock.Monotonic - data.BindingVerifiedAt <= AiReadIntervalMs * 2
                    ? data.CharacterBinding : null;
                // Native inspect is an independent authenticated presence proof.
                // It repairs a delayed/unknown roster, but actual commands still
                // revalidate ownership/lease in the original native executor.
                var lines = CharacterList.Actions(row,data.CompanionReachable,context.Bridge.Available,binding != null);
                // One durable RPH transition per visible state change. No private
                // character/profile IDs, ownership tokens, or polling spam.
                bool followAvailable = data.CompanionReachable && context.Bridge.Available &&
                    (row.Spawned || row.Suspended || binding != null);
                string rosterState = row.Spawned ? "spawned" : row.Suspended ? "suspended" :
                    row.RuntimeStatus == "unverified" ? "unverified" : "absent";
                string presence = row.CharacterId + "|" + rosterState + "|" + (binding != null) +
                    "|" + followAvailable;
                if (presence != lastCharacterPresence) {
                    lastCharacterPresence = presence;
                    context.Log("[GM] character_view roster=" + rosterState +
                        " binding=" + (binding != null ? "verified" : "unavailable") +
                        " follow=" + (followAvailable ? "enabled" : "disabled"));
                }
                if (binding != null) {
                    var action = MenuLine.Action("characterActivity","Activities for " + row.Name + "...","local.openNavigation",
                        "Select ACT and navigation commands directly for this native-owned incarnation; no UX4 selection needed.",
                        data.CompanionReachable && binding.Safe);
                    action.ExpectedEncounterId = binding.EncounterId;
                    action.ExpectedOwnerAlias = binding.OwnerAlias;
                    action.ExpectedOwnershipToken = binding.OwnershipToken;
                    action.BindingCharacterId = row.CharacterId;
                    lines.Insert(1,action);
                } else lines.Insert(1,MenuLine.Fact("activitySelection","Activity actions",
                    row.Spawned || row.Suspended ? "Checking native binding" : "Summon first",
                    "An absent character cannot perform world actions. Otherwise wait for verified native ownership."));
                return lines;
            }
            if (page.Menu == vehicleHud) {
                subtitle = "Vehicle Diagnostics";
                var view = context.VehicleHudView();
                var lines = new List<MenuLine> {
                    MenuLine.Choice("mode","Overlay mode","local.vehicleHudMode",context.VehicleHudMode(),
                        new[] {"off","minimal","full"},new[] {"Off","Minimal","Full"},
                        "Choose an overlay mode, then press Select to apply. Session-only; edit LSA.Enhanced.json to persist."),
                    MenuLine.Fact("scope","Vehicle","Driver only","The panel is shown only when driving a car, not in other seats."),
                    MenuLine.Fact("brakes","Brake wear","N/A","No verified per-wheel brake damage source is available."),
                    MenuLine.Fact("suspension","Suspension damage","N/A","External damage mods need an explicit telemetry integration."),
                    MenuLine.Fact("wheel","Tire status","Direct","Tire burst native; wheel detach or rim health is not implied.")
                };
                var logging = MenuLine.Action("record","Vehicle telemetry CSV","local.vehicleLogToggle",
                    "Optional 1 Hz read-only snapshots and damage events. Plugins/LSA/Logs/vehicle-telemetry.csv; stops at 10 MiB.");
                logging.Right = context.VehicleTelemetryLogging() ? "ON" : "OFF";
                lines.Insert(1,logging);
                if (view != null) {
                    var sample = view.Reading;
                    lines.Add(MenuLine.Fact("engine","Engine health",Math.Round(sample.Engine).ToString(CultureInfo.InvariantCulture) + " HP"));
                    lines.Add(MenuLine.Fact("body","Body health",Math.Round(sample.Body).ToString(CultureInfo.InvariantCulture) + " HP"));
                    lines.Add(MenuLine.Fact("tank","Fuel tank health",Math.Round(sample.Tank).ToString(CultureInfo.InvariantCulture) + " HP"));
                    lines.Add(MenuLine.Fact("pull","Handling drift",view.DriftHint ?? "Not detected","Inference; not confirmed alignment or brake damage."));
                    for (int i = 0; i < 4; i++) {
                        int bit = 1 << i;
                        string wh = (sample.KnownWheelHealth & bit) == 0 ? "N/A" :
                            Math.Round(sample.WheelHealth[i]).ToString(CultureInfo.InvariantCulture) + " raw";
                        string th = (sample.KnownTireHealth & bit) == 0 ? "N/A" :
                            Math.Round(sample.TireHealth[i]).ToString(CultureInfo.InvariantCulture) + " raw";
                        lines.Add(MenuLine.Fact("wheel:"+i,"Wheel slot " + i,wh + " / tire " + th,
                            "Supported RPH getter; wheel index mapping and Enhanced runtime operation unverified. Neither value proves axle attachment."));
                        string deformation = (sample.KnownDeformation & bit) == 0 ? "N/A" :
                            Math.Round(sample.Deformation[i],2).ToString(CultureInfo.InvariantCulture) + " raw";
                        lines.Add(MenuLine.Fact("deform:"+i,"Chassis sample " + i,deformation,
                            "Fixed local chassis sample offset. Magnitude is not per-panel damage and needs in-game calibration."));
                    }
                    for (int i = 0; i < view.Events.Length; i++)
                        lines.Add(MenuLine.Fact("damage:"+i,view.Events[i].Text,"Observed"));
                } else lines.Add(MenuLine.Fact("drive","No driven car","","Enter the driver seat to start live diagnostics."));
                return lines;
            }
            if (page.Menu == controls) {
                subtitle = "Controls";
                var router = context.Router();
                return ControlsView.Build(settings,context.Essential(),router?.State ?? "disabled",router?.Conflict,router?.GesturesPaused ?? false,router?.ChordWindowMs ?? GestureTiming.Default.ChordWindowMs,router?.ActiveBindings ?? new GestureBinding[0],context.TalkStatus(),context.TalkConflict());
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
                SnapshotAgeMs = snapshot == null ? -1 : Math.Max(0,utc - snapshot.BuiltAtUtc),Outstanding = context.Dispatcher.Outstanding,RecentReasons = context.Dispatcher.RecentReasons,RecentOutcomes = context.Dispatcher.RecentOutcomes,
                TalkState = context.TalkStatus(),TalkConflict = context.TalkConflict(),IndicatorState = snapshot?.TalkTarget?.Indicator});
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
