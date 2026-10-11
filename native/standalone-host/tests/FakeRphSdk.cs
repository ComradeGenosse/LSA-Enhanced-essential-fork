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
    // Compile-only local API shapes: NEVER distribute as an actual SDK.
    public static class Game
    {
        public static int GameTime => 0;
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
        public static T CallByName<T>(string name) { return default(T); }
    }
}
