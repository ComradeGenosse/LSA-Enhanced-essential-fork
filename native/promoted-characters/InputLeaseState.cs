using System.Collections.Generic;

namespace LSA.PromotedCharacters
{
    // Pure, bounded arbitration for Essential's mark/text polling. Expiry or
    // shutdown cancels pulses and drains held keys before restoring stock input.
    public sealed class InputLeaseState
    {
        sealed class Key { public bool Enabled, Pulse; }
        readonly Dictionary<int,Key> keys = new Dictionary<int,Key>();
        readonly object sync = new object();
        long until;
        public bool Lease(int mark, int text, long now)
        {
            if (mark < 0 || mark > 254 || text < 0 || text > 254 || (mark != 0 && mark == text)) return false;
            lock (sync) {
                if (now >= until) foreach (var key in keys.Values) key.Pulse = false;
                foreach (var pair in keys) if (pair.Key != mark && pair.Key != text) { pair.Value.Enabled = false; pair.Value.Pulse = false; }
                foreach (int vk in new[] {mark,text}) if (vk != 0) {
                    if (!keys.TryGetValue(vk,out var key)) keys[vk] = key = new Key();
                    key.Enabled = true;
                }
                until = now + 500;
                return true;
            }
        }
        public bool Pulse(int vk,long now)
        {
            lock (sync) {
                if (now >= until || !keys.TryGetValue(vk,out var key) || !key.Enabled) return false;
                key.Pulse = true; return true;
            }
        }
        public void Release()
        {
            lock (sync) { until = 0; foreach (var key in keys.Values) { key.Enabled = false; key.Pulse = false; } }
        }
        public bool Read(int vk,bool physicalDown,long now,out bool down)
        {
            lock (sync) {
                down = false;
                if (!keys.TryGetValue(vk,out var key)) return false;
                if (now >= until) { key.Enabled = false; key.Pulse = false; }
                if (key.Enabled) { down = key.Pulse; key.Pulse = false; return true; }
                if (!physicalDown) keys.Remove(vk);
                return true; // held across disable/expiry must release first
            }
        }
    }
}
