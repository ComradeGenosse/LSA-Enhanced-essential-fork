using System;
using System.Linq;
using System.Reflection;

// Compile the real command source without loading any game assembly. Counting
// the registration API detects both missing and repeated registration calls.
namespace Rage
{
    public static class Game
    {
        public static int RegistrationCalls;
        public static string[] CommandNames;
        public static readonly TestConsole Console=new TestConsole();
        public static void AddConsoleCommands(Type[] types)
        {
            RegistrationCalls++;
            CommandNames=types.SelectMany(t=>t.GetMethods(BindingFlags.Public|BindingFlags.Static))
                .Select(m=>m.GetCustomAttribute<Attributes.ConsoleCommandAttribute>())
                .Where(a=>a!=null).Select(a=>a.Name).ToArray();
        }
        public static void LogTrivial(string message) { }
    }
    public sealed class TestConsole
    {
        public string LastMessage;
        public readonly System.Collections.Generic.List<string> Messages=new System.Collections.Generic.List<string>();
        public void Print(string message) { LastMessage=message; lock(Messages) Messages.Add(message); }
    }
}
namespace Rage.Attributes
{
    [AttributeUsage(AttributeTargets.Method)]
    public sealed class ConsoleCommandAttribute : Attribute
    {
        public string Name {get;set;}
        public string Description {get;set;}
    }
}
