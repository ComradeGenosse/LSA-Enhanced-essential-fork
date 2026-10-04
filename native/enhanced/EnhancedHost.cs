using System;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Threading;
using LSA.Enhanced.Commands;
using LSA.Enhanced.Companion;
using LSA.Enhanced.Input;
using LSA.Enhanced.Settings;
using LSA.Enhanced.Ui;
using LSA.PromotedCharacters;
using Rage;

namespace LSA.Enhanced
{
    sealed class RageHud : IHud
    {
        public Func<string> Mode = () => "notification";
        string last; int lastAt;
        public void Show(string text)
        {
            if (string.IsNullOrEmpty(text)) return;
            int now = Environment.TickCount;
            if (text == last && unchecked(now - lastAt) < 1500) return; // no repeated lines
            last = text; lastAt = now;
            try {
                string mode = Mode();
                if (mode == "off") return;
                if (mode == "subtitle") Game.DisplaySubtitle("LSA: " + text,2500);
                else Game.DisplayNotification("~b~LSA~s~ " + text);
            } catch { }
        }
    }
    sealed class RageGameState : IGameState
    {
        public bool ConsoleOpen { get { try { return Game.Console.IsOpen; } catch { return true; } } }
        public bool Paused { get { try { return Game.IsPaused; } catch { return true; } } }
    }
    readonly struct FileStamp : IEquatable<FileStamp>
    {
        readonly bool exists; readonly long length, ticks;
        FileStamp(bool exists,long length,long ticks) { this.exists = exists; this.length = length; this.ticks = ticks; }
        public bool Exists => exists;
        public static FileStamp Of(string path)
        {
            try { var info = new FileInfo(path); return info.Exists ? new FileStamp(true,info.Length,info.LastWriteTimeUtc.Ticks) : default; } catch { return default; }
        }
        public bool Equals(FileStamp other) => exists == other.exists && length == other.length && ticks == other.ticks;
    }
    // Loader-domain host for the input router and the native menu. It runs on its
    // own GameFiber beside the console frontend, owns nothing in Essential's
    // domain, and polls its two files (LSA.Enhanced.json and Essential's
    // LosSantosAlive.config) once a second for hot reload.
    static class EnhancedHost
    {
        const int FileCheckMs = 1000, MaxConsecutiveFailures = 30;
        static readonly NativeBridge bridge = new NativeBridge();
        static readonly IClock clock = new SystemClock();
        static GameFiber fiber;
        static volatile bool stopping, running;
        static volatile string uiStatus = "off";
        static string requestedPage; // written and taken with Interlocked
        static volatile EssentialKeyRelay activeRelay;
        public static NativeBridge Bridge => bridge;
        public static void SetNativeHost(DomainHost host) => bridge.SetHost(host);
        public static void Start(string plugins,Func<string> origin)
        {
            if (fiber != null) return;
            stopping = false;
            string settingsPath = Path.Combine(plugins,"LSA.Enhanced.json"),essentialPath = Path.Combine(plugins,"LosSantosAlive","LosSantosAlive.config");
            fiber = GameFiber.StartNew(() => Run(plugins,settingsPath,essentialPath,origin),"LSA Enhanced input and menu");
        }
        // Shutdown can arrive while the fiber never runs again: release any
        // synthesized key here as well as in the fiber's finally block.
        public static void Stop()
        {
            stopping = true;
            try { activeRelay?.ReleaseAll(); } catch { }
        }
        // Console LSAMenu: queue a toggle for the fiber; returns a reason when the
        // menu cannot open.
        public static string RequestMenu(string page)
        {
            if (!running) return "host_stopped";
            string status = uiStatus;
            if (status == "off") return "menu_off";
            if (status != "ready") return "menu_unavailable";
            Interlocked.Exchange(ref requestedPage,page == "current" ? "current" : "main");
            return null;
        }
        // Compiled only when called, after UiBridge's RNUI version guard passed.
        [MethodImpl(MethodImplOptions.NoInlining)]
        static IMenuSurface CreateMenu(UiContext context) => NativeMenu.Create(context);
        static void Run(string plugins,string settingsPath,string essentialPath,Func<string> origin)
        {
            CommandCatalog catalog;
            try {
                catalog = CommandCatalog.LoadEmbedded();
                if (catalog.Sha256 != CommandCatalog.ContractSha256) { Game.LogTrivial("[UX] command_catalog_mismatch"); return; }
            } catch { Game.LogTrivial("[UX] command_catalog_unavailable"); return; }
            var hud = new RageHud();
            var relay = new EssentialKeyRelay(new Win32InputInjector());
            activeRelay = relay;
            var companion = new CompanionClient(origin);
            var dispatcher = new LoaderDispatcher(catalog,bridge,companion,hud,relay,clock);
            var gameState = new RageGameState();
            var router = new InputRouter(new Win32KeySource(),gameState,dispatcher,bridge,clock,hud,Game.LogTrivial);
            EnhancedSettings settings = EnhancedSettings.Defaults(catalog);
            EssentialBindings essential = EssentialBindings.Unavailable();
            dispatcher.Settings = () => settings; dispatcher.Essential = () => essential;
            hud.Mode = () => settings.Hud;
            var context = new UiContext {Dispatcher = dispatcher,Bridge = bridge,Catalog = catalog,Hud = hud,Clock = clock,Companion = companion,
                Settings = () => settings,Essential = () => essential,Router = () => router,HostStatus = bridge.Describe,Origin = origin,
                EndpointState = EndpointState,Paused = () => gameState.Paused,PluginsPath = plugins,Log = Game.LogTrivial};
            var ui = new UiBridge(context,CreateMenu);
            dispatcher.Ui = ui; router.UiAvailable = () => ui.Available; router.MenuOpen = () => ui.AnyMenuOpen;
            FileStamp settingsStamp = default,essentialStamp = default;
            bool firstPass = true,uiWasAvailable = false; long nextCheck = 0; int failures = 0;
            running = true;
            Game.LogTrivial("[UX] enhanced_host_started");
            try {
                while (!stopping) {
                    try {
                        long now = clock.Monotonic;
                        if (firstPass || now >= nextCheck) {
                            nextCheck = now + FileCheckMs; bool changed = firstPass;
                            var stamp = FileStamp.Of(settingsPath);
                            if (firstPass || !stamp.Equals(settingsStamp)) {
                                // An unreadable file (being written) is retried on the next poll.
                                var next = LoadSettings(settingsPath,stamp,catalog,settings,hud,firstPass);
                                if (next != null) { settingsStamp = stamp; if (next != settings) { settings = next; changed = true; } }
                            }
                            var essentialNow = FileStamp.Of(essentialPath);
                            if (firstPass || !essentialNow.Equals(essentialStamp)) {
                                var loaded = EssentialBindings.Load(essentialPath);
                                if (loaded != null) {
                                    essentialStamp = essentialNow; essential = loaded; changed = true;
                                    Game.LogTrivial("[UX] essential_keys " + (essential.Available ? string.Join(" ",essential.All.Select(key => key.Setting + "=" + key.Display)) : "unavailable"));
                                }
                            }
                            ui.Configure(settings.UiEnabled);
                            uiStatus = ui.Status;
                            if (ui.Available != uiWasAvailable) { uiWasAvailable = ui.Available; changed = true; }
                            if (changed) router.Apply(settings,essential);
                            firstPass = false;
                        }
                        string page = Interlocked.Exchange(ref requestedPage,null);
                        if (page != null) ui.Toggle(page);
                        router.Tick(); ui.Tick(); failures = 0;
                    } catch (ThreadAbortException) { throw; }
                    catch (Exception error) {
                        // Contained: an unexpected failure never unloads the loader
                        // plugin and its console commands.
                        if (++failures == 1) Game.LogTrivial("[UX] enhanced_tick_failed " + error.GetType().Name);
                        if (failures >= MaxConsecutiveFailures) { Game.LogTrivial("[UX] enhanced_host_disabled"); break; }
                    }
                    // Per-frame only while something can act; otherwise stay cheap.
                    if (router.State == "disabled" && !ui.AnyMenuOpen && dispatcher.Outstanding == 0) GameFiber.Sleep(100); else GameFiber.Yield();
                }
            } catch (ThreadAbortException) { throw; }
            catch (Exception error) { Game.LogTrivial("[UX] enhanced_host_failed " + error.GetType().Name); }
            finally {
                running = false; uiStatus = "off";
                try { router.Stop(); } catch { }
                try { ui.Close(); } catch { }
                activeRelay = null;
                Game.LogTrivial("[UX] enhanced_host_stopped");
            }
        }
        static string EndpointState()
        {
            try { string path = CompanionClient.EndpointPath; return path != null && File.Exists(path) ? "Endpoint file present" : "Endpoint file absent (page token fallback)"; }
            catch { return "Endpoint file unknown"; }
        }
        static EnhancedSettings LoadSettings(string path,FileStamp stamp,CommandCatalog catalog,EnhancedSettings current,IHud hud,bool firstPass)
        {
            if (!stamp.Exists) {
                if (!firstPass) Game.LogTrivial("[UX] settings_defaults (no LSA.Enhanced.json)");
                return current.Revision == "defaults" && !firstPass ? current : EnhancedSettings.Defaults(catalog);
            }
            string text;
            try {
                if (new FileInfo(path).Length > EnhancedSettings.MaxFileBytes) { Game.LogTrivial("[UX] settings_rejected file: larger than 16 KiB"); return current; }
                using (var stream = new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite | FileShare.Delete)) using (var reader = new StreamReader(stream)) text = reader.ReadToEnd();
            } catch (IOException) { return null; }
            catch (UnauthorizedAccessException) { return null; }
            catch { Game.LogTrivial("[UX] settings_rejected file: unreadable"); return current; }
            if (!EnhancedSettings.TryParse(text,catalog,out var next,out string error)) {
                Game.LogTrivial("[UX] settings_rejected " + error);
                hud.Show("LSA.Enhanced.json rejected; see RagePluginHook.log");
                return current;
            }
            if (next.Revision == current.Revision) return current;
            Game.LogTrivial("[UX] settings_loaded revision=" + next.Revision.Substring(0,8) + " input=" + next.InputEnabled + " ui=" + next.UiEnabled + " keys=" + string.Join(",",next.KeyNames.Select((name,index) => name + ":" + PhysicalKeys.Name(next.KeyCodes[index]))));
            return next;
        }
    }
}
