namespace LSA.Enhanced.Input
{
    // Primitive-only calls into the pinned Essential AppDomain. No OS injection.
    // Router Mark/Text and UX4 Talk leases are independent owners.
    public interface IEssentialInputBridge
    {
        bool LeaseInput(int markKey,int textKey);
        bool LeaseTalkInput(int talkKey);
        bool PulseInput(int key);
        void ReleaseInput();
        void ReleaseTalkInput();
    }
}
