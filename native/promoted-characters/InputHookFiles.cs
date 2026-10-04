using System.IO;

namespace LSA.PromotedCharacters
{
    public static class InputHookFiles
    {
        // RPH shadow-copies Core to Temp. Its assembly Location is useful for
        // the hash check, but never for locating installed game dependencies.
        public static string HarmonyPath(string applicationBase) { return Path.Combine(Path.GetFullPath(applicationBase),"0Harmony.dll"); }
    }
}
