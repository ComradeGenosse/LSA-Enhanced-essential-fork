namespace LSA.Enhanced.Input
{
    // Primitive-only calls into the pinned Essential AppDomain. No OS injection.
    public interface IEssentialInputBridge
    {
        bool LeaseInput(int markKey, int textKey);
        bool PulseInput(int key);
        void ReleaseInput();
    }
}
