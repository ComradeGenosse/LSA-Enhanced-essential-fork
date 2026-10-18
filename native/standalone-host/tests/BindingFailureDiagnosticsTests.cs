using System;
using System.IO;
using LSA.Standalone.RageHost;

internal static class BindingFailureDiagnosticsTests
{
    private static int checks;

    private static void Check(Exception error, string expected)
    {
        string actual = BindingFailureDiagnostics.Summary(error);
        if (!string.Equals(actual, expected, StringComparison.Ordinal))
            throw new InvalidOperationException(
                "binding_diagnostics_mismatch expected=" + expected + " actual=" + actual);
        checks++;
    }

    public static int Main()
    {
        Check(new MissingMethodException(
            "Method not found: 'Int32 Rage.Game.get_GameTime()'."),
            "kind=MissingMethodException member=Int32 Rage.Game.get_GameTime()");
        Check(new MissingMethodException(
            "Method not found: '!!0 Rage.Native.NativeFunction.CallByName(System.String, System.Object[])'."),
            "kind=MissingMethodException member=!!0 Rage.Native.NativeFunction.CallByName(System.String, System.Object[])");
        Check(new MissingFieldException(
            "Field not found: 'Int32 Rage.Entity.SomeField'."),
            "kind=MissingFieldException member=Int32 Rage.Entity.SomeField");
        Check(new FileNotFoundException(
            "Could not load local path C:\\Users\\Private\\secrets.json", 
            "LSA.Standalone.Core, Version=0.0.0.0, Culture=neutral"),
            "kind=FileNotFoundException assembly=LSA.Standalone.Core");
        Check(new BadImageFormatException(
            "private-config-path C:\\Users\\Private\\config.txt",
            "RagePluginHook.dll"),
            "kind=BadImageFormatException assembly=RagePluginHook.dll");
        Check(new FileNotFoundException(
            "private config has secret=ALPHA", 
            "C:\\Users\\Private\\secret.dll"),
            "kind=FileNotFoundException");
        Check(new MissingMethodException(
            "Method not found: 'Rage.Game.Path(C:\\Users\\Private\\secret.txt)'."),
            "kind=MissingMethodException");
        Check(new MissingMethodException(
            "user supplied custom error: bearer=ALPHA"),
            "kind=MissingMethodException");
        Check(new MissingFieldException("Field not found: 'BadConfig=ALPHA'."),
            "kind=MissingFieldException");
        Check(new TypeLoadException("private token=ALPHA"), "kind=TypeLoadException");
        Check(new InvalidOperationException("private token=ALPHA"),
            "kind=InvalidOperationException");
        Check(null, "kind=Unknown");

        Console.WriteLine("BINDING_FAILURE_DIAGNOSTICS_PASS checks=" + checks);
        return 0;
    }
}
