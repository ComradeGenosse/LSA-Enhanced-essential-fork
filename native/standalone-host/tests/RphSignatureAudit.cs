using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;

// Inspect the metadata of the EXACT RageHost DLL that is about to be zipped.
// Compilation success alone cannot catch cached binaries compiled against
// our fake RPH assembly (same assembly name, wrong return type).
// The metadata APIs here are part of the installed .NET SDK, no new packages.
if (args.Length != 2)
    throw new ArgumentException("Provide official RPH DLL path and built host DLL path");

static bool UintGameTimeSignature(byte[] sig) =>
    sig.Length == 3 && sig[0] == 0x00 && sig[1] == 0x00 && sig[2] == 0x09;

static byte[] SdkGameTime(string path)
{
    using var file = File.OpenRead(path);
    using var pe = new PEReader(file);
    if (!pe.HasMetadata) throw new InvalidDataException("sdk_no_metadata");
    var metadata = pe.GetMetadataReader();
    var matches = new List<byte[]>();
    foreach (var typeHandle in metadata.TypeDefinitions)
    {
        var type = metadata.GetTypeDefinition(typeHandle);
        if (metadata.GetString(type.Name) != "Game" ||
            metadata.GetString(type.Namespace) != "Rage") continue;
        foreach (var methodHandle in type.GetMethods())
        {
            var method = metadata.GetMethodDefinition(methodHandle);
            if (metadata.GetString(method.Name) == "get_GameTime")
                matches.Add(metadata.GetBlobBytes(method.Signature));
        }
    }
    if (matches.Count != 1 || !UintGameTimeSignature(matches[0]))
        throw new InvalidDataException("official_rph_sdk_game_time_not_uint32");
    return matches[0];
}

static void AssertHostGameTime(string path, byte[] sdkSignature)
{
    using var file = File.OpenRead(path);
    using var pe = new PEReader(file);
    if (!pe.HasMetadata) throw new InvalidDataException("host_no_metadata");
    var metadata = pe.GetMetadataReader();
    var matches = new List<byte[]>();
    foreach (var handle in metadata.MemberReferences)
    {
        var member = metadata.GetMemberReference(handle);
        if (metadata.GetString(member.Name) == "get_GameTime")
            matches.Add(metadata.GetBlobBytes(member.Signature));
    }
    if (matches.Count != 1 || !matches[0].SequenceEqual(sdkSignature))
        throw new InvalidDataException("packaged_host_game_time_abi_mismatch");
}

var expected = SdkGameTime(args[0]);
AssertHostGameTime(args[1], expected);
Console.WriteLine("RPH Game.GameTime getter ABI verified: UInt32, no args; built host matches official SDK.");
