using System;
using System.IO;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;

internal static class ExitPointSignatureTests
{
    // Static metadata-only gate: do NOT load or execute the RPH plugin.
    // The entry method named by PluginAttribute.ExitPoint must be public static
    // void Shutdown(bool isTerminating), per the official RPH SDK contract.
    public static int Main(string[] args)
    {
        if (args.Length != 1 || !File.Exists(args[0]))
            throw new ArgumentException("Pass the actual built LSA.Standalone.RageHost.dll.");
        if (!string.Equals(Path.GetFileName(args[0]), "LSA.Standalone.RageHost.dll",
            StringComparison.Ordinal))
            throw new InvalidOperationException("Wrong host DLL path.");

        using (var stream = File.OpenRead(args[0]))
        using (var pe = new PEReader(stream))
        {
            if (!pe.HasMetadata)
                throw new InvalidOperationException("Host lacks CLR metadata.");
            var metadata = pe.GetMetadataReader();
            int found = 0;
            foreach (var handle in metadata.TypeDefinitions)
            {
                var type = metadata.GetTypeDefinition(handle);
                if (metadata.GetString(type.Namespace) != "LSA.Standalone.RageHost" ||
                    metadata.GetString(type.Name) != "EntryPoint")
                    continue;

                foreach (var methodHandle in type.GetMethods())
                {
                    var method = metadata.GetMethodDefinition(methodHandle);
                    if (metadata.GetString(method.Name) != "Shutdown") continue;
                    found++;

                    if ((method.Attributes & MethodAttributes.MemberAccessMask) != MethodAttributes.Public ||
                        (method.Attributes & MethodAttributes.Static) == 0 ||
                        (method.Attributes & MethodAttributes.Abstract) != 0 ||
                        (method.Attributes & MethodAttributes.PinvokeImpl) != 0)
                        throw new InvalidOperationException("RPH ExitPoint must be concrete public static.");

                    var signature = metadata.GetBlobReader(method.Signature);
                    var header = signature.ReadSignatureHeader();
                    if (header.Kind != SignatureKind.Method || header.IsInstance || header.IsGeneric ||
                        signature.ReadCompressedInteger() != 1 ||
                        signature.ReadByte() != 0x01 || // ELEMENT_TYPE_VOID
                        signature.ReadByte() != 0x02 || // ELEMENT_TYPE_BOOLEAN
                        signature.RemainingBytes != 0)
                        throw new InvalidOperationException(
                            "RPH ExitPoint must be exactly void Shutdown(bool isTerminating).");
                }
            }

            if (found != 1)
                throw new InvalidOperationException(
                    "Exactly one EntryPoint.Shutdown(bool) method must exist; found=" + found);
        }

        Console.WriteLine("RPH_EXITPOINT_SIGNATURE_PASS void Shutdown(bool) public static");
        return 0;
    }
}
