using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using LSA.Activities;

class Program
{
    static int assertions;
    static void Check(bool condition, string name) { if (!condition) throw new Exception(name); assertions++; }
    static string ContractPath()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null) { var path = Path.Combine(dir.FullName, "contracts", "activity-capabilities.v1.json"); if (File.Exists(path)) return path; dir = dir.Parent; }
        throw new FileNotFoundException("activity contract");
    }
    static string Id(char n) => n + "1111111-1111-4111-8111-111111111111";
    static void Main(string[] args)
    {
        if (args.Length == 2 && args[0] == "--serve") { Serve(args[1]); return; }
        try { Run(); Console.WriteLine("PASS " + assertions + " ACT contract and shadow assertions"); }
        catch (Exception error) { Console.Error.WriteLine(error); Environment.ExitCode = 1; }
    }
    static void Serve(string pipe)
    {
        var session = new ActivitySession(CapabilityTable.Parse(File.ReadAllBytes(ContractPath())));
        using (var channel = new ActivityChannel(pipe, session)) {
            channel.Start();
            while (true) {
                channel.Pump(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                Thread.Sleep(10);
            }
        }
    }
    static void Run()
    {
        var bytes = File.ReadAllBytes(ContractPath());
        string sha; using (var hash = SHA256.Create()) sha = BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        Check(sha == CapabilityTable.ContractSha256, "pinned capability hash");
        var table = CapabilityTable.Parse(bytes);
        Check(CapabilityTable.LoadEmbedded().Get("hold_position") != null, "embedded contract loads");
        Check(!table.Enabled("chase_person", "on", new Dictionary<string, bool> {{"chase_person", true}}, new[] {"chase_person"}, new string[0], null, null), "never capability stays disabled");
        Check(!table.Enabled("perform_activity", "on", new Dictionary<string, bool> {{"perform_activity", true}}, new[] {"perform_activity"}, new[] {"W1"}, null, null), "vestigial capability stays disabled");
        Check(!table.Enabled("attack", "on", new Dictionary<string, bool> {{"attack", true}}, new[] {"attack"}, new string[0], null, null), "excluded family stays disabled");
        Check(!table.Enabled("hold_position", "shadow", new Dictionary<string, bool> {{"hold_position", true}}, new[] {"hold_position"}, new[] {"Q1", "FR1"}, "player_ux", "player_direct"), "shadow cannot enable execution");
        Check(table.Enabled("hold_position", "on", new Dictionary<string, bool> {{"hold_position", true}}, new[] {"hold_position"}, new[] {"Q1", "FR1"}, "player_ux", "player_direct"), "hold can be enabled only with its probes");
        Check(table.NamesFor("follow_person").SequenceEqual(new[] {"followtarget", "FollowTarget"}) && table.NamesFor("hold_position").SequenceEqual(new[] {"waithere", "WaitHere"}), "canonical and executor names");
        var broken = (byte[])bytes.Clone(); broken[broken.Length - 3] ^= 1; try { CapabilityTable.Parse(broken); Check(false, "tampered contract accepted"); } catch (InvalidDataException) { Check(true, "tampered contract rejected"); }
        var machine = NewMachine(table);
        var actor = Id('a'); var incarnation = Id('b'); var other = Id('c');
        var follow = machine.ObserveCommand(actor, incarnation, true, "follow", 10);
        Check(follow.History.SequenceEqual(new[] {"REQUESTED", "VALIDATED", "DISPATCHED"}) && follow.State == "DISPATCHED" && machine.ActiveCount == 1, "shadow follow opens one pending receipt");
        machine.ObserveCallback(new CallbackRecord { ActorKey = actor, IncarnationId = incarnation, Name = "FollowTarget", Phase = "before", GameMs = 11 }, false);
        machine.ObserveCallback(new CallbackRecord { ActorKey = actor, IncarnationId = incarnation, Name = "followtarget", Phase = "executed", Succeeded = true, GameMs = 12 }, false);
        Check(follow.State == "HANDLER_ACCEPTED" && follow.History.Contains("HANDLER_ACCEPTED") && !machine.HasPhysicalCompletion, "canonical callback accepts without physical completion");
        var wait = machine.ObserveCommand(actor, incarnation, true, "wait", 20);
        Check(follow.State == "SUPERSEDED" && follow.Reason == "superseded_player" && follow.Terminal && wait.State == "DISPATCHED" && machine.ActiveCount == 1, "player wait supersedes follow and keeps one pending");
        machine.ObserveCallback(new CallbackRecord { ActorKey = actor, IncarnationId = other, Name = "waithere", Phase = "executed", Succeeded = true, GameMs = 21 }, false);
        Check(wait.State == "DISPATCHED" && machine.StaleReceipts == 1, "stale incarnation cannot accept");
        machine.ObserveCallback(new CallbackRecord { ActorKey = actor, IncarnationId = incarnation, Name = "waithere", Phase = "executed", Succeeded = false, GameMs = 22 }, false);
        Check(wait.State == "FAILED" && wait.Reason == "handler_false", "handler false fails the receipt");
        var again = machine.ObserveCommand(actor, incarnation, true, "follow", 30);
        machine.ObserveReflex(actor, incarnation, false, 1, 31);
        machine.ObserveReflex(actor, incarnation, true, 2, 32);
        Check(again.State == "SUPERSEDED" && again.Reason == "superseded_reflex", "reflex rise supersedes without a modifier callback");
        var pending = machine.ObserveCommand(actor, incarnation, true, "follow", 40);
        machine.ObserveCallback(new CallbackRecord { ActorKey = actor, IncarnationId = incarnation, Name = "attacktarget", Phase = "executed", Succeeded = true, GameMs = 41 }, false);
        Check(pending.State == "SUPERSEDED" && pending.Reason == "superseded_essential" && machine.ActiveCount == 0, "foreign model action supersedes and is not dispatched by ACT");
        var dismissed = machine.ObserveCommand(actor, incarnation, true, "follow", 50);
        machine.ObserveCommand(actor, incarnation, true, "dismiss", 51);
        Check(dismissed.State == "SUPERSEDED" && machine.ActiveFor(actor) == null, "dismiss is supersession, not a new activity");
        var stale = machine.ObserveCommand(actor, incarnation, false, "follow", 60);
        Check(stale.State == "REJECTED" && stale.Reason == "epoch_changed" && machine.ActiveCount == 0, "stale epoch is rejected");
        var timed = machine.ObserveCommand(actor, incarnation, true, "wait", 0xfffffff0);
        machine.Tick(0x10, 0);
        Check(timed.State == "DISPATCHED", "wrap-safe short elapsed does not time out");
        machine.Tick(unchecked((uint)(0xfffffff0 + 2000)), 0);
        Check(timed.State == "TIMED_OUT" && timed.Reason == "accept_timeout", "wrap-safe accept deadline fires");
        machine.ClientHello(Id('d'), 1000, 5000);
        var leased = machine.ObserveCommand(actor, incarnation, true, "follow", 70);
        machine.Tick(71, 1000 + 5001);
        Check(leased.State == "DETACHED" && leased.Reason == "lease_lost" && machine.LeaseExpiries == 1 && !machine.Accepting, "lease TTL detaches and refuses new work");
        Check(machine.ObserveCommand(actor, incarnation, true, "follow", 72).Reason == "lease_lost", "expired lease rejects a new command");
        machine.ClientHello(Id('e'), 2000, 5000);
        var restarted = machine.ObserveCommand(actor, incarnation, true, "wait", 80);
        machine.ClientHello(Id('f'), 2100, 5000);
        Check(restarted.State == "DETACHED" && restarted.Terminal, "companion restart does not resume the old execution");
        machine.ClockReset();
        var after = machine.ObserveCommand(actor, incarnation, true, "follow", 5);
        machine.ClockReset();
        Check(after.Reason == "clock_reset" && after.State == "DETACHED", "clock reset detaches");
        machine.ObserveControlLost(after.ActorKey, after.IncarnationId, 6);
        var held = machine.ObserveCommand(actor, incarnation, true, "follow", 90);
        machine.ObserveControlLost(actor, incarnation, 91);
        Check(held.State == "DETACHED" && held.Reason == "control_released", "control loss detaches");
        var ring = new SupersessionMonitor();
        for (var n = 0; n < 64; n++) Check(ring.Push(new CallbackRecord { Name = "waithere" }), "ring accepts bounded callbacks");
        Check(!ring.Push(new CallbackRecord { Name = "followtarget" }) && ring.Dropped == 1 && ring.Overflowing, "ring overflow is counted");
        var session = new ActivitySession(table);
        var hello = session.ServerHello();
        var parsed = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(hello);
        Check(ActivityContracts.HelloNative(parsed, CapabilityTable.ContractSha256), "native hello is closed and pinned");
        var client = Id('9');
        session.OpenTransport();
        Check(session.AcceptClient(new JavaScriptSerializer().Serialize(new { version = 1, type = "hello", contractSha256 = CapabilityTable.ContractSha256, clientRun = client })), "client hello");
        Check(session.AcceptClient(new JavaScriptSerializer().Serialize(new { version = 1, type = "lease", sequence = 1, leaseTtlMs = 5000 })), "lease");
        session.PublishDiagnosticsIfChanged(7, 2, 1000, true);
        var diagnostics = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(session.TakeOutbound());
        Check(ActivityContracts.Diagnostics(diagnostics) && Convert.ToInt32(diagnostics["callbackDropped"]) == 7 && Convert.ToInt32(diagnostics["breakerTrips"]) == 2, "diagnostics frame uses live callback and breaker counters");

        var observed = session.Machine.ObserveCommand(actor, incarnation, true, "follow", 100);
        session.Machine.ObserveCallback(new CallbackRecord { ActorKey = actor, IncarnationId = incarnation, Name = "followtarget", Phase = "executed", Succeeded = true, GameMs = 101 }, false);
        session.PublishDiagnosticsIfChanged(7, 2, 1300);
        var changed = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(session.TakeOutbound());
        Check(Convert.ToInt32(changed["accepted"]) == 1, "receipt counter change publishes a later diagnostics frame");

        Check(!session.AcceptClient(new JavaScriptSerializer().Serialize(new { version = 1, type = "lease", sequence = 3, leaseTtlMs = 5000 })) && session.SequenceGaps == 1 && session.Closed && observed.State == "DETACHED", "sequence gap closes only the transport and detaches old work");
        session.OpenTransport();
        Check(!session.Closed && session.AcceptClient(new JavaScriptSerializer().Serialize(new { version = 1, type = "hello", contractSha256 = CapabilityTable.ContractSha256, clientRun = Id('8') })), "fresh transport reconnects after a sequence failure");
        Check(session.AcceptClient(new JavaScriptSerializer().Serialize(new { version = 1, type = "lease", sequence = 1, leaseTtlMs = 5000 })), "reconnect resets client sequence");

        var fresh = new ActivitySession(table);
        fresh.OpenTransport();
        fresh.AcceptClient(new JavaScriptSerializer().Serialize(new { version = 1, type = "hello", contractSha256 = CapabilityTable.ContractSha256, clientRun = client }));
        var begun = fresh.Machine.ObserveCommand(actor, incarnation, true, "follow", 1);
        Check(!fresh.AcceptClient(new JavaScriptSerializer().Serialize(new { version = 1, type = "step.begin", sequence = 1, requestId = Id('1') })) && begun.State == "DETACHED", "ACT1 rejects step.begin and does not keep the execution");
        fresh.OpenTransport();
        Check(fresh.AcceptClient(new JavaScriptSerializer().Serialize(new { version = 1, type = "hello", contractSha256 = CapabilityTable.ContractSha256, clientRun = Id('7') })), "rejected execution frame does not poison future reconnect");
        Check(!fresh.Machine.HasPhysicalCompletion, "no physical completion was claimed");
        var root = Path.GetDirectoryName(Path.GetDirectoryName(ContractPath()));
        var sources = string.Join("\n", new[] {"ActivityContracts.cs","CapabilityTable.cs","ActivityChannel.cs","StepMachine.cs","SupersessionMonitor.cs"}.Select(name => File.ReadAllText(Path.Combine(root, "native", "activities", name))));
        sources += File.ReadAllText(Path.Combine(root, "native", "promoted-characters", "ActivityCommands.cs"));
        foreach (var forbidden in new[] {"QueueNpcAction", "NpcActions.", "TASK_", "CLEAR_PED", "CancelAll", "SetControlledBrain", "ReleaseExclusiveControl"}) Check(!sources.Contains(forbidden), "shadow sources do not " + forbidden);
    }
    static StepMachine NewMachine(CapabilityTable table) => new StepMachine(table.NamesFor, id => table.Get(id)?.AcceptMs ?? 2000, id => table.Get(id)?.HoldMaxMs ?? 0, id => table.Get(id)?.Mode == true);
}
