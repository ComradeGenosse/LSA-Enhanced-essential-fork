using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;

// Metadata-only: never execute Essential, load its dependencies, or call GTA.
// The test doubles cannot establish the public ABI of the actual pinned Core.
const string expectedSha256 = "9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653";
var path = args.Length == 1 ? args[0] :
    "lsa-essential-e1-candidate/upstream/LosSantosAlive.dll";
if (!File.Exists(path)) throw new Exception("Core DLL absent: " + path);
string hash = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant();
if (hash != expectedSha256) throw new Exception("Core SHA-256 mismatch");
using var file = File.OpenRead(path);
using var pe = new PEReader(file);
if (!pe.HasMetadata) throw new Exception("Core missing CLR metadata");
var metadata = pe.GetMetadataReader();

TypeDefinition Type(string fullName)
{
    foreach (var h in metadata.TypeDefinitions)
    {
        var t = metadata.GetTypeDefinition(h);
        string name = metadata.GetString(t.Namespace) + "." + metadata.GetString(t.Name);
        if (name == fullName)
        {
            if ((t.Attributes & TypeAttributes.VisibilityMask) != TypeAttributes.Public)
                throw new Exception(fullName + " is not public");
            return t;
        }
    }
    throw new Exception("Type absent: " + fullName);
}

void StaticPublicMethod(string typeName, string methodName, byte returnType)
{
    var t = Type(typeName);
    foreach (var h in t.GetMethods())
    {
        var m = metadata.GetMethodDefinition(h);
        if (metadata.GetString(m.Name) != methodName) continue;
        if ((m.Attributes & MethodAttributes.MemberAccessMask) != MethodAttributes.Public ||
            (m.Attributes & MethodAttributes.Static) == 0)
            throw new Exception("Core method is not public static: " + methodName);
        var signature = metadata.GetBlobBytes(m.Signature);
        // IMAGE_CEE_CS_CALLCONV_DEFAULT, 0 parameters, primitive return type.
        if (signature.Length != 3 || signature[0] != 0 || signature[1] != 0 ||
            signature[2] != returnType)
            throw new Exception("Unexpected signature for " + methodName +
                ": " + Convert.ToHexString(signature));
        return;
    }
    throw new Exception("Core method absent: " + methodName);
}

void PublicField(string typeName, string fieldName, byte primitiveType)
{
    var t = Type(typeName);
    foreach (var h in t.GetFields())
    {
        var f = metadata.GetFieldDefinition(h);
        if (metadata.GetString(f.Name) != fieldName) continue;
        if ((f.Attributes & FieldAttributes.FieldAccessMask) != FieldAttributes.Public)
            throw new Exception("Core field is not public: " + fieldName);
        var signature = metadata.GetBlobBytes(f.Signature);
        if (signature.Length != 2 || signature[0] != 0x06 ||
            signature[1] != primitiveType)
            throw new Exception("Unexpected signature for " + fieldName +
                ": " + Convert.ToHexString(signature));
        return;
    }
    throw new Exception("Core field absent: " + fieldName);
}

StaticPublicMethod("LosSantosAlive.Bridge.SpecialTurns.SpecialGeminiTurnService",
    "ReadPlayerTurnVersion", 0x0a); // System.Int64
StaticPublicMethod("LosSantosAlive.Audio.NpcPlaybackCoordinator",
    "IsAnyAudioPlayingOrPending", 0x02); // System.Boolean
foreach (string evt in new[] {
    "LosSantosAlive.Audio.NpcPlaybackStartedEvent",
    "LosSantosAlive.Audio.NpcPlaybackEndedEvent"})
{
    PublicField(evt, "TurnId", 0x0e); // System.String
    PublicField(evt, "GenerationId", 0x0a); // System.Int64
}
PublicField("LosSantosAlive.Audio.NpcPlaybackEndedEvent",
    "PlaybackStarted", 0x02); // System.Boolean
Console.WriteLine("PASS pinned Essential SHA-256 + public method and playback tuple metadata");
