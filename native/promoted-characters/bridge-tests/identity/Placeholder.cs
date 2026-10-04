namespace LSA.BridgeTests
{
    // The bridge runtime links its own P1 substitutes; this file only gives
    // DomainHost.Start the LSA.SessionIdentity.dll it loads first.
    internal static class IdentityPlaceholder { }
}
