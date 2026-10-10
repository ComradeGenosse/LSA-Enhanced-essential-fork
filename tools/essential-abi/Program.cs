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
    "IsAnyAudioPlayingOrPending", 0x02);
StaticPublicMethod("LosSantosAlive.Input.TextInputService","get_IsOpen",0x02);
StaticPublicMethod("LosSantosAlive.Core.LsaControlsMenu","get_BlocksLsaInput",0x02); // System.Boolean
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


// Source inspection only, never executed inside Essential or used for admission.
// Decode *actual* IL instructions rather than looking for call bytes inside
// arguments/strings. Print small, relevant transition maps for offline audit.
var opcodeMap=new Dictionary<ushort,System.Reflection.Emit.OpCode>();
foreach(var field in typeof(System.Reflection.Emit.OpCodes).GetFields(
    BindingFlags.Static|BindingFlags.Public))
{
    if(field.GetValue(null) is System.Reflection.Emit.OpCode op)
        opcodeMap[unchecked((ushort)op.Value)]=op;
}
string MemberName(int token)
{
    try {
        var h=System.Reflection.Metadata.Ecma335.MetadataTokens.EntityHandle(token);
        switch(h.Kind) {
            case HandleKind.MethodDefinition:
                return metadata.GetString(metadata.GetMethodDefinition((MethodDefinitionHandle)h).Name);
            case HandleKind.MemberReference:
                var mr=metadata.GetMemberReference((MemberReferenceHandle)h);
                return metadata.GetString(mr.Name);
            case HandleKind.FieldDefinition:
                return metadata.GetString(metadata.GetFieldDefinition((FieldDefinitionHandle)h).Name);
            case HandleKind.MethodSpecification:
                var spec=metadata.GetMethodSpecification((MethodSpecificationHandle)h);
                return MemberName(System.Reflection.Metadata.Ecma335.MetadataTokens.GetToken(spec.Method));
            case HandleKind.TypeDefinition:
                return metadata.GetString(metadata.GetTypeDefinition((TypeDefinitionHandle)h).Name);
            case HandleKind.TypeReference:
                return metadata.GetString(metadata.GetTypeReference((TypeReferenceHandle)h).Name);
        }
    } catch {}
    return "token_0x"+token.ToString("X8");
}
IEnumerable<(int Offset,string Op,string Operand)> Disassemble(byte[] bytes)
{
    int i=0;
    while(i<bytes.Length) {
        int offset=i;
        ushort code=bytes[i++];
        if(code==0xfe && i<bytes.Length)code=(ushort)(0xfe00|bytes[i++]);
        if(!opcodeMap.TryGetValue(code,out var op))yield break;
        int operandSize=0;
        switch(op.OperandType) {
            case System.Reflection.Emit.OperandType.InlineNone:break;
            case System.Reflection.Emit.OperandType.ShortInlineBrTarget:
            case System.Reflection.Emit.OperandType.ShortInlineI:
            case System.Reflection.Emit.OperandType.ShortInlineVar:operandSize=1;break;
            case System.Reflection.Emit.OperandType.InlineVar:operandSize=2;break;
            case System.Reflection.Emit.OperandType.InlineI:
            case System.Reflection.Emit.OperandType.InlineBrTarget:
            case System.Reflection.Emit.OperandType.InlineField:
            case System.Reflection.Emit.OperandType.InlineMethod:
            case System.Reflection.Emit.OperandType.InlineSig:
            case System.Reflection.Emit.OperandType.InlineString:
            case System.Reflection.Emit.OperandType.InlineTok:
            case System.Reflection.Emit.OperandType.InlineType:
            case System.Reflection.Emit.OperandType.ShortInlineR:operandSize=4;break;
            case System.Reflection.Emit.OperandType.InlineI8:
            case System.Reflection.Emit.OperandType.InlineR:operandSize=8;break;
            case System.Reflection.Emit.OperandType.InlineSwitch:
                if(i+4>bytes.Length)yield break;
                operandSize=4+4*BitConverter.ToInt32(bytes,i);break;
        }
        if(operandSize<0 || i+operandSize>bytes.Length)yield break;
        string operand="";
        if(operandSize==4 && (op.OperandType==System.Reflection.Emit.OperandType.InlineField ||
             op.OperandType==System.Reflection.Emit.OperandType.InlineMethod ||
             op.OperandType==System.Reflection.Emit.OperandType.InlineTok ||
             op.OperandType==System.Reflection.Emit.OperandType.InlineType))
            operand=MemberName(BitConverter.ToInt32(bytes,i));
        else if(op.OperandType==System.Reflection.Emit.OperandType.InlineString) {
            try {operand=metadata.GetUserString(System.Reflection.Metadata.Ecma335.MetadataTokens.UserStringHandle(BitConverter.ToInt32(bytes,i)));}catch{}
            if(operand.Length>70)operand=operand.Substring(0,70);
        } else if(op.OperandType==System.Reflection.Emit.OperandType.InlineI ||
                  op.OperandType==System.Reflection.Emit.OperandType.ShortInlineI)
            operand=operandSize==4?BitConverter.ToInt32(bytes,i).ToString():((sbyte)bytes[i]).ToString();
        i+=operandSize;
        yield return (offset,op.Name??"unknown",operand);
    }
}
var interested=new Dictionary<string,HashSet<string>> {
    ["LosSantosAlive.Input.InputController"]=new HashSet<string> {
        "Update","SendMicStart","SendMicStop","SendTextPrompt"},
    ["LosSantosAlive.Input.TextInputService"]=new HashSet<string>{
        "StartTextInputMode","get_IsOpen"},
    ["LosSantosAlive.Context.ConversationHydrationCoordinator"]=new HashSet<string>{
        "BeginMicTurn","MarkMicReleased","Update"},
    ["LosSantosAlive.Bridge.SpecialTurns.SpecialGeminiTurnService"]=new HashSet<string>{
        "NotifyPlayerTurnStarted","ReadPlayerTurnVersion","SendNow"},
    ["LosSantosAlive.NPC.NpcTargeting"]=new HashSet<string>{
        "SetPlayerConversationPed","ClearPlayerConversationPed","GetPlayerConversationPed",
        "ActivateAttention","GetCurrentSpeakerPed","ClearCurrentSpeaker"}
};
var watched=new HashSet<string> {
    "NotifyPlayerTurnStarted","SendMicStart","SendMicStop","SendTextPrompt",
    "BeginMicTurn","MarkMicReleased","StartTextInputMode"};
foreach(var handle in metadata.TypeDefinitions)
{
    var type=metadata.GetTypeDefinition(handle);
    var typeName=metadata.GetString(type.Namespace)+"."+metadata.GetString(type.Name);
    foreach(var mh in type.GetMethods()) {
        var m=metadata.GetMethodDefinition(mh);
        if(m.RelativeVirtualAddress==0)continue;
        string mn=metadata.GetString(m.Name);
        var il=Disassemble(pe.GetMethodBody(m.RelativeVirtualAddress).GetILBytes().ToArray()).ToList();
        if(interested.TryGetValue(typeName,out var methods) && methods.Contains(mn)) {
            var edges=il.Where(x=>x.Op=="call"||x.Op=="callvirt"||
                x.Op=="newobj"||x.Op=="ldsfld"||x.Op=="stsfld"||
                x.Op=="ldsflda"||x.Op=="stfld"||x.Op=="ldfld"||x.Op=="ldstr")
                .Take(90).Select(x=>x.Offset.ToString("X4")+":"+x.Op+" "+x.Operand);
            Console.WriteLine("ABI_OWNER_IL "+typeName+"."+mn+" "+
                string.Join(" ; ",edges));
        }
        foreach(var instr in il.Where(x=>(x.Op=="call"||x.Op=="callvirt")&&watched.Contains(x.Operand)))
            Console.WriteLine("ABI_OWNER_CALLER "+typeName+"."+mn+" -> "+instr.Operand+" @"+instr.Offset.ToString("X4"));
    }
}


// Production player-priority monitor must patch exactly these entrypoints
// under the pinned hash. This is metadata/IL source verification only; it
// does not authorize a global idle state or exercise Harmony/GTA.
void CheckHookEntry(string typeName,string methodName,int count)
{
    TypeDefinition? type=null;
    foreach(var h in metadata.TypeDefinitions) {
        var candidate=metadata.GetTypeDefinition(h);
        if(metadata.GetString(candidate.Namespace)+"."+metadata.GetString(candidate.Name)==typeName) {
            type=candidate;break;
        }
    }
    if(type==null)throw new Exception("Core hook type missing: "+typeName);
    bool found=false;
    foreach(var h in type.Value.GetMethods()) {
        var m=metadata.GetMethodDefinition(h);
        if(metadata.GetString(m.Name)!=methodName)continue;
        var signature=metadata.GetBlobBytes(m.Signature);
        if(signature.Length<3 || (signature[0]&0x20)!=0 || signature[1]!=count ||
           (m.Attributes&MethodAttributes.Static)==0 || m.RelativeVirtualAddress==0)
            continue;
        if(found)throw new Exception("Ambiguous hook method "+typeName+"."+methodName);
        found=true;
    }
    if(!found)throw new Exception("Core hook ABI mismatch: "+typeName+"."+methodName+"/"+count);
}
CheckHookEntry("LosSantosAlive.Input.InputController","SendMicStop",0);
CheckHookEntry("LosSantosAlive.Input.InputController","SendTextPrompt",2);
CheckHookEntry("LosSantosAlive.Input.TextInputService","StartTextInputMode",0);
CheckHookEntry("LosSantosAlive.Context.ConversationHydrationCoordinator","BeginMicTurn",1);
CheckHookEntry("LosSantosAlive.Context.ConversationHydrationCoordinator","MarkMicReleased",1);
CheckHookEntry("LosSantosAlive.NPC.NpcTargeting","SetPlayerConversationPed",1);
CheckHookEntry("LosSantosAlive.NPC.NpcTargeting","ClearPlayerConversationPed",0);
CheckHookEntry("LosSantosAlive.Bridge.SpecialTurns.SpecialGeminiTurnService","NotifyPlayerTurnStarted",0);
var sharedMic=metadata.GetMethodDefinition(
    System.Reflection.Metadata.Ecma335.MetadataTokens.MethodDefinitionHandle(0x16f));
var owner=metadata.GetTypeDefinition(sharedMic.GetDeclaringType());
if(metadata.GetString(owner.Namespace)+ "."+metadata.GetString(owner.Name)!="LosSantosAlive.Input.InputController" ||
    (sharedMic.Attributes & MethodAttributes.Static)==0 || sharedMic.RelativeVirtualAddress==0)
    throw new Exception("Source-pinned shared original mic entry is unavailable");
var micStart=metadata.TypeDefinitions.Select(h=>metadata.GetTypeDefinition(h))
    .First(t=>metadata.GetString(t.Namespace)+"."+metadata.GetString(t.Name)=="LosSantosAlive.Input.InputController")
    .GetMethods().Select(h=>metadata.GetMethodDefinition(h))
    .Where(m=>metadata.GetString(m.Name)=="SendMicStart").ToArray();
if(micStart.Length!=2)throw new Exception("Original public mic wrappers drifted");
foreach(var wrapper in micStart) {
    var bytes=pe.GetMethodBody(wrapper.RelativeVirtualAddress).GetILBytes().ToArray();
    var signature=new byte[]{0x28,0x6f,0x01,0x00,0x06};
    if(!Enumerable.Range(0,bytes.Length-signature.Length+1)
        .Any(i=>bytes.Skip(i).Take(signature.Length).SequenceEqual(signature)))
        throw new Exception("Stock mic wrapper no longer calls source-pinned shared entry");
}
Console.WriteLine("PASS source-pinned original mic/text/target/hydration player epoch hook ABI");
