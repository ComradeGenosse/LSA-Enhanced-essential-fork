using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using LSA.SessionIdentity;

internal static class Program
{
    static int passed;
    static void Check(bool value) { if (!value) throw new Exception("Native factual IPC invariant failed."); passed++; }
    static Dictionary<string,object> Read(StreamReader reader)
    {
        var read = reader.ReadLineAsync();
        if (!read.Wait(2000) || read.Result == null) throw new Exception("Bounded pipe read failed.");
        return new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(read.Result);
    }
    static VerifyRequest Take(OwnerFactChannel channel)
    {
        var timer = Stopwatch.StartNew();
        while (timer.ElapsedMilliseconds < 2000) { if (channel.TryTake(out var request)) return request; Thread.Sleep(1); }
        throw new Exception("No correlated owner request.");
    }
    static void Main()
    {
        var store = new NativeIdentityEvidenceStore();
        const string world = "11111111-1111-4111-8111-111111111111";
        var token = store.Register("17","companion.alex",world,() => true);
        string pipeName = "LSA.Identity.Offline." + Guid.NewGuid().ToString("N");
        using (var channel = new OwnerFactChannel(pipeName,store.AdapterEpoch))
        {
            store.Revoked += channel.Revoke; channel.Start();
            using (var client = new NamedPipeClientStream(".",pipeName,PipeDirection.InOut))
            {
                client.Connect(2000);
                using (var reader = new StreamReader(client,Encoding.UTF8,false,1024,true))
                {
                    var writer = new StreamWriter(client,new UTF8Encoding(false),1024,true) { AutoFlush = true };
                    var hello = Read(reader);
                    Check((string)hello["type"] == "hello" && (string)hello["adapterEpoch"] == store.AdapterEpoch);
                    Check(hello.Count == 4 && (string)hello["sourceNamespace"] == "comrade.authored");
                    string requestId = Guid.NewGuid().ToString("D");
                    writer.WriteLine(new JavaScriptSerializer().Serialize(new { schemaVersion=1,type="verify",requestId,pedId="17" }));
                    var request = Take(channel); Check(request.PedId == "17" && request.RequestId == requestId);
                    var status = store.TryResolveCurrent(request.PedId,1000,out var claim);
                    channel.Reply(request,status,claim);
                    var proof = Read(reader);
                    Check((string)proof["requestId"] == requestId && (string)proof["pedId"] == "17" && (string)proof["status"] == "active");
                    var data = (Dictionary<string,object>)proof["claim"];
                    Check(data.Count == 10 && (string)data["incarnationId"] == token.IncarnationId);
                    Check(!data.ContainsKey("pedId") && !data.ContainsKey("sessionNonce") && !data.ContainsKey("characterId"));
                    store.Retire(token);
                    var revoke = Read(reader);
                    Check((string)revoke["type"] == "revoke" && (string)revoke["incarnationId"] == token.IncarnationId && (string)revoke["pedId"] == "17");
                    channel.Heartbeat(); Check((string)Read(reader)["type"] == "heartbeat");
                    // The production fact endpoint refuses a gameplay command.
                    writer.WriteLine("{\"schemaVersion\":1,\"type\":\"action\",\"command\":\"DO Attack\"}");
                    var closed = reader.ReadLineAsync(); Check(closed.Wait(2000) && closed.Result == null);
                    try { writer.Dispose(); } catch (IOException) { /* Expected after deliberate protocol rejection. */ }
                }
            }
        }
        Console.WriteLine("Native facts tests: " + passed + " passed; no game assemblies loaded.");
    }
}
