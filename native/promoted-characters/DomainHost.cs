using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
namespace LSA.PromotedCharacters
{
    public sealed class DomainHost : MarshalByRefObject
    {
        // UX phase 1 bridge limits: envelopes in, result/snapshot JSON out.
        public const int MaxEnvelopeChars=8192, MaxReplyChars=16384, MaxSnapshotInterestMs=10000;
        Type runtime;
        MethodInfo submit,takeResult,snapshot,requestSnapshots;
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
            if(!started) {runtime=null;return false;} // rejected duplicates cannot stop an owner
            // An older runtime without the bridge keeps P2 working; the bridge
            // then reports native_unavailable instead of failing the host.
            submit=Bridge("Submit",typeof(string),typeof(string));
            takeResult=Bridge("TryTakeResult",typeof(string),typeof(string));
            snapshot=Bridge("Snapshot",typeof(string));
            requestSnapshots=Bridge("RequestSnapshots",typeof(void),typeof(int));
            return true;
        }
        MethodInfo Bridge(string name,Type returns,params Type[] parameters)
        {
            var method=runtime.GetMethod(name,BindingFlags.Public|BindingFlags.Static,null,parameters,null);
            return method!=null && method.ReturnType==returns?method:null;
        }
        public bool Ready=>runtime!=null && (bool)runtime.GetProperty("Ready").GetValue(null);
        public bool BridgeAvailable=>runtime!=null && submit!=null && takeResult!=null && snapshot!=null && requestSnapshots!=null;
        public bool Alive=>runtime!=null && (bool)runtime.GetProperty("Alive").GetValue(null);
        public void Stop() { runtime?.GetMethod("Stop").Invoke(null,null); }
        // Every bridge member takes and returns only string, int or bool, and
        // contains runtime failures here so no runtime type crosses the domain.
        public string Submit(string envelope)
        {
            if(envelope==null) return "invalid_envelope";
            if(envelope.Length>MaxEnvelopeChars) return "envelope_too_large";
            var method=runtime!=null?submit:null;
            if(method==null) return "native_unavailable";
            try {
                var reply=method.Invoke(null,new object[]{envelope}) as string;
                return reply!=null && Code(reply)?reply:"native_operation_failed";
            } catch {return "native_operation_failed";}
        }
        public string TryTakeResult(string id)
        {
            if(id==null || id.Length!=36) return null;
            return Reply(runtime!=null?takeResult:null,id);
        }
        public string Snapshot()=>Reply(runtime!=null?snapshot:null);
        public void RequestSnapshots(int forMs)
        {
            var method=runtime!=null?requestSnapshots:null;
            if(method==null || forMs<=0) return;
            try {method.Invoke(null,new object[]{Math.Min(forMs,MaxSnapshotInterestMs)});} catch {}
        }
        static string Reply(MethodInfo method,params object[] arguments)
        {
            if(method==null) return null;
            try {
                var reply=method.Invoke(null,arguments) as string;
                return reply!=null && reply.Length<=MaxReplyChars?reply:null;
            } catch {return null;}
        }
        static bool Code(string value)
        {
            if(value.Length<1 || value.Length>64 || value[0]<'a' || value[0]>'z') return false;
            foreach(char c in value) if(!(c>='a' && c<='z' || c>='0' && c<='9' || c=='_')) return false;
            return true;
        }
    }
}
