using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
namespace LSA.PromotedCharacters
{
    public sealed class DomainHost : MarshalByRefObject
    {
        Type runtime;
        public string Status {get;private set;}="not_started";
        public override object InitializeLifetimeService()=>null;
        public string CoreStatus
        {
            get {
            // Inspect assemblies locally: marshalling Assembly objects would
            // load copies of Core in the calling plugin's isolated domain.
            var cores=AppDomain.CurrentDomain.GetAssemblies().Where(a=>a.GetName().Name=="LosSantosAlive").ToArray();
            if (cores.Length!=1) return cores.Length==0?"core_missing":"core_ambiguous";
            using (var hash=SHA256.Create()) {
                var actual=BitConverter.ToString(hash.ComputeHash(File.ReadAllBytes(cores[0].Location))).Replace("-","").ToLowerInvariant();
                if (actual!="9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653") return "core_pin_mismatch";
            }
            return "core_ready";
            }
        }
        public bool Start(string plugins,string config)
        {
            Status=CoreStatus;
            if(Status!="core_ready") return false;
            string directory=Path.Combine(plugins,"LSA.PromotedCharacters");
            Assembly.LoadFrom(Path.Combine(directory,"LSA.SessionIdentity.dll"));
            runtime=Assembly.LoadFrom(Path.Combine(directory,"LSA.PromotedCharacters.Runtime.dll")).GetType("LSA.PromotedCharacters.RuntimeEntry",true);
            bool started=(bool)runtime.GetMethod("Start").Invoke(null,new object[]{config});
            Status=started?"starting":"runtime_rejected";
            if(!started) runtime=null; // rejected duplicates cannot stop an owner
            return started;
        }
        public bool Ready=>runtime!=null && (bool)runtime.GetProperty("Ready").GetValue(null);
        public bool Alive=>runtime!=null && (bool)runtime.GetProperty("Alive").GetValue(null);
        public void Stop() { runtime?.GetMethod("Stop").Invoke(null,null); }
    }
}
