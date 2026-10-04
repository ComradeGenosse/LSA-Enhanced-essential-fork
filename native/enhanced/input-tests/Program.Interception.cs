using System;
using System.Collections.Generic;
using System.Linq;
using LSA.Enhanced.Commands;
using LSA.Enhanced.Input;
using LSA.PromotedCharacters;

static partial class Program
{
    static void InterceptionTests()
    {
        bool down;
        var lease = new InputLeaseState();
        Check(lease.Lease(120,6,0),"interception accepts mark/text keys");
        Check(lease.Read(120,true,10,out down) && !down,"stock mark poll suppressed before decision");
        Check(!lease.Read(5,true,10,out down) && !lease.Read(121,true,10,out down),"both PTT keys pass through");
        Check(lease.Pulse(120,20) && lease.Read(120,true,30,out down) && down,"single mark becomes one stock rising edge");
        Check(lease.Read(120,true,40,out down) && !down,"pulse does not repeat or depend on release duration");
        lease.Pulse(6,50); lease.Release();
        Check(lease.Read(6,true,60,out down) && !down,"release cancels pending text and drains held key");
        Check(lease.Read(6,false,70,out down) && !down && !lease.Read(6,true,80,out down),"stock input restored after release");
        lease.Lease(120,6,100); lease.Pulse(6,110);
        Check(lease.Read(6,true,600,out down) && !down && !lease.Pulse(6,600),"stalled loader lease cancels pulses");
        lease.Read(6,false,610,out down);
        Check(!lease.Read(6,true,620,out down),"expired lease restores input after drain");
        Check(!lease.Lease(120,120,700) && !lease.Lease(-1,6,700),"invalid leases rejected");
        lease.Lease(120,6,800); lease.Pulse(6,810); lease.Lease(120,6,1400);
        Check(lease.Read(6,false,1410,out down) && !down,"renewing expired lease cannot resurrect a stale pulse");
        lease.Lease(119,6,1420);
        Check(lease.Read(120,true,1430,out down) && !down && !lease.Pulse(120,1430),"rebinding drains old key and rejects its pulses");
        lease.Read(120,false,1440,out down);
        Check(!lease.Read(120,true,1450,out down),"old key returns to stock after rebinding and release");

        Func<Rig> rig = () => {
            var r = new Rig("{\"version\":1,\"input\":{\"enabled\":true,\"keys\":{\"L4\":\"F9\",\"R4\":\"Mouse5\",\"Menu\":\"F11\"}},\"ui\":{\"enabled\":true}}");
            r.Bridge.InputSupported = true; r.Bridge.InputClock = r.Clock;
            var ui = new FakeUi(); r.Dispatcher.Ui = ui;
            r.Router.UiAvailable = () => ui.Available; r.Router.MenuOpen = () => ui.AnyMenuOpen;
            r.Router.Apply(r.Settings,r.Essential); r.Frame(2);
            return r;
        };
        var taps = rig();
        Check(taps.Router.State == "ready","shared F9/Mouse5 router is ready with interception");
        taps.Hold(120,60); taps.Frame(20); taps.Hold(6,60);
        Check(taps.Bridge.Pulses.SequenceEqual(new[] {120,6}) && taps.Injector.Calls.Count == 0,"shared single taps reach stock polls without OS injection");
        foreach (bool reverse in new[] {false,true}) {
            var r = rig(); r.Keys.Down.Add(reverse?6:120); r.Frame(3);
            Check(r.Bridge.Input.Read(reverse?6:120,true,r.Clock.Monotonic,out down) && !down,"first paddle cannot fire stock input early");
            r.Keys.Down.Add(reverse?120:6); r.Frame(10); r.Keys.Down.Clear(); r.Frame(2);
            Check(r.Companion.Bodies.Count == 1 && r.Bridge.Pulses.Count == 0 && r.Injector.Calls.Count == 0,"short shared chord follows once with no text or mark");
        }
        var hold = rig(); hold.Chord(120,6,30,700);
        Check(((FakeUi)hold.Dispatcher.Ui).Toggles.SequenceEqual(new[] {"current"}) && hold.Bridge.Pulses.Count == 0,"held shared chord opens only quick menu");
        hold.Frame(2);
        Check(hold.Dispatcher.Dispatch(CommandCatalog.EssentialMark,"menu") == null,"explicit menu mark can use shared key");
        hold.Frame(2);
        Check(hold.Bridge.Input.Read(120,false,hold.Clock.Monotonic,out down) && down && hold.Injector.Calls.Count == 0,"menu mark survives next loader tick and reaches stock poll without injection");
        var lost = rig(); lost.Keys.Down.Add(6); lost.Frame(3); lost.Keys.Focus = false; lost.Frame(3); lost.Keys.Down.Add(120); lost.Keys.Focus = true; lost.Frame(30);
        Check(lost.Bridge.Pulses.Count == 0 && lost.Companion.Bodies.Count == 0,"focus loss cancels pending shared input until release");
        lost.Keys.Down.Clear(); lost.Frame(2); lost.Hold(6,60);
        Check(lost.Bridge.Pulses.SequenceEqual(new[] {6}),"shared input recovers after focus loss");
        var ptt = rig(); ptt.Essential = EssentialBindings.Parse(new[] {"TalkKey=F9","TextKey=Mouse5","MarkPedKey=F9","MarkedPedTalkKey=F10"}); ptt.Router.Apply(ptt.Settings,ptt.Essential);
        Check(ptt.Router.State == "suspended","ambiguous PTT mapping is not intercepted");
    }
}
