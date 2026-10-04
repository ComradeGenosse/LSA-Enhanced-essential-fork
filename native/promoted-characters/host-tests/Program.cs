using System;
using System.IO;
using System.Linq;
using System.Reflection;
using LSA.PromotedCharacters;
public sealed class Probe:MarshalByRefObject
{
    static int value;
    public override object InitializeLifetimeService()=>null;
    public int Increment()=>++value;
    public string Name=>AppDomain.CurrentDomain.FriendlyName;
    public bool CoreLoaded=>AppDomain.CurrentDomain.GetAssemblies().Any(a=>a.GetName().Name=="LosSantosAlive");
    public string[] AssemblyNames=>AppDomain.CurrentDomain.GetAssemblies().Select(a=>a.GetName().Name).ToArray();
}
static class Program
{
    static int count;
    static void Check(bool condition){if(!condition)throw new Exception("Host assertion "+(count+1));count++;}
    static bool RegistrationAttribute(CustomAttributeData attribute)=>attribute.AttributeType.FullName=="Rage.Attributes.PluginAttribute" || attribute.AttributeType.FullName=="Rage.Attributes.ConsoleCommandAttribute";
    static void Main(string[] args)
    {
        // Exercise the actual production bootstrap assembly across the boundary,
        // rather than putting its source inside this command-bearing harness.
        string bootstrapPath=args.Length>=2?Path.GetFullPath(args[1]):typeof(DomainHost).Assembly.Location;
        Check(ClrDomains.Enumerate().Any(d=>d.Id==AppDomain.CurrentDomain.Id));
        Check(ClrDomains.FindUnique(d=>d.FriendlyName=="LosSantosAlive_AppDomain")==null);
        var first=AppDomain.CreateDomain("LosSantosAlive_AppDomain");
        try {
            Check(ClrDomains.FindUnique(d=>d.FriendlyName=="LosSantosAlive_AppDomain").Id==first.Id);
            var remote=(Probe)first.CreateInstanceFromAndUnwrap(Assembly.GetExecutingAssembly().Location,typeof(Probe).FullName);
            Check(remote.Name=="LosSantosAlive_AppDomain");
            Check(remote.Increment()==1);
            Check(new Probe().Increment()==1); // static state remains isolated
            var bridge=(DomainHost)first.CreateInstanceFromAndUnwrap(bootstrapPath,typeof(DomainHost).FullName);
            Check(bridge.CoreStatus=="core_missing");
            Check(ClrDomains.FindEssential(bootstrapPath)==null);
            // Only simple strings cross domains; no Assembly/Type is marshalled.
            var remoteAssemblies=remote.AssemblyNames;
            Check(remoteAssemblies.Contains("LSA.PromotedCharacters.Bootstrap"));
            Check(!remoteAssemblies.Contains("LSA.PromotedCharacters"));
            Check(!remoteAssemblies.Contains("LSA.PromotedCharacters.Runtime") && !remoteAssemblies.Contains("LSA.SessionIdentity"));
            Check(!bridge.Start("nonexistent","{}")); // never load a new Core
            Check(bridge.Status=="core_missing");
            Check(!bridge.Ready && !bridge.Alive);
            Check(!remote.CoreLoaded);
            bridge.Stop();
            var duplicate=AppDomain.CreateDomain("LosSantosAlive_AppDomain");
            try {Check(ClrDomains.FindUnique(d=>d.FriendlyName=="LosSantosAlive_AppDomain")==null);}finally{AppDomain.Unload(duplicate);}
            Check(ClrDomains.FindUnique(d=>d.FriendlyName=="LosSantosAlive_AppDomain").Id==first.Id);
        } finally {AppDomain.Unload(first);}
        Check(ClrDomains.FindUnique(d=>d.FriendlyName=="LosSantosAlive_AppDomain")==null);
        Check(!AppDomain.CurrentDomain.GetAssemblies().Any(a=>a.GetName().Name=="LosSantosAlive"));
        if(args.Length>=1) {
            var references=Assembly.ReflectionOnlyLoadFrom(args[0]).GetReferencedAssemblies().Select(a=>a.Name).ToArray();
            Check(!references.Contains("LosSantosAlive") && !references.Contains("LSA.SessionIdentity") && !references.Contains("LSA.PromotedCharacters.Runtime"));
            Check(references.Contains("LSA.PromotedCharacters.Bootstrap"));
        }
        if(args.Length>=2) {
            // Reflection-only inspection reads metadata and never executes RAGE.
            AppDomain.CurrentDomain.ReflectionOnlyAssemblyResolve+=(_,e)=>Assembly.ReflectionOnlyLoad(e.Name);
            var bootstrap=Assembly.ReflectionOnlyLoadFrom(bootstrapPath);
            var references=bootstrap.GetReferencedAssemblies().Select(a=>a.Name).ToArray();
            Check(!references.Contains("RagePluginHook") && !references.Contains("LosSantosAlive") && !references.Contains("LSA.SessionIdentity") && !references.Contains("LSA.PromotedCharacters.Runtime"));
            Check(!references.Contains("LSA.PromotedCharacters"));
            Check(bootstrap.GetType("LSA.PromotedCharacters.PlayerCommands")==null);
            Check(bootstrap.GetType("LSA.PromotedCharacters.EntryPoint")==null);
            Check(bootstrap.GetType("LSA.PromotedCharacters.DomainHost")!=null);
            Check(!bootstrap.GetCustomAttributesData().Any(RegistrationAttribute));
            Check(!bootstrap.GetTypes().Any(type=>type.GetCustomAttributesData().Any(RegistrationAttribute) || type.GetMethods(BindingFlags.Public|BindingFlags.NonPublic|BindingFlags.Instance|BindingFlags.Static|BindingFlags.DeclaredOnly).Any(method=>method.GetCustomAttributesData().Any(RegistrationAttribute))));
        }
        var names=typeof(PlayerCommands).GetMethods(BindingFlags.Public|BindingFlags.Static)
            .Select(method=>method.GetCustomAttribute<Rage.Attributes.ConsoleCommandAttribute>())
            .Where(attribute=>attribute!=null).Select(attribute=>attribute.Name).ToArray();
        // Seven P2 commands, the two UX phase 1 bridge commands and the UX phase 3
        // menu toggle; no aliases.
        Check(names.Length==10 && names.Distinct().Count()==10);
        Check(names.Contains("LSAPromote") && names.Contains("LSACurrentNpc") && names.Contains("LSAAskCurrent") && names.Contains("LSAMenu"));
        PlayerCommands.Initialize(37921);
        PlayerCommands.Initialize(37921);
        PlayerCommands.Command_LSACharacters();
        Check(Rage.Game.Console.LastMessage=="P2 character editor: http://127.0.0.1:37921");
        PlayerCommands.SetNativeReady(false);
        PlayerCommands.Command_LSAPromote();
        Check(Rage.Game.Console.LastMessage=="P2 native host is unavailable. Use LSACharacters to open the character editor.");
        // LSAMenu only queues a toggle for the enhanced host fiber and explains a refusal.
        PlayerCommands.MenuRequested=null; PlayerCommands.Command_LSAMenu();
        Check(Rage.Game.Console.LastMessage=="LSA Enhanced input and menu are not running. See RagePluginHook.log.");
        string requested=null; PlayerCommands.MenuRequested=page=>{requested=page;return "menu_off";}; PlayerCommands.Command_LSAMenu();
        Check(requested=="main" && Rage.Game.Console.LastMessage=="The LSA menu is off. Set \"ui\": {\"enabled\": true} in Plugins/LSA.Enhanced.json.");
        PlayerCommands.MenuRequested=page=>"menu_unavailable"; PlayerCommands.Command_LSAMenu();
        Check(Rage.Game.Console.LastMessage=="The LSA menu is unavailable (RAGENativeUI 1.9.3 not loaded). See RagePluginHook.log.");
        Rage.Game.Console.LastMessage=null; PlayerCommands.MenuRequested=page=>null; PlayerCommands.Command_LSAMenu();
        Check(Rage.Game.Console.LastMessage==null);
        PlayerCommands.MenuRequested=page=>throw new InvalidOperationException(); PlayerCommands.Command_LSAMenu();
        Check(Rage.Game.Console.LastMessage=="LSA Enhanced input and menu are not running. See RagePluginHook.log.");
        PlayerCommands.MenuRequested=null;
        PlayerCommands.Shutdown();
        Rage.Game.Console.LastMessage=null;
        PlayerCommands.Command_LSACharacters();
        Check(Rage.Game.Console.LastMessage==null);
        PlayerCommands.Initialize(37921);
        Check(Rage.Game.RegistrationCalls==0);
        Console.WriteLine(count+" production host/command lifecycle assertions passed; no game assemblies executed.");
    }
}
