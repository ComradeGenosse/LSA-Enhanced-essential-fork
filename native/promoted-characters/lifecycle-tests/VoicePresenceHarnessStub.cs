using System;
namespace LSA.PromotedCharacters {
    // Test-only substitute: existing P2 harnesses must not load Essential.
    internal sealed class NpcVoicePresenceObserver : IDisposable {
        internal NpcVoicePresenceObserver(string mode) { }
        internal void Attach() { }
        internal void Update(int epoch,long atMs) { }
        public void Dispose() { }
    }
}
