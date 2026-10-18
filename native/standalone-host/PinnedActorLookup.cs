using System;

namespace LSA.Standalone.RageHost
{
    // Executed only by the owning game fiber. A queued auto-smoke handle is
    // not a persistent entity reference: validate it immediately before
    // resolution and fail closed if the entity disappeared or was recycled.
    // Injecting the three checks makes this safety rule testable without GTA.
    internal static class PinnedActorLookup
    {
        internal static bool TryResolve<T>(int pinnedHandle, Func<int, bool> exists,
            Func<int, bool> isPed, Func<int, T> resolve, Func<T, bool> eligible,
            out T target) where T : class
        {
            target = null;
            if (pinnedHandle <= 0) return false;
            try
            {
                if (!exists(pinnedHandle) || !isPed(pinnedHandle))
                    return false;
                T resolved = resolve(pinnedHandle);
                if (resolved == null || !eligible(resolved))
                    return false;
                target = resolved;
                return true;
            }
            catch (Exception)
            {
                // World.GetEntityByHandle<T> may throw after a handle is
                // invalidated, even after the native existence checks.
                target = null;
                return false;
            }
        }
    }
}
