using System;
using System.Collections.Generic;
using System.Web.Script.Serialization;

namespace LSA.Enhanced.Commands
{
    // Loader-side seams, so the dispatcher, router and view models are testable
    // without RPH, Windows input or a running companion.
    public interface INativeBridge
    {
        bool Available {get;}
        string Submit(string envelope);
        string TryTakeResult(string id);
        string Snapshot();
        void RequestSnapshots(int forMs);
    }
    public sealed class CompanionReply
    {
        public bool Ok;
        public int Status;
        public string Body;    // only when the caller asked for it
        public string Error;   // a bounded reason code
    }
    public interface ICompanion
    {
        // Runs off the game fiber; done may be invoked on any thread.
        void Post(string body,int maxBodyBytes,int timeoutMs,Action<CompanionReply> done);
    }
    public interface IHud { void Show(string text); }
    public interface IUiController
    {
        bool Available {get;}
        bool AnyMenuOpen {get;}
        void Toggle(string page);
    }
    public interface IClock
    {
        long Monotonic {get;}
        long Utc {get;}
    }
    public sealed class SystemClock : IClock
    {
        static readonly System.Diagnostics.Stopwatch Watch = System.Diagnostics.Stopwatch.StartNew();
        public long Monotonic => Watch.ElapsedMilliseconds;
        public long Utc => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }
    // CommandEnvelope v1 for the runtime's LocalCommandQueue (exact fields only).
    public static class CommandEnvelope
    {
        public const int LifetimeMs = 4000;
        public static string NewId() => Guid.NewGuid().ToString("D");
        public static string Build(string id,string command,string source,long utcNow,string expectedEncounterId = null,string phrase = null)
        {
            object target = command == "gates.read" ? new Dictionary<string,object> {{"kind","none"}}
                : expectedEncounterId == null ? new Dictionary<string,object> {{"kind","current"}}
                : new Dictionary<string,object> {{"kind","current"},{"expect",new Dictionary<string,object> {{"encounterId",expectedEncounterId}}}};
            var args = phrase == null ? new Dictionary<string,object>() : new Dictionary<string,object> {{"phrase",phrase}};
            return new JavaScriptSerializer().Serialize(new Dictionary<string,object> {{"v",1},{"id",id},{"command",command},{"target",target},{"args",args},{"source",source},{"issuedAtUtc",utcNow},{"expiresAtUtc",utcNow + LifetimeMs}});
        }
    }
}
