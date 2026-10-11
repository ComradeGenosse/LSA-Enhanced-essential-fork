using System;
namespace Rage.Attributes
{
    [AttributeUsage(AttributeTargets.Assembly)]
    public sealed class PluginAttribute : Attribute
    {
        public PluginAttribute(string name) {}
        public string Description { get; set; }
        public string Author { get; set; }
        public string EntryPoint { get; set; }
        public string ExitPoint { get; set; }
        public string AssemblyProbingPaths { get; set; }
        public bool PrefersSingleInstance { get; set; }
    }
}
namespace Rage
{
    public struct PoolHandle
    {
        public PoolHandle(uint raw) {}
    }
    public class Ped
    {
        public bool Exists() => false;
        public bool IsDead => false;
        public IntPtr MemoryAddress => IntPtr.Zero;
        public static bool operator ==(Ped a, Ped b) => object.ReferenceEquals(a, b);
        public static bool operator !=(Ped a, Ped b) => !object.ReferenceEquals(a, b);
        public override bool Equals(object obj) => object.ReferenceEquals(this, obj);
        public override int GetHashCode() => base.GetHashCode();
    }
    public sealed class LocalPlayer
    {
        public Ped Character => null;
    }
    public static class World
    {
        public static T GetEntityByHandle<T>(PoolHandle handle) where T : Ped => null;
    }
    // Compile-only local API shapes: NEVER distribute as an actual SDK.
    public static class Game
    {
        public static int GameTime => 0;
        public static LocalPlayer LocalPlayer => new LocalPlayer();
        public static void LogTrivial(string message) {}
    }
    public static class GameFiber
    {
        public static bool CanSleepNow => true;
        public static void Sleep(int milliseconds) {}
    }
}
namespace Rage.Native
{
    public static class NativeFunction
    {
        public static T CallByName<T>(string name, params object[] arguments) { return default(T); }
    }
}
