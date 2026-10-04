using System;
using System.Linq;
using System.Reflection;
using LSA.Enhanced.Commands;
using LSA.Enhanced.Input;
using LSA.Enhanced.Settings;

namespace LSA.Enhanced.Ui
{
    // Everything the menus read or call. Names no RAGENativeUI type.
    public sealed class UiContext
    {
        public LoaderDispatcher Dispatcher;
        public INativeBridge Bridge;
        public CommandCatalog Catalog;
        public IHud Hud;
        public IClock Clock;
        public ICompanion Companion;
        public Func<EnhancedSettings> Settings = () => null;
        public Func<EssentialBindings> Essential = EssentialBindings.Unavailable;
        public Func<InputRouter> Router = () => null;
        public Func<string> TalkStatus = () => null;
        public Func<string> TalkConflict = () => null;
        public Action ClearTalkTarget = () => { };
        public Func<string> HostStatus = () => "host=none";
        public Func<string> Origin = () => null;
        public Func<string> EndpointState = () => null;
        public Func<bool> Paused = () => false;
        public string PluginsPath;
        public Action<string> Log = _ => { };
    }
    // The RNUI menus behind a seam that names no RNUI type, so the host and this
    // bridge load and run where RAGENativeUI is missing or a different version.
    public interface IMenuSurface
    {
        bool AnyOpen {get;}
        void Toggle(string page);
        void Tick();
        void CloseAll();
    }
    // IUiController for the dispatcher and router. Menus exist only when
    // ui.enabled is true and RAGENativeUI 1.9.3.0 is loaded; otherwise gestures and
    // console commands keep working and ui.* bindings are dropped by the router.
    public sealed class UiBridge : IUiController
    {
        public static readonly Version RequiredRnuiVersion = new Version(1,9,3,0);
        public const int MaxConsecutiveFailures = 10;
        readonly UiContext context;
        readonly Func<UiContext,IMenuSurface> factory;
        readonly Func<string> guard;
        IMenuSurface surface;
        bool enabled, open;
        int failures;
        public UiBridge(UiContext context,Func<UiContext,IMenuSurface> factory,Func<string> guard = null)
        {
            this.context = context ?? throw new ArgumentNullException(nameof(context));
            this.factory = factory ?? throw new ArgumentNullException(nameof(factory));
            this.guard = guard ?? DefaultGuard;
        }
        // off, ready, rnui_missing, rnui_version_<x>, menu_failed or menu_disabled.
        // A failure stays final for this plugin session; a reload retries.
        public string Status {get;private set;} = "off";
        public bool Available => enabled && surface != null && Status == "ready";
        public bool AnyMenuOpen => open;
        public void Configure(bool enable)
        {
            if (enable == enabled) return;
            enabled = enable;
            if (!enable) {
                Close();
                if (Status == "ready") { Status = "off"; context.Log("[UX] menu state=off"); }
                return;
            }
            if (surface != null) { if (Status == "off") { Status = "ready"; context.Log("[UX] menu state=ready"); } return; }
            if (Status != "off") return;
            string problem;
            try { problem = guard(); } catch { problem = "rnui_missing"; }
            if (problem != null) { Status = problem; context.Log("[UX] menu_unavailable reason=" + problem); return; }
            try { surface = factory(context); Status = surface != null ? "ready" : "menu_failed"; }
            catch (Exception error) { surface = null; Status = "menu_failed"; context.Log("[UX] menu_unavailable reason=menu_failed " + error.GetType().Name); return; }
            context.Log(Status == "ready" ? "[UX] menu state=ready rnui=" + RequiredRnuiVersion : "[UX] menu_unavailable reason=menu_failed");
        }
        public void Toggle(string page)
        {
            if (!Available) return;
            try { surface.Toggle(page); open = surface.AnyOpen; failures = 0; } catch (Exception error) { Fail(error); }
        }
        public void Tick()
        {
            if (surface == null || Status != "ready") { open = false; return; }
            try { surface.Tick(); open = surface.AnyOpen; failures = 0; } catch (Exception error) { Fail(error); }
        }
        void Fail(Exception error)
        {
            if (++failures == 1) context.Log("[UX] menu_tick_failed " + error.GetType().Name);
            if (failures < MaxConsecutiveFailures) return;
            Status = "menu_disabled"; context.Log("[UX] menu_unavailable reason=menu_disabled");
            Close();
        }
        public void Close()
        {
            open = false;
            if (surface == null) return;
            try { surface.CloseAll(); } catch { }
        }
        // Reflection only: never names an RNUI type, so it runs without RNUI.
        public static string DefaultGuard()
        {
            var assembly = AppDomain.CurrentDomain.GetAssemblies().FirstOrDefault(item => item.GetName().Name == "RAGENativeUI");
            if (assembly == null) {
                try { assembly = Assembly.Load(new AssemblyName("RAGENativeUI")); } catch { return "rnui_missing"; }
            }
            var version = assembly.GetName().Version;
            return version == RequiredRnuiVersion ? null : "rnui_version_" + version;
        }
    }
}
