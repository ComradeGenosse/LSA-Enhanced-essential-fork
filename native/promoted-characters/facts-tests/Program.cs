using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using LSA.PromotedCharacters;
class Program
{
    static int count;
    static void Check(bool value) { count++; if (!value) throw new Exception("P2 control pipe assertion " + count); }
    static void Main()
    {
        try { Run(); } catch (Exception error) { Console.Error.WriteLine(error.GetType().Name + ": " + error.Message); Environment.ExitCode = 1; }
    }
    static void Run()
    {
        string name = "LSA.P2.offline." + Guid.NewGuid().ToString("N"),epoch = Guid.NewGuid().ToString("D"),world = Guid.NewGuid().ToString("D");
        var json = new JavaScriptSerializer();
        using (var channel = new ControlChannel(name,epoch,world)) {
            channel.Start();
            string requestId = Guid.NewGuid().ToString("D");
            var client = Task.Run(() => {
                using (var pipe = new NamedPipeClientStream(".",name,PipeDirection.InOut)) {
                    pipe.Connect(3000); var reader = new StreamReader(pipe); var writer = new StreamWriter(pipe) {AutoFlush = true};
                    var hello = json.Deserialize<Dictionary<string,object>>(reader.ReadLine()); Check((string)hello["ownerEpoch"] == epoch);Check((string)hello["worldProfileId"] == world);
                    writer.WriteLine(json.Serialize(new {version = 1,requestId,worldProfileId = world,ownerEpoch = epoch,operation = "capture",args = new {},expiresAtUtc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 2500}));
                    var result = json.Deserialize<Dictionary<string,object>>(reader.ReadLine());Check((string)result["requestId"] == requestId);Check((string)result["status"] == "ok");
                }
            });
            ControlRequest request = null;var stop = DateTime.UtcNow.AddSeconds(3);
            while (DateTime.UtcNow < stop && !channel.TryTake(out request)) Thread.Sleep(10);
            Check(request != null);Check(request.Operation == "capture");request.Result = new {test = true};request.Done.Set();client.GetAwaiter().GetResult();
            // Production parser's nested array shape is used by appearance restore.
            var parsed = json.Deserialize<Dictionary<string,object>>("{\"appearance\":{\"components\":[{\"slot\":0}],\"props\":[]}}");
            var appearance = (Dictionary<string,object>)parsed["appearance"];Check(appearance["components"] is IList);Check(appearance["props"] is IList);
            var bad = Task.Run(() => {
                using (var pipe = new NamedPipeClientStream(".",name,PipeDirection.InOut)) {
                    pipe.Connect(3000); var reader = new StreamReader(pipe);var writer = new StreamWriter(pipe){AutoFlush = true};reader.ReadLine();
                    writer.WriteLine(json.Serialize(new {version = 1,requestId = Guid.NewGuid().ToString("D"),worldProfileId = world,ownerEpoch = epoch,operation = "audio",args = new {},expiresAtUtc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 2500}));Check(reader.ReadLine() == null);
                }
            });bad.GetAwaiter().GetResult();Check(!channel.TryTake(out _));
        }
        Console.WriteLine("P2 production Windows control pipe: " + count + " assertions passed; no game assemblies loaded.");
    }
}
