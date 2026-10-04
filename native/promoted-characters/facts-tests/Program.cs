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
    static void Check(bool value, string label = "") { count++; if (!value) throw new Exception("P2 control pipe assertion " + count + (label.Length == 0 ? "" : " (" + label + ")")); }
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
                    pipe.Connect(5000); var reader = new StreamReader(pipe); var writer = new StreamWriter(pipe) {AutoFlush = true};
                    var hello = json.Deserialize<Dictionary<string,object>>(reader.ReadLine()); Check((string)hello["ownerEpoch"] == epoch);Check((string)hello["worldProfileId"] == world);
                    writer.WriteLine(json.Serialize(new {version = 1,requestId,worldProfileId = world,ownerEpoch = epoch,operation = "capture",args = new {},expiresAtUtc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 4500}));
                    var result = json.Deserialize<Dictionary<string,object>>(reader.ReadLine());Check((string)result["requestId"] == requestId);Check((string)result["status"] == "ok");
                }
            });
            ControlRequest request = null;var stop = DateTime.UtcNow.AddSeconds(4);
            while (DateTime.UtcNow < stop && !channel.TryTake(out request)) Thread.Sleep(10);
            Check(request != null,"capture dequeued");Check(request?.Operation == "capture","capture operation");if(request != null){request.Result = new {test = true};request.Done.Set();}client.GetAwaiter().GetResult();
            // UX phase 1: the read-only "current" op is admitted like any owner op.
            string currentId = Guid.NewGuid().ToString("D");
            var currentClient = Task.Run(() => {
                using (var pipe = new NamedPipeClientStream(".",name,PipeDirection.InOut)) {
                    pipe.Connect(5000); var reader = new StreamReader(pipe); var writer = new StreamWriter(pipe) {AutoFlush = true}; reader.ReadLine();
                    writer.WriteLine(json.Serialize(new {version = 1,requestId = currentId,worldProfileId = world,ownerEpoch = epoch,operation = "current",args = new {},expiresAtUtc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 4500}));
                    var result = json.Deserialize<Dictionary<string,object>>(reader.ReadLine()); Check((string)result["requestId"] == currentId,"current reply id"); Check((string)result["status"] == "ok","current reply status");
                }
            });
            ControlRequest current = null; var currentStop = DateTime.UtcNow.AddSeconds(4);
            while (DateTime.UtcNow < currentStop && !channel.TryTake(out current)) Thread.Sleep(10);
            Check(current != null && current.Operation == "current" && current.Args.Count == 0,"current dequeued");
            if (current != null) { current.Result = new {present = false}; current.Done.Set(); } currentClient.GetAwaiter().GetResult();
            // Production parser's nested array shape is used by appearance restore.
            var parsed = json.Deserialize<Dictionary<string,object>>("{\"appearance\":{\"components\":[{\"slot\":0}],\"props\":[]}}");
            var appearance = (Dictionary<string,object>)parsed["appearance"];Check(appearance["components"] is IList);Check(appearance["props"] is IList);
            var bad = Task.Run(() => {
                using (var pipe = new NamedPipeClientStream(".",name,PipeDirection.InOut)) {
                    pipe.Connect(3000); var reader = new StreamReader(pipe);var writer = new StreamWriter(pipe){AutoFlush = true};reader.ReadLine();
                    writer.WriteLine(json.Serialize(new {version = 1,requestId = Guid.NewGuid().ToString("D"),worldProfileId = world,ownerEpoch = epoch,operation = "audio",args = new {},expiresAtUtc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 2500}));Check(reader.ReadLine() == null);
                }
            });bad.GetAwaiter().GetResult();Check(!channel.TryTake(out _));
            string spawnId = Guid.NewGuid().ToString("D");
            var delayedSpawn = Task.Run(() => {
                using (var pipe = new NamedPipeClientStream(".",name,PipeDirection.InOut)) {
                    pipe.Connect(3000); var reader = new StreamReader(pipe); var writer = new StreamWriter(pipe) {AutoFlush = true}; reader.ReadLine();
                    writer.WriteLine(json.Serialize(new {version = 1,requestId = spawnId,worldProfileId = world,ownerEpoch = epoch,operation = "spawn",args = new {},expiresAtUtc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 12000}));
                    var result = json.Deserialize<Dictionary<string,object>>(reader.ReadLine()); Check((string)result["requestId"] == spawnId); Check((string)result["status"] == "ok");
                }
            });
            var spawnDeadline = DateTime.UtcNow.AddSeconds(3); ControlRequest spawn = null;
            while (DateTime.UtcNow < spawnDeadline && !channel.TryTake(out spawn)) Thread.Sleep(10);
            Check(spawn != null && spawn.Operation == "spawn"); Thread.Sleep(5200);
            spawn.Result = new {status = "spawned"}; spawn.Done.Set(); delayedSpawn.GetAwaiter().GetResult();
        }
        Console.WriteLine("P2 production Windows control pipe: " + count + " assertions passed; no game assemblies loaded.");
    }
}
