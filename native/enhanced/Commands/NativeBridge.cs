using System;
using LSA.PromotedCharacters;

namespace LSA.Enhanced.Commands
{
    // Wraps the Essential-domain DomainHost proxy. A remoting failure (Essential
    // unloaded, host stopped) reads as "unavailable" and never escapes.
    public sealed class NativeBridge : INativeBridge
    {
        volatile DomainHost host;
        public void SetHost(DomainHost value) => host = value;
        public bool Available
        {
            get { var current = host; if (current == null) return false; try { return current.Ready && current.BridgeAvailable; } catch { return false; } }
        }
        public string Submit(string envelope)
        {
            var current = host; if (current == null) return "native_unavailable";
            try { return current.Submit(envelope); } catch { return "native_unavailable"; }
        }
        public string TryTakeResult(string id)
        {
            var current = host; if (current == null) return null;
            try { return current.TryTakeResult(id); } catch { return null; }
        }
        public string Snapshot()
        {
            var current = host; if (current == null) return null;
            try { return current.Snapshot(); } catch { return null; }
        }
        public void RequestSnapshots(int forMs)
        {
            var current = host; if (current == null) return;
            try { current.RequestSnapshots(forMs); } catch { }
        }
        // Diagnostics only.
        public string Describe()
        {
            var current = host; if (current == null) return "host=none";
            try { return "status=" + current.Status + " ready=" + current.Ready + " alive=" + current.Alive + " bridge=" + current.BridgeAvailable; } catch { return "host=disconnected"; }
        }
    }
}
