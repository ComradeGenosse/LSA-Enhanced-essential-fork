using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;

namespace LSA.PromotedCharacters
{
    internal static class EssentialInputInterception
    {
        const string CoreHash = "9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653";
        const int PollToken = 100663647; // pinned InputController bool(int) GetAsyncKeyState helper
        static readonly InputLeaseState state = new InputLeaseState();
        static readonly object sync = new object();
        static bool installed, rejected;
        static long Now => System.Diagnostics.Stopwatch.GetTimestamp() / Math.Max(1L,System.Diagnostics.Stopwatch.Frequency / 1000);
        [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
        static bool Prefix(int __0,ref bool __result)
        {
            bool result;
            if (!state.Read(__0,(GetAsyncKeyState(__0) & 0x8000) != 0,Now,out result)) return true;
            __result = result; return false;
        }
        static bool Install()
        {
            lock (sync) {
                if (installed || rejected) return installed;
                string stage = "core_pin",dependency = null;
                try {
                    var core = AppDomain.CurrentDomain.GetAssemblies().Single(a => a.GetName().Name == "LosSantosAlive");
                    using (var hash = SHA256.Create()) if (BitConverter.ToString(hash.ComputeHash(File.ReadAllBytes(core.Location))).Replace("-","").ToLowerInvariant() != CoreHash) throw new InvalidOperationException("core_pin_mismatch");
                    var method = core.ManifestModule.ResolveMethod(PollToken);
                    if (method.DeclaringType.FullName != "LosSantosAlive.Input.InputController" || !method.IsStatic || ((MethodInfo)method).ReturnType != typeof(bool) || method.GetParameters().Length != 1 || method.GetParameters()[0].ParameterType != typeof(int)) throw new InvalidOperationException("input_poll_mismatch");
                    // Use the already-installed Harmony; never replace the Core DLL.
                    stage = "harmony_load";
                    dependency = InputHookFiles.HarmonyPath(AppDomain.CurrentDomain.BaseDirectory);
                    Rage.Game.LogTrivial("[UX] essential_input_interception dependency=" + dependency + " core=" + core.Location);
                    var harmonyAssembly = AppDomain.CurrentDomain.GetAssemblies().FirstOrDefault(a => a.GetName().Name == "0Harmony") ?? Assembly.LoadFrom(dependency);
                    stage = "harmony_patch";
                    var harmony = harmonyAssembly.GetType("HarmonyLib.Harmony",true);
                    var harmonyMethod = harmonyAssembly.GetType("HarmonyLib.HarmonyMethod",true);
                    var instance = Activator.CreateInstance(harmony,new object[] {"comrade.lsa.existing-key-gestures"});
                    var prefix = Activator.CreateInstance(harmonyMethod,new object[] {typeof(EssentialInputInterception).GetMethod("Prefix",BindingFlags.NonPublic | BindingFlags.Static)});
                    var patch = harmony.GetMethods().Single(m => m.Name == "Patch" && m.GetParameters().Length == 5);
                    patch.Invoke(instance,new object[] {method,prefix,null,null,null});
                    installed = true;
                    Rage.Game.LogTrivial("[UX] essential_input_interception installed=True");
                } catch (Exception error) {
                    rejected = true;
                    while (error is TargetInvocationException && error.InnerException != null) error = error.InnerException;
                    string missing = (error as FileNotFoundException)?.FileName;
                    Rage.Game.LogTrivial("[UX] essential_input_interception installed=False stage=" + stage + " error=" + error.GetType().Name + " file=" + (missing ?? dependency ?? "none") + " message=" + error.Message);
                }
                return installed;
            }
        }
        public static bool Lease(int mark,int text) => Install() && state.Lease(mark,text,Now);
        public static bool Pulse(int vk) => installed && state.Pulse(vk,Now);
        public static void Release() => state.Release();
    }
}
