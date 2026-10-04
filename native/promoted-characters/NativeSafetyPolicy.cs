using System;
using System.Collections.Generic;

namespace LSA.PromotedCharacters
{
    public static class NativeSafetyPolicy
    {
        public static bool CanControl(bool exists, bool dead, bool player, bool scripted, bool externalOwner, bool directedInteraction) =>
            exists && !dead && !player && !scripted && !externalOwner && !directedInteraction;
        public static bool Current(string expected, string actual) => !string.IsNullOrEmpty(expected) && expected == actual;
        public static bool Fresh(long expiresAtUtc, long nowUtc) => expiresAtUtc > nowUtc && expiresAtUtc - nowUtc <= 5000;
        public static bool Fresh(string operation,long expiresAtUtc,long nowUtc) =>
            expiresAtUtc > nowUtc && expiresAtUtc - nowUtc <= (operation == "spawn" ? 60000 : 5000);
        public static bool VariationAvailable(int drawable,int texture,int drawableCount,int textureCount) =>
            drawable >= 0 && drawable < drawableCount && texture >= 0 && texture < textureCount;
    }
    // Shared production request admission, independent of RAGE for offline tests.
    public sealed class OperationAdmission
    {
        // P2 pipe operations. "current" is the read-only UX phase 1 inspection;
        // it creates no capture ticket, ownership, task or session.
        public static readonly IReadOnlyList<string> ControlOperations = Array.AsReadOnly(new[] {"capture","register","inspect","spawn","follow","wait","dismiss","despawn","release","roster","current"});
        readonly string epoch, world;
        readonly HashSet<string> operations;
        readonly HashSet<string> seen = new HashSet<string>();
        readonly Queue<string> order = new Queue<string>();
        public OperationAdmission(string epoch, string world) : this(epoch,world,ControlOperations) { }
        public OperationAdmission(string epoch, string world, IEnumerable<string> operations) { this.epoch = epoch; this.world = world; this.operations = new HashSet<string>(operations); }
        public bool Admit(string requestId, string ownerEpoch, string worldProfileId, string operation, long expiresAtUtc, long nowUtc)
        {
            if (!Guid.TryParseExact(requestId,"D",out _) || epoch != ownerEpoch || world != worldProfileId || operation == null || !operations.Contains(operation) || !NativeSafetyPolicy.Fresh(operation,expiresAtUtc,nowUtc) || !seen.Add(requestId)) return false;
            order.Enqueue(requestId); while (order.Count > 256) seen.Remove(order.Dequeue()); return true;
        }
    }
}
