using System.Collections.Generic;

namespace LSA.PromotedCharacters
{
    // Pure, bounded arbitration for Essential's polled input. The gesture router
    // owns Mark/Text; UX4 may independently own Talk. Owner expiry/release drains
    // a physically held key before restoring stock input, preventing half-presses.
    public sealed class InputLeaseState
    {
        sealed class Key { public bool Router, Talk, Pulse, Drain; }
        readonly Dictionary<int,Key> keys = new Dictionary<int,Key>();
        readonly object sync = new object();
        long routerUntil, talkUntil;

        static bool Valid(int key) => key >= 0 && key <= 254;

        void Expire(long now)
        {
            if (routerUntil != 0 && now >= routerUntil) {
                routerUntil = 0;
                foreach (var key in keys.Values) if (key.Router) {
                    key.Router = false; key.Pulse = false; key.Drain = true;
                }
            }
            if (talkUntil != 0 && now >= talkUntil) {
                talkUntil = 0;
                foreach (var key in keys.Values) if (key.Talk) {
                    key.Talk = false; key.Drain = true;
                }
            }
        }

        public bool Lease(int mark,int text,long now) => LeaseRouter(mark,text,now);

        public bool LeaseRouter(int mark,int text,long now)
        {
            if (!Valid(mark) || !Valid(text) || (mark != 0 && mark == text)) return false;
            lock (sync) {
                Expire(now);
                foreach (var pair in keys)
                    if (pair.Value.Router && pair.Key != mark && pair.Key != text) {
                        pair.Value.Router = false; pair.Value.Pulse = false; pair.Value.Drain = true;
                    }
                foreach (int vk in new[] {mark,text}) if (vk != 0) {
                    if (!keys.TryGetValue(vk,out var key)) keys[vk] = key = new Key();
                    key.Router = true;
                }
                routerUntil = now + 500;
                return true;
            }
        }

        public bool LeaseTalk(int talk,long now)
        {
            if (talk <= 0 || talk > 254) return false;
            lock (sync) {
                Expire(now);
                foreach (var pair in keys)
                    if (pair.Value.Talk && pair.Key != talk) {
                        pair.Value.Talk = false; pair.Value.Drain = true;
                    }
                if (!keys.TryGetValue(talk,out var key)) keys[talk] = key = new Key();
                key.Talk = true;
                talkUntil = now + 500;
                return true;
            }
        }

        public bool Pulse(int vk,long now)
        {
            lock (sync) {
                Expire(now);
                if (!keys.TryGetValue(vk,out var key) || !key.Router) return false;
                key.Pulse = true;
                return true;
            }
        }

        public void Release() => ReleaseRouter();

        public void ReleaseRouter()
        {
            lock (sync) {
                routerUntil = 0;
                foreach (var key in keys.Values) if (key.Router) {
                    key.Router = false; key.Pulse = false; key.Drain = true;
                }
            }
        }

        public void ReleaseTalk()
        {
            lock (sync) {
                talkUntil = 0;
                foreach (var key in keys.Values) if (key.Talk) {
                    key.Talk = false; key.Drain = true;
                }
            }
        }

        public void ReleaseAll()
        {
            lock (sync) {
                routerUntil = talkUntil = 0;
                foreach (var key in keys.Values) {
                    key.Router = false; key.Talk = false; key.Pulse = false; key.Drain = true;
                }
            }
        }

        public bool Read(int vk,bool physicalDown,long now,out bool down)
        {
            lock (sync) {
                Expire(now);
                down = false;
                if (!keys.TryGetValue(vk,out var key)) return false;

                // UX4 reads the physical Talk key independently. Essential sees
                // it as released while the Talk lease is active.
                if (key.Talk) return true;

                if (key.Router) {
                    down = key.Pulse;
                    key.Pulse = false;
                    return true;
                }

                // After an owner disappears, suppress a still-held key until its
                // real physical release. This prevents a synthetic half-press.
                if (key.Drain) {
                    if (!physicalDown) { key.Drain = false; keys.Remove(vk); }
                    return true;
                }

                keys.Remove(vk);
                return false;
            }
        }
    }
}
