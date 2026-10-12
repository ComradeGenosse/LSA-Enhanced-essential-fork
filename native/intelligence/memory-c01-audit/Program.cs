// Read-only research audit of the exact pinned original Core DLL.
// It does NOT register a callback, prove accepted C-01, or enable memory writes.
using System.Reflection;
using System.Reflection.Emit;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;
using System.Text.Json;

const string pinned = "9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653";
if (args.Length != 1) {
    Console.Error.WriteLine("Usage: CoreC01Audit <pinned LosSantosAlive.dll>");
    return 2;
}
var file = Path.GetFullPath(args[0]);
if (!File.Exists(file)) throw new FileNotFoundException("Pinned core is missing", file);
var hash = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file))).ToLowerInvariant();
if (hash != pinned) throw new InvalidOperationException("core_c01_audit_pin_mismatch");
using var stream = File.OpenRead(file);
using var pe = new PEReader(stream);
if (!pe.HasMetadata) throw new InvalidOperationException("core_c01_not_managed");
var md = pe.GetMetadataReader();
var signatures = new Names();
var methods = new Dictionary<MethodDefinitionHandle, (string Type, string Name, string Signature)>();
var methodNames = new Dictionary<MethodDefinitionHandle, string>();
foreach (var h in md.TypeDefinitions) {
    var def = md.GetTypeDefinition(h);
    var type = md.GetString(def.Namespace);
    var name = md.GetString(def.Name);
    var full = (type.Length > 0 ? type + "." : "") + name;
    foreach (var mh in def.GetMethods()) {
        var m = md.GetMethodDefinition(mh);
        var sig = m.DecodeSignature(signatures, (object?)null);
        var parameters = string.Join(", ", sig.ParameterTypes);
        var signature = sig.ReturnType + " (" + parameters + ")";
        methods[mh] = (full, md.GetString(m.Name), signature);
        methodNames[mh] = full + "::" + md.GetString(m.Name) + signature;
    }
}
var opcodeMap = typeof(OpCodes).GetFields(BindingFlags.Public | BindingFlags.Static)
    .Where(f => f.FieldType == typeof(OpCode))
    .Select(f => (OpCode)f.GetValue(null)!)
    .GroupBy(x => unchecked((ushort)x.Value))
    .ToDictionary(x => x.Key, x => x.First());
var calls = new List<(string Caller, string Callee, int IlOffset, string Opcode)>();
var badBodies = new List<string>();
foreach (var pair in methods) {
    var m = md.GetMethodDefinition(pair.Key);
    if (m.RelativeVirtualAddress == 0) continue;
    byte[] il;
    try { il = pe.GetMethodBody(m.RelativeVirtualAddress).GetILBytes().ToArray(); }
    catch (BadImageFormatException) { badBodies.Add(methodNames[pair.Key]); continue; }
    var i = 0;
    while (i < il.Length) {
        var offset = i;
        ushort value = il[i++];
        if (value == 0xfe) {
            if (i >= il.Length) { badBodies.Add(methodNames[pair.Key]); break; }
            value = (ushort)(0xfe00 | il[i++]);
        }
        if (!opcodeMap.TryGetValue(value, out var op)) {
            badBodies.Add(methodNames[pair.Key] + " @ " + offset + ": unknown opcode");
            break;
        }
        var size = 0;
        switch (op.OperandType) {
            case OperandType.InlineNone: size = 0; break;
            case OperandType.ShortInlineBrTarget:
            case OperandType.ShortInlineI:
            case OperandType.ShortInlineVar: size = 1; break;
            case OperandType.InlineVar: size = 2; break;
            case OperandType.InlineI:
            case OperandType.InlineBrTarget:
            case OperandType.InlineField:
            case OperandType.InlineMethod:
            case OperandType.InlineString:
            case OperandType.InlineSig:
            case OperandType.InlineTok:
            case OperandType.InlineType:
            case OperandType.ShortInlineR: size = 4; break;
            case OperandType.InlineI8:
            case OperandType.InlineR: size = 8; break;
            case OperandType.InlineSwitch:
                if (i + 4 > il.Length) { size = int.MaxValue; break; }
                var n = BitConverter.ToInt32(il, i);
                size = n < 0 || n > 100_000 ? int.MaxValue : checked(4 + n * 4);
                break;
            default: throw new InvalidOperationException("unexpected_operand_" + op.OperandType);
        }
        if (size == int.MaxValue || size > il.Length - i) {
            badBodies.Add(methodNames[pair.Key] + " @ " + offset + ": truncated operand");
            break;
        }
        if ((op == OpCodes.Call || op == OpCodes.Callvirt || op == OpCodes.Newobj) && size == 4) {
            var token = BitConverter.ToInt32(il, i);
            var callee = Resolve(token);
            calls.Add((methodNames[pair.Key], callee, offset, op.Name ?? "call"));
        }
        i += size;
    }
}
string Resolve(int token) {
    try {
        var h = MetadataTokens.EntityHandle(token);
        if (h.Kind == HandleKind.MethodDefinition) {
            var m = (MethodDefinitionHandle)h;
            return methodNames.TryGetValue(m, out var name) ? name : "[unknown_method]";
        }
        if (h.Kind == HandleKind.MemberReference) {
            var member = md.GetMemberReference((MemberReferenceHandle)h);
            var parent = member.Parent.Kind switch {
                HandleKind.TypeReference => md.GetString(md.GetTypeReference((TypeReferenceHandle)member.Parent).Name),
                HandleKind.TypeDefinition => md.GetString(md.GetTypeDefinition((TypeDefinitionHandle)member.Parent).Name),
                _ => member.Parent.Kind.ToString()
            };
            return "[ref] " + parent + "::" + md.GetString(member.Name);
        }
        if (h.Kind == HandleKind.MethodSpecification) {
            var spec = md.GetMethodSpecification((MethodSpecificationHandle)h);
            return "[generic] " + Resolve(MetadataTokens.GetToken(spec.Method));
        }
        return "[token] " + h.Kind;
    } catch (Exception ex) when (ex is BadImageFormatException or ArgumentException) {
        return "[invalid_token]";
    }
}
bool IsInteresting(string value) {
    return value.Contains("LosSantosAlive.Input.", StringComparison.Ordinal) ||
           value.Contains("ConversationHydration", StringComparison.Ordinal) ||
           value.Contains("PlayerTurn", StringComparison.OrdinalIgnoreCase) ||
           value.Contains("Transcrib", StringComparison.OrdinalIgnoreCase) ||
           value.Contains("Accepted", StringComparison.OrdinalIgnoreCase) ||
           value.Contains("SessionNonce", StringComparison.OrdinalIgnoreCase) ||
           value.Contains("TurnId", StringComparison.OrdinalIgnoreCase) ||
           value.Contains("Generation", StringComparison.OrdinalIgnoreCase) ||
           value.Contains("SendText", StringComparison.OrdinalIgnoreCase) ||
           value.Contains("Prompt", StringComparison.OrdinalIgnoreCase);
}
var anchors = methods.Select(kv => (Token: MetadataTokens.GetToken(kv.Key),
                                   Label: methodNames[kv.Key]))
    .Where(x => IsInteresting(x.Label))
    .OrderBy(x => x.Label, StringComparer.Ordinal).ToArray();
var relevant = calls.Where(c => IsInteresting(c.Caller) || IsInteresting(c.Callee))
    .OrderBy(x => x.Caller, StringComparer.Ordinal).ThenBy(x => x.IlOffset)
    .Take(20_000).Select(c => new {
        from = c.Caller, to = c.Callee, ilOffset = c.IlOffset, opcode = c.Opcode
    }).ToArray();
var typeCounts = methods.Values.GroupBy(x => x.Type)
    .Where(x => IsInteresting(x.Key))
    .OrderBy(x => x.Key, StringComparer.Ordinal)
    .Select(x => new { type = x.Key, methodCount = x.Count() }).ToArray();
// The audited DLL alone does not prove an accepted player turn. Human review
// must establish a semantically post-acceptance instruction + its original
// turn tuple, then test an actual native Core callback before A01 can pass.
var output = new {
    auditSchema = 1,
    source = "pinned_original_los_santos_alive_dotnet_core",
    dllSha256 = hash,
    methodCount = methods.Count,
    scannedCallCount = calls.Count,
    candidateMethods = anchors,
    relevantCallEdges = relevant,
    relevantTypes = typeCounts,
    malformedBodies = badBodies,
    nativeAcceptedTurnReceiptVerified = false,
    gate = "A01_BLOCKED_PENDING_SEMANTIC_ORIGINAL_ACCEPTANCE_SOURCE",
    note = "Method presence or an InputController call is not evidence of accepted typed/STT C-01."
};
Console.WriteLine(JsonSerializer.Serialize(output, new JsonSerializerOptions { WriteIndented = true }));
Console.Error.WriteLine("Pinned Core C-01 research audit produced call graph; A01 remains BLOCKED.");
return 0;

sealed class Names : ISignatureTypeProvider<string, object?> {
    public string GetArrayType(string elementType, ArrayShape shape) => elementType + "[]";
    public string GetByReferenceType(string elementType) => elementType + "&";
    public string GetFunctionPointerType(MethodSignature<string> signature) => "function";
    public string GetGenericInstantiation(string genericType, System.Collections.Immutable.ImmutableArray<string> typeArguments) => genericType + "<" + string.Join(",", typeArguments) + ">";
    public string GetGenericMethodParameter(object? genericContext, int index) => "!!" + index;
    public string GetGenericTypeParameter(object? genericContext, int index) => "!" + index;
    public string GetModifiedType(string modifier, string unmodifiedType, bool isRequired) => unmodifiedType;
    public string GetPinnedType(string elementType) => elementType;
    public string GetPointerType(string elementType) => elementType + "*";
    public string GetPrimitiveType(PrimitiveTypeCode typeCode) => typeCode.ToString();
    public string GetSZArrayType(string elementType) => elementType + "[]";
    public string GetTypeFromDefinition(MetadataReader reader, TypeDefinitionHandle handle, byte rawTypeKind) {
        var type = reader.GetTypeDefinition(handle);
        var ns = reader.GetString(type.Namespace);
        var name = reader.GetString(type.Name);
        return (ns.Length > 0 ? ns + "." : "") + name;
    }
    public string GetTypeFromReference(MetadataReader reader, TypeReferenceHandle handle, byte rawTypeKind) {
        var type = reader.GetTypeReference(handle);
        var ns = reader.GetString(type.Namespace);
        var name = reader.GetString(type.Name);
        return (ns.Length > 0 ? ns + "." : "") + name;
    }
    public string GetTypeFromSpecification(MetadataReader reader, object? genericContext, TypeSpecificationHandle handle, byte rawTypeKind) {
        return reader.GetTypeSpecification(handle).DecodeSignature(this, genericContext);
    }
}
