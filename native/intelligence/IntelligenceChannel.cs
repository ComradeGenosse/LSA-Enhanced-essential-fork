using System;
using System.Collections.Generic;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace LSA.Intelligence
{
    // Server output only. Identity and P2 control protocols gain no commands.
    internal sealed class IntelligenceChannel : IDisposable
    {
        readonly object gate=new object();
        readonly Queue<string> frames=new Queue<string>();
        readonly Queue<string> directorFrames=new Queue<string>();
        readonly string name,epoch;
        readonly Func<object> capabilities;
        readonly string hostRunId;
        readonly Func<int> worldEpoch;
        readonly bool observerIndex,directorRequests;
        readonly JavaScriptSerializer json=new JavaScriptSerializer {MaxJsonLength=8192,RecursionLimit=8};
        NamedPipeServerStream pipe;
        string streamId;
        long sequence;
        volatile bool stopping,connected;
        public int ConnectionVersion {get;private set;}
        public long Dropped {get;private set;}
        public IntelligenceChannel(string name,string epoch,Func<object> capabilities,string hostRunId=null,Func<int> worldEpoch=null,bool observerIndex=false,bool directorRequests=false) {
            if((hostRunId==null)!=(worldEpoch==null) || hostRunId!=null && !System.Text.RegularExpressions.Regex.IsMatch(hostRunId,"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")) throw new ArgumentException("invalid_host_context");
            this.name=name;this.epoch=epoch;this.capabilities=capabilities;this.hostRunId=hostRunId;this.worldEpoch=worldEpoch;this.observerIndex=observerIndex;this.directorRequests=directorRequests;
        }
        object Hello() {
            var value=new Dictionary<string,object>{{"version",1},{"type","hello"},{"adapterEpoch",epoch},{"streamId",streamId},{"capabilities",capabilities()}};
            if(hostRunId!=null) {value["hostContextVersion"]=1;value["hostRunId"]=hostRunId;value["worldEpoch"]=worldEpoch();}
            if(observerIndex && hostRunId!=null) {value["observerIndexVersion"]=1;value["observerSituationVersion"]=1;value["primaryBehaviorOwnerVersion"]=1;}
            if(directorRequests && hostRunId!=null)value["directorRequestVersion"]=1;
            return value;
        }
        public void Start() {new Thread(Serve) {IsBackground=true,Name="LSA intelligence facts"}.Start();}
        void Serve()
        {
            while(!stopping) {
                NamedPipeServerStream active=null;
                try {
                    var sid=WindowsIdentity.GetCurrent().User;var acl=new PipeSecurity();acl.SetAccessRuleProtection(true,false);acl.SetOwner(sid);acl.AddAccessRule(new PipeAccessRule(sid,PipeAccessRights.FullControl,AccessControlType.Allow));
                    active=new NamedPipeServerStream(name,directorRequests?PipeDirection.InOut:PipeDirection.Out,1,PipeTransmissionMode.Byte,PipeOptions.Asynchronous,8192,8192,acl);
                    lock(gate) {if(stopping) {active.Dispose();return;}pipe=active;}
                    active.WaitForConnection();
                    string hello;
                    lock(gate) {frames.Clear();directorFrames.Clear();sequence=0;streamId=Guid.NewGuid().ToString("D");hello=json.Serialize(Hello());connected=true;ConnectionVersion++;}
                    Write(active,hello);
                    if(directorRequests){var receiving=active;new Thread(()=>ReadDirectorRequests(receiving)){IsBackground=true,Name="LSA director v1 reader"}.Start();}
                    while(!stopping && connected) {
                        string frame=null;lock(gate) {if(frames.Count>0) frame=frames.Dequeue();}
                        if(frame==null) {Thread.Sleep(20);continue;} Write(active,frame);
                    }
                } catch {} finally {lock(gate) {connected=false;frames.Clear();directorFrames.Clear();if(ReferenceEquals(pipe,active)) pipe=null;}try{active?.Dispose();}catch{}}
                if(!stopping) Thread.Sleep(100);
            }
        }
        // Socket bytes are read off-fiber; only the integration owner Update
        // may deserialize and evaluate a request against current GTA state.
        // This vocabulary is unavailable on legacy output-only PS channels.
        void ReadDirectorRequests(NamedPipeServerStream active)
        {
            try {
                var bytes=new List<byte>(8192);
                while(!stopping && active.IsConnected) {
                    int raw=active.ReadByte();
                    if(raw<0) break;
                    if(raw==10) {
                        if(bytes.Count>0 && bytes[bytes.Count-1]==13)bytes.RemoveAt(bytes.Count-1);
                        var line=Encoding.UTF8.GetString(bytes.ToArray());
                        bytes.Clear();
                        if(line.Length==0) continue;
                        lock(gate){
                            if(!connected || !ReferenceEquals(pipe,active))return;
                            if(directorFrames.Count>=32)throw new InvalidOperationException("director_queue_overflow");
                            directorFrames.Enqueue(line);
                        }
                    }
                    else {
                        if(bytes.Count>=8192)throw new InvalidOperationException("director_frame_overflow");
                        bytes.Add((byte)raw);
                    }
                }
            } catch {} finally {
                lock(gate)if(ReferenceEquals(pipe,active)){connected=false;directorFrames.Clear();}
                try{active.Dispose();}catch{}
            }
        }
        public bool TryTakeDirectorFrame(out string frame)
        {
            frame=null;
            if(!directorRequests || stopping)return false;
            lock(gate) {
                if(!connected || directorFrames.Count==0)return false;
                frame=directorFrames.Dequeue();return true;
            }
        }
        static void Write(NamedPipeServerStream active,string message) {var bytes=Encoding.UTF8.GetBytes(message+"\n");active.Write(bytes,0,bytes.Length);active.Flush();}
        public bool Send(string type,object payload)
        {
            NamedPipeServerStream retire=null;
            lock(gate) {
                if(!connected || stopping) return false;
                var frame=json.Serialize(new {version=1,type,adapterEpoch=epoch,streamId,sequence=++sequence,payload});
                if(Encoding.UTF8.GetByteCount(frame)>8192 || frames.Count>=64) {Dropped=Math.Min(int.MaxValue,Dropped+1);connected=false;frames.Clear();retire=pipe;}
                else {frames.Enqueue(frame);return true;}
            }
            // Losing retirement/roster facts retires the whole connection, never guesses currency.
            ThreadPool.QueueUserWorkItem(_=>{try{retire?.Dispose();}catch{}});return false;
        }
        public void Dispose() {stopping=true;NamedPipeServerStream retire;lock(gate){connected=false;frames.Clear();retire=pipe;}ThreadPool.QueueUserWorkItem(_=>{try{retire?.Dispose();}catch{}});}
    }
}
