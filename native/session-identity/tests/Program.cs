using LSA.SessionIdentity;
using System.Text.Json;

const string world = "11111111-1111-4111-8111-111111111111";
int passed = 0;
void Check(bool condition) { if (!condition) throw new Exception("Owner evidence invariant failed."); passed++; }
var store = new NativeIdentityEvidenceStore();
var revoked = new List<RegistrationToken>();
store.Revoked += (_, token) => revoked.Add(token);
var old = store.Register("17", "companion.alex", world, () => true);
Check(store.TryResolveCurrent("17", 1000, out var original) == "active");
Check(original.sourceKey == "companion.alex" && original.incarnationId == old.IncarnationId);
Check(store.TryResolveCurrent("17", 1001, out var refreshed) == "active" && refreshed.observationSequence > original.observationSequence);
Check(store.Retire(old));
var next = store.Register("92", "companion.alex", world, () => true);
Check(next.IncarnationId != old.IncarnationId);
Check(!store.Retire(old));
Check(store.TryResolveCurrent("92", 1002, out var returning) == "active" && returning.sourceKey == original.sourceKey);
var clone = store.Register("93", "companion.alex", world, () => true);
Check(store.TryResolveCurrent("92", 1003, out _) == "conflict");
Check(store.TryResolveCurrent("93", 1003, out _) == "conflict");
Check(revoked.Contains(next) && revoked.Contains(clone));
store.Retire(clone);
Check(store.TryResolveCurrent("92", 1004, out _) == "conflict"); // No automatic repair after disagreement.
store.Retire(next);
var clean = store.Register("92", "companion.alex", world, () => true);
Check(store.TryResolveCurrent("92", 1005, out _) == "active");
bool live = true;
var mortal = store.Register("94", "other", world, () => live);
live = false; store.ValidateActive();
Check(store.TryResolveCurrent("94", 1006, out _) == "absent" && revoked.Contains(mortal));
var restarted = new NativeIdentityEvidenceStore();
Check(restarted.AdapterEpoch != store.AdapterEpoch && !restarted.Retire(clean));
Check(restarted.TryResolveCurrent("92", 1007, out _) == "absent");
bool threadRejected = await Task.Run(() => { try { store.Register("95", "illegal", world, () => true); return false; } catch (InvalidOperationException) { return true; } });
Check(threadRejected);
using var authorizedFiber = new ThreadLocal<bool>(() => false);
var fiberStore = new NativeIdentityEvidenceStore(() => authorizedFiber.Value);
bool creatorRejected = false, otherFiberAccepted = false, workerRejected = false;
try { fiberStore.Register("96", "unauthorized", world, () => true); } catch (InvalidOperationException) { creatorRejected = true; }
var fiberThread = new Thread(() => {
    authorizedFiber.Value = true;
    var token = fiberStore.Register("96", "authorized", world, () => true);
    otherFiberAccepted = fiberStore.TryResolveCurrent("96", 1008, out _) == "active" && fiberStore.Retire(token);
    authorizedFiber.Value = false;
    try { fiberStore.ValidateActive(); } catch (InvalidOperationException) { workerRejected = true; }
});
fiberThread.Start(); fiberThread.Join();
Check(creatorRejected); Check(otherFiberAccepted); Check(workerRejected);
// Continue on the captured owner thread: no awaits before further store mutations.
Console.WriteLine(JsonSerializer.Serialize(new { passed, claim = original }, new JsonSerializerOptions { IncludeFields = true }));
