using System;
namespace LSA.PromotedCharacters {
    // Test-only substitute: existing P2 harnesses must not load Essential.
    internal sealed class NpcVoicePresenceObserver : IDisposable {
        internal NpcVoicePresenceObserver(string mode,bool mouthEnabled=false,float openLevel=0.015f,bool levelLog=false) { }
        internal void Attach() { }
        internal void Unsubscribe() { }
        internal void Update(int epoch,long atMs) { }
        public void Dispose() { }
    }
}
