using System.Reflection;
using System.Reflection.Emit;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;

// Offline metadata + IL call-graph CENSUS of the exact pinned Essential DLL.
// Never load, execute, rewrite, deobfuscate, or package the Core assembly.
const string pin = "9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653";
string path = args.Length == 1 ? args[0] : "lsa-essential-e1-candidate/upstream/LosSantosAlive.dll";
if (!File.Exists(path)) throw new Exception("Essential DLL missing");
using var file = File.OpenRead(path);
if (Convert.ToHexString(SHA256.HashData(file)).ToLowerInvariant() != pin)
    throw new Exception("Essential hash mismatch: refuse an unpinned renderer");
file.Position = 0;
using var pe = new PEReader(file);
if (!pe.HasMetadata) throw new Exception("Missing CLI metadata");
var md = pe.GetMetadataReader();
var declaring = new Dictionary<MethodDefinitionHandle, string>();
var inspected = new List<(string owner, MethodDefinitionHandle handle)>();
foreach (var h in md.TypeDefinitions) {
    var t=md.GetTypeDefinition(h);
    string ns=md.GetString(t.Namespace),name=md.GetString(t.Name);
    string full=ns.Length==0?name:ns+"."+name;
    foreach(var m in t.GetMethods()) {
        declaring[m]=full;
        if (ns.StartsWith("LosSantosAlive.Audio",StringComparison.Ordinal) ||
            name.Contains("Spatial",StringComparison.OrdinalIgnoreCase) ||
            name.Contains("Wave",StringComparison.OrdinalIgnoreCase))
            inspected.Add((full,m));
    }
}
var target = md.TypeDefinitions.Select(md.GetTypeDefinition).FirstOrDefault(t=>
    md.GetString(t.Namespace)=="LosSantosAlive.Audio" && md.GetString(t.Name)=="NpcSpatialAudio");
if (target.Equals(default(TypeDefinition))) throw new Exception("NpcSpatialAudio missing");
Console.WriteLine("PIN_OK Essential SHA256="+pin+" audio_methods="+inspected.Count);
foreach(var field in target.GetFields()) {
    var f=md.GetFieldDefinition(field);
    string name=md.GetString(f.Name);
    Console.WriteLine("RENDERER_FIELD "+name+" flags="+f.Attributes+" signature="+
        Convert.ToHexString(md.GetBlobBytes(f.Signature)));
}
foreach(var mh in target.GetMethods()) {
    var m=md.GetMethodDefinition(mh);
    Console.WriteLine("RENDERER_METHOD token=0x"+MetadataTokens.GetToken(mh).ToString("X8")+
        " "+md.GetString(m.Name)+" flags="+m.Attributes+
        " signature="+Convert.ToHexString(md.GetBlobBytes(m.Signature)));
}
var codeMap=new Dictionary<short,OpCode>();
foreach(var f in typeof(OpCodes).GetFields(BindingFlags.Public|BindingFlags.Static)) {
    if(f.FieldType==typeof(OpCode) && f.GetValue(null) is OpCode oc)codeMap[oc.Value]=oc;
}
string Resolve(int token) {
    try {
        var h=MetadataTokens.EntityHandle(token);
        if(h.Kind==HandleKind.MethodDefinition) {
            var def=(MethodDefinitionHandle)h;
            return declaring.GetValueOrDefault(def,"?")+"."+md.GetString(md.GetMethodDefinition(def).Name);
        }
        if(h.Kind==HandleKind.MemberReference) {
            var r=md.GetMemberReference((MemberReferenceHandle)h);
            string name=md.GetString(r.Name);
            var parent=r.Parent;
            string owner=parent.Kind switch {
                HandleKind.TypeReference=>md.GetString(md.GetTypeReference((TypeReferenceHandle)parent).Namespace)+"."+
                    md.GetString(md.GetTypeReference((TypeReferenceHandle)parent).Name),
                HandleKind.TypeDefinition=>md.GetString(md.GetTypeDefinition((TypeDefinitionHandle)parent).Namespace)+"."+
                    md.GetString(md.GetTypeDefinition((TypeDefinitionHandle)parent).Name),
                HandleKind.TypeSpecification=>"typespec",
                _=>parent.Kind.ToString()
            };
            return owner+"."+name;
        }
        if(h.Kind==HandleKind.MethodSpecification)
            return Resolve(MetadataTokens.GetToken(md.GetMethodSpecification((MethodSpecificationHandle)h).Method));
        return h.Kind.ToString();
    } catch{return "unresolved";}
}
foreach(var (owner,mh) in inspected) {
    var m=md.GetMethodDefinition(mh);
    string name=md.GetString(m.Name);
    bool interesting=owner.Contains("NpcSpatialAudio") || name=="Read" ||
        name.Contains("Mix",StringComparison.OrdinalIgnoreCase) ||
        name.Contains("Queue",StringComparison.OrdinalIgnoreCase) ||
        name.Contains("Volume",StringComparison.OrdinalIgnoreCase) ||
        name.Contains("Pan",StringComparison.OrdinalIgnoreCase) ||
        name.Contains("Filter",StringComparison.OrdinalIgnoreCase);
    if(!interesting || m.RelativeVirtualAddress==0)continue;
    var il=pe.GetMethodBody(m.RelativeVirtualAddress).GetILBytes();
    Console.WriteLine("BODY "+owner+"."+name+" token=0x"+MetadataTokens.GetToken(mh).ToString("X8")+
        " il_bytes="+il.Length);
    int pos=0,edges=0;
    while(pos<il.Length) {
        int offset=pos;
        byte b=il[pos++];
        short value=b==0xFE && pos<il.Length?(short)(0xFE00|il[pos++]):(short)b;
        if(!codeMap.TryGetValue(value,out var op)) break;
        int operandStart=pos,n=0;
        switch(op.OperandType) {
            case OperandType.InlineNone:break;
            case OperandType.ShortInlineBrTarget:
            case OperandType.ShortInlineI:
            case OperandType.ShortInlineVar:n=1;break;
            case OperandType.InlineVar:n=2;break;
            case OperandType.InlineI:
            case OperandType.InlineBrTarget:
            case OperandType.ShortInlineR:
            case OperandType.InlineString:
            case OperandType.InlineSig:
            case OperandType.InlineMethod:
            case OperandType.InlineField:
            case OperandType.InlineType:
            case OperandType.InlineTok:n=4;break;
            case OperandType.InlineI8:
            case OperandType.InlineR:n=8;break;
            case OperandType.InlineSwitch:
                if(pos+4>il.Length){pos=il.Length;continue;}
                n=4+4*BitConverter.ToInt32(il.AsSpan(pos,4));break;
            default:throw new Exception("Unhandled IL operand "+op.OperandType);
        }
        if(n<0 || pos+n>il.Length)break;
        pos+=n;
        if(op.OperandType is OperandType.InlineMethod or OperandType.InlineField or OperandType.InlineType) {
            int token=BitConverter.ToInt32(il.AsSpan(operandStart,4));
            var resolved=Resolve(token);
            if(edges++<80)Console.WriteLine("EDGE "+offset.ToString("X4")+" "+op.Name+" -> "+resolved);
        }
    }
}
Console.WriteLine("CENSUS_DONE metadata_only no_renderer_modified");
