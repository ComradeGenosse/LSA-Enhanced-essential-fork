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

// The stock Essential special-turn seam is *real*. This is only a
// source-compatibility receipt, not native permission to call Submit.
void StaticPublicSignature(string typeName,string methodName,string expectedHex)
{
    var t=Type(typeName);
    foreach(var h in t.GetMethods())
    {
        var m=metadata.GetMethodDefinition(h);
        if(metadata.GetString(m.Name)!=methodName) continue;
        if((m.Attributes & MethodAttributes.MemberAccessMask)!=MethodAttributes.Public ||
           (m.Attributes & MethodAttributes.Static)==0)
            throw new Exception(typeName+"."+methodName+" is not public static");
        var actual=Convert.ToHexString(metadata.GetBlobBytes(m.Signature));
        if(!actual.Equals(expectedHex,StringComparison.OrdinalIgnoreCase))
            throw new Exception("Unexpected signature for "+typeName+"."+methodName+
                ": "+actual);
        return;
    }
    throw new Exception("Core method absent: "+typeName+"."+methodName);
}
const string request="LosSantosAlive.Bridge.SpecialTurns.SpecialGeminiTurnRequest";
const string scheduler="LosSantosAlive.Bridge.SpecialTurns.SpecialGeminiTurnScheduler";
const string service="LosSantosAlive.Bridge.SpecialTurns.SpecialGeminiTurnService";
foreach(var field in new[]{"SpeakerPed","ListenerPed","SpeechTargetPed"})
{
    // Rage.Ped field (TypeDefOrRef token 0x31).
    var type=Type(request);bool matched=false;
    foreach(var handle in type.GetFields())
    {
        var definition=metadata.GetFieldDefinition(handle);
        if(metadata.GetString(definition.Name)!=field)continue;
        if((definition.Attributes & FieldAttributes.FieldAccessMask)!=FieldAttributes.Public ||
           Convert.ToHexString(metadata.GetBlobBytes(definition.Signature))!="061231")
            throw new Exception("Unexpected Ped ABI for "+field);
        matched=true;break;
    }
    if(!matched)throw new Exception("Essential request Ped field absent: "+field);
}
foreach(var field in new[]{"Content","Reason","DedupeKey"})
    PublicField(request,field,0x0e);
foreach(var field in new[]{"FaceListener","InterruptExisting","CancelIfPlayerStartsTurn",
    "RequireCurrentPlayerConversation","SkipIfSpeakerBusy"})
    PublicField(request,field,0x02);
PublicField(request,"DelayMilliseconds",0x08);
StaticPublicSignature(scheduler,"Submit","000102128A14");
StaticPublicSignature(scheduler,"SubmitAfterCurrentTurn","000102128A14");
StaticPublicSignature(service,"SendNow","000102128A14");
// Confirm the two Core NPC targeting reads are still source-compatible.
// Return is Rage.Ped (TypeDefOrRef coded index 0x31), not a bool that
// could be confused with a complete global Essential turn arbiter.
StaticPublicSignature("LosSantosAlive.NPC.NpcTargeting","GetPlayerConversationPed","00001231");
StaticPublicSignature("LosSantosAlive.NPC.NpcTargeting","GetCurrentSpeakerPed","00001231");
Console.WriteLine("PASS pinned Essential SHA-256 + Core targeting, playback callbacks + stock kb request ABI");


// Pin-compatible inventory of *possible* conversation ownership sources.
// Metadata is an ABI map, NOT proof of semantics, lifetime, or thread-safety.
// Output is restricted to relevant Core types to aid a separate IL/source audit.
foreach (var handle in metadata.TypeDefinitions)
{
    var definition = metadata.GetTypeDefinition(handle);
    var fullName = metadata.GetString(definition.Namespace) + "." + metadata.GetString(definition.Name);
    if (!fullName.StartsWith("LosSantosAlive.", StringComparison.Ordinal) ||
        !new[] { "Input", "Hydration", "Conversation", "Turn", "Dialogue", "Session", "Playback", "Audio" }
            .Any(term => fullName.Contains(term, StringComparison.OrdinalIgnoreCase))) continue;
    var methods = definition.GetMethods().Select(h => metadata.GetMethodDefinition(h))
        .Select(m => metadata.GetString(m.Name)).Where(n =>
            n.Contains("Mic", StringComparison.OrdinalIgnoreCase) ||
            n.Contains("Text", StringComparison.OrdinalIgnoreCase) ||
            n.Contains("Turn", StringComparison.OrdinalIgnoreCase) ||
            n.Contains("Active", StringComparison.OrdinalIgnoreCase) ||
            n.Contains("Busy", StringComparison.OrdinalIgnoreCase) ||
            n.Contains("Pending", StringComparison.OrdinalIgnoreCase) ||
            n.Contains("State", StringComparison.OrdinalIgnoreCase) ||
            n.Contains("Release", StringComparison.OrdinalIgnoreCase) ||
            n.Contains("Begin", StringComparison.OrdinalIgnoreCase) ||
            n.Contains("Update", StringComparison.OrdinalIgnoreCase) ||
            n.Contains("Stop", StringComparison.OrdinalIgnoreCase) ||
            n.Contains("Start", StringComparison.OrdinalIgnoreCase))
        .Distinct().Take(50).ToArray();
    var fields = definition.GetFields().Select(h => metadata.GetFieldDefinition(h))
        .Select(f => metadata.GetString(f.Name)).Where(n =>
            n.Contains("Mic", StringComparison.OrdinalIgnoreCase) ||
            n.Contains("Text", StringComparison.OrdinalIgnoreCase) ||
            n.Contains("Turn", StringComparison.OrdinalIgnoreCase) ||
            n.Contains("Pending", StringComparison.OrdinalIgnoreCase) ||
            n.Contains("Hydrat", StringComparison.OrdinalIgnoreCase) ||
            n.Contains("Active", StringComparison.OrdinalIgnoreCase) ||
            n.Contains("Busy", StringComparison.OrdinalIgnoreCase) ||
            n.Contains("State", StringComparison.OrdinalIgnoreCase))
        .Distinct().Take(30).ToArray();
    if (methods.Length + fields.Length > 0)
        Console.WriteLine("ABI_OWNER_SURFACE " + fullName + " methods=" +
            string.Join(",",methods) + " fields=" + string.Join(",",fields));
}


// Candidate IL edges for the stock player-input transitions. Exact method
// bodies, not their names, are necessary before treating a counter as global.
// The opcode scan is exploratory (operands can resemble opcodes): it prints
// possible direct callers but is never used as an admission verdict.
var transitionNames = new HashSet<string>(StringComparer.Ordinal) {
    "NotifyPlayerTurnStarted", "SendMicStart", "SendMicStop",
    "SendTextPrompt", "BeginMicTurn", "MarkMicReleased", "StartTextInputMode"
};
var transitionTokens = new Dictionary<int,string>();
foreach (var h in metadata.TypeDefinitions)
{
    var t = metadata.GetTypeDefinition(h);
    var n = metadata.GetString(t.Namespace)+"."+metadata.GetString(t.Name);
    foreach (var m in t.GetMethods())
    {
        var d = metadata.GetMethodDefinition(m);
        var methodName = metadata.GetString(d.Name);
        if (transitionNames.Contains(methodName) &&
            (n.StartsWith("LosSantosAlive.Input.") ||
             n.StartsWith("LosSantosAlive.Context.") ||
             n.StartsWith("LosSantosAlive.Bridge.SpecialTurns.")))
            transitionTokens[System.Reflection.Metadata.Ecma335.MetadataTokens.GetToken(m)] = n+"."+methodName;
    }
}
foreach (var h in metadata.TypeDefinitions)
{
    var t = metadata.GetTypeDefinition(h);
    var n = metadata.GetString(t.Namespace)+"."+metadata.GetString(t.Name);
    foreach (var m in t.GetMethods())
    {
        var d = metadata.GetMethodDefinition(m);
        if (d.RelativeVirtualAddress == 0) continue;
        var bytes = pe.GetMethodBody(d.RelativeVirtualAddress).GetILBytes().ToArray();
        var methodName = metadata.GetString(d.Name);
        foreach (var token in transitionTokens)
        {
            bool maybeCalls = false;
            for (int i=0;i+4<bytes.Length;i++)
            {
                if (bytes[i]!=0x28 && bytes[i]!=0x6f) continue;
                if (BitConverter.ToInt32(bytes,i+1)==token.Key) {maybeCalls = true; break;}
            }
            if (maybeCalls) Console.WriteLine("ABI_TRANSITION_EDGE " + n+"."+methodName+" => "+token.Value);
        }
        if ((n=="LosSantosAlive.Input.InputController" &&
                new[]{"SendMicStart","SendMicStop","SendTextPrompt"}.Contains(methodName)) ||
            (n=="LosSantosAlive.Context.ConversationHydrationCoordinator" &&
                new[]{"BeginMicTurn","MarkMicReleased","Update"}.Contains(methodName)) ||
            (n=="LosSantosAlive.Bridge.SpecialTurns.SpecialGeminiTurnService" &&
                new[]{"NotifyPlayerTurnStarted","ReadPlayerTurnVersion"}.Contains(methodName)))
            Console.WriteLine("ABI_TRANSITION_IL " + n+"."+methodName+
                " size="+bytes.Length+" prefix="+Convert.ToHexString(bytes.Take(1024).ToArray()));
    }
}
