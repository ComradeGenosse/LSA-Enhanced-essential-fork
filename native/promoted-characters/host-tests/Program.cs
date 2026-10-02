using System;
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
}
static class Program
{
    static int count;
    static void Check(bool condition){if(!condition)throw new Exception("Host assertion "+(count+1));count++;}
    static void Main(string[] args)
    {
        var before=AppDomain.CurrentDomain.GetAssemblies().Select(a=>a.FullName).ToArray();
        Check(ClrDomains.Enumerate().Any(d=>d.Id==AppDomain.CurrentDomain.Id));
        Check(ClrDomains.FindUnique(d=>d.FriendlyName=="LosSantosAlive_AppDomain")==null);
        var first=AppDomain.CreateDomain("LosSantosAlive_AppDomain");
        try {
            Check(ClrDomains.FindUnique(d=>d.FriendlyName=="LosSantosAlive_AppDomain").Id==first.Id);
            var remote=(Probe)first.CreateInstanceFromAndUnwrap(Assembly.GetExecutingAssembly().Location,typeof(Probe).FullName);
            Check(remote.Name=="LosSantosAlive_AppDomain");
            Check(remote.Increment()==1);
            Check(new Probe().Increment()==1); // static state remains isolated
            var bridge=(DomainHost)first.CreateInstanceFromAndUnwrap(Assembly.GetExecutingAssembly().Location,typeof(DomainHost).FullName);
            Check(bridge.CoreStatus=="core_missing");
            Check(ClrDomains.FindEssential(Assembly.GetExecutingAssembly().Location)==null);
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
        if(args.Length==1) {
            var references=Assembly.ReflectionOnlyLoadFrom(args[0]).GetReferencedAssemblies().Select(a=>a.Name).ToArray();
            Check(!references.Contains("LosSantosAlive") && !references.Contains("LSA.SessionIdentity") && !references.Contains("LSA.PromotedCharacters.Runtime"));
        }
        Console.WriteLine(count+" production CLR host assertions passed; no game assemblies executed.");
    }
}
