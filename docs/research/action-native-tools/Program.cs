#nullable disable
// Research-only PE/CLR metadata + IL extractor for the action-completion audit.
// Reads the target file as bytes through System.Reflection.Metadata. It never loads,
// reflects over, or executes the target assembly or any of its game dependencies.
using System.Collections.Immutable;
using System.Reflection;
using System.Reflection.Emit;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;
using System.Text.Json;

var pins = new Dictionary<string, string> {
    ["essential"] = "9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653",
    ["prbridge"] = "712f9491c0693d496ea82b1e4cefaa03c0575408a2fefa8d9e295bb516e5ad3e",
};
if (args.Length != 3 || !pins.ContainsKey(args[0]))
    throw new ArgumentException("Usage: ActionNativeAudit <essential|prbridge> <assembly> <output.json>");
var fileBytes = File.ReadAllBytes(args[1]);
var sha = Convert.ToHexString(SHA256.HashData(fileBytes)).ToLowerInvariant();
if (sha != pins[args[0]]) throw new InvalidDataException($"Pin mismatch for {args[0]}: {sha}");

using var pe = new PEReader(new MemoryStream(fileBytes));
var reader = pe.GetMetadataReader();
var names = new Names();
var opcodes = typeof(OpCodes).GetFields().Where(f => f.FieldType == typeof(OpCode))
    .Select(f => (OpCode)f.GetValue(null)).ToDictionary(o => (ushort)o.Value);

string Describe(EntityHandle h) {
    try {
        return h.Kind switch {
            HandleKind.TypeDefinition => names.GetTypeFromDefinition(reader, (TypeDefinitionHandle)h, 0),
            HandleKind.TypeReference => names.GetTypeFromReference(reader, (TypeReferenceHandle)h, 0),
            HandleKind.TypeSpecification => names.GetTypeFromSpecification(reader, null, (TypeSpecificationHandle)h, 0),
            HandleKind.MethodDefinition => Describe(reader.GetMethodDefinition((MethodDefinitionHandle)h).GetDeclaringType()) + "::" + reader.GetString(reader.GetMethodDefinition((MethodDefinitionHandle)h).Name),
            HandleKind.MemberReference => Describe(reader.GetMemberReference((MemberReferenceHandle)h).Parent) + "::" + reader.GetString(reader.GetMemberReference((MemberReferenceHandle)h).Name),
            HandleKind.FieldDefinition => Describe(reader.GetFieldDefinition((FieldDefinitionHandle)h).GetDeclaringType()) + "::" + reader.GetString(reader.GetFieldDefinition((FieldDefinitionHandle)h).Name),
            HandleKind.MethodSpecification => Describe(reader.GetMethodSpecification((MethodSpecificationHandle)h).Method),
            _ => h.Kind.ToString(),
        };
    } catch { return h.Kind.ToString(); }
}

string MemberRefSignature(MemberReferenceHandle h) {
    var m = reader.GetMemberReference(h);
    try {
        if (m.GetKind() == MemberReferenceKind.Method) {
            var s = m.DecodeMethodSignature(names, null);
            return s.ReturnType + "(" + string.Join(",", s.ParameterTypes) + ")";
        }
        return m.DecodeFieldSignature(names, null);
    } catch { return null; }
}

(int pops, int pushes) CallEffect(OpCode op, int token, MethodDefinition owner) {
    // Exact stack effect for variable-pop/push opcodes using the target signature header.
    var h = MetadataTokens.EntityHandle(token);
    MethodSignature<string> sig;
    if (h.Kind == HandleKind.MethodSpecification) h = reader.GetMethodSpecification((MethodSpecificationHandle)h).Method;
    if (h.Kind == HandleKind.MethodDefinition) sig = reader.GetMethodDefinition((MethodDefinitionHandle)h).DecodeSignature(names, null);
    else if (h.Kind == HandleKind.MemberReference) sig = reader.GetMemberReference((MemberReferenceHandle)h).DecodeMethodSignature(names, null);
    else if (h.Kind == HandleKind.StandaloneSignature) sig = reader.GetStandaloneSignature((StandaloneSignatureHandle)h).DecodeMethodSignature(names, null);
    else throw new InvalidDataException("Unexpected call token kind " + h.Kind);
    int p = sig.ParameterTypes.Length + (sig.Header.IsInstance && op != OpCodes.Newobj ? 1 : 0) + (op == OpCodes.Calli ? 1 : 0);
    int r = op == OpCodes.Newobj ? 1 : (sig.ReturnType == "Void" ? 0 : 1);
    return (p, r);
}

int Pops(StackBehaviour b) => b switch {
    StackBehaviour.Pop0 => 0, StackBehaviour.Pop1 or StackBehaviour.Popi or StackBehaviour.Popref => 1,
    StackBehaviour.Pop1_pop1 or StackBehaviour.Popi_pop1 or StackBehaviour.Popi_popi or StackBehaviour.Popi_popi8
        or StackBehaviour.Popi_popr4 or StackBehaviour.Popi_popr8 or StackBehaviour.Popref_pop1 or StackBehaviour.Popref_popi => 2,
    StackBehaviour.Popi_popi_popi or StackBehaviour.Popref_popi_popi or StackBehaviour.Popref_popi_popi8 or StackBehaviour.Popref_popi_popr4
        or StackBehaviour.Popref_popi_popr8 or StackBehaviour.Popref_popi_popref or StackBehaviour.Popref_popi_pop1 => 3,
    _ => -1,
};
int Pushes(StackBehaviour b) => b switch {
    StackBehaviour.Push0 => 0, StackBehaviour.Push1_push1 => 2,
    StackBehaviour.Push1 or StackBehaviour.Pushi or StackBehaviour.Pushi8 or StackBehaviour.Pushr4 or StackBehaviour.Pushr8 or StackBehaviour.Pushref => 1,
    _ => -1,
};

object[] Il(MethodDefinition m, out string ilSha, out object[] regions, out int maxStack, out string[] locals) {
    ilSha = null; regions = []; maxStack = 0; locals = [];
    if (m.RelativeVirtualAddress == 0) return [];
    var body = pe.GetMethodBody(m.RelativeVirtualAddress);
    maxStack = body.MaxStack;
    if (!body.LocalSignature.IsNil) {
        try {
            var sig = reader.GetStandaloneSignature(body.LocalSignature);
            locals = sig.DecodeLocalSignature(names, null).ToArray();
        } catch { locals = ["<undecodable>"]; }
    }
    var bytes = body.GetILBytes();
    ilSha = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    regions = body.ExceptionRegions.Select(e => (object)new {
        kind = e.Kind.ToString(), tryOffset = e.TryOffset, tryLength = e.TryLength,
        handlerOffset = e.HandlerOffset, handlerLength = e.HandlerLength,
        catchType = e.CatchType.IsNil ? null : Describe(e.CatchType),
    }).ToArray();
    var result = new List<object>();
    for (int p = 0; p < bytes.Length;) {
        int start = p; ushort code = bytes[p++];
        if (code == 0xfe) code = (ushort)(0xfe00 | bytes[p++]);
        if (!opcodes.TryGetValue(code, out var op)) throw new InvalidDataException($"Unknown opcode 0x{code:x} at IL offset {start} (rva 0x{m.RelativeVirtualAddress:x})");
        int size = op.OperandType switch {
            OperandType.InlineNone => 0,
            OperandType.ShortInlineBrTarget or OperandType.ShortInlineI or OperandType.ShortInlineVar => 1,
            OperandType.InlineVar => 2,
            OperandType.InlineI8 or OperandType.InlineR => 8,
            OperandType.InlineSwitch => 4 + 4 * BitConverter.ToInt32(bytes, p),
            _ => 4,
        };
        if (p + size > bytes.Length) throw new InvalidDataException("Truncated operand");
        string operand = null; int? token = null; int[] targets = null; object value = null;
        switch (op.OperandType) {
            case OperandType.InlineString:
                operand = reader.GetUserString(MetadataTokens.UserStringHandle(BitConverter.ToInt32(bytes, p) & 0xffffff)); break;
            case OperandType.InlineMethod: case OperandType.InlineField: case OperandType.InlineType: case OperandType.InlineTok:
                token = BitConverter.ToInt32(bytes, p); operand = Describe(MetadataTokens.EntityHandle(token.Value)); break;
            case OperandType.InlineSig:
                token = BitConverter.ToInt32(bytes, p); operand = "sig"; break;
            case OperandType.ShortInlineBrTarget: targets = [p + size + (sbyte)bytes[p]]; break;
            case OperandType.InlineBrTarget: targets = [p + size + BitConverter.ToInt32(bytes, p)]; break;
            case OperandType.InlineSwitch:
                int n = BitConverter.ToInt32(bytes, p);
                targets = Enumerable.Range(0, n).Select(i => p + size + BitConverter.ToInt32(bytes, p + 4 + 4 * i)).ToArray(); break;
            case OperandType.InlineI: value = BitConverter.ToInt32(bytes, p); break;
            case OperandType.ShortInlineI: value = (int)(sbyte)bytes[p]; break;
            case OperandType.InlineI8: value = BitConverter.ToInt64(bytes, p).ToString(); break;
            case OperandType.InlineR: value = BitConverter.ToDouble(bytes, p); break;
            case OperandType.ShortInlineR: value = (double)BitConverter.ToSingle(bytes, p); break;
            case OperandType.InlineVar: value = (int)BitConverter.ToUInt16(bytes, p); break;
            case OperandType.ShortInlineVar: value = (int)bytes[p]; break;
        }
        p += size;
        int pops = Pops(op.StackBehaviourPop), pushes = Pushes(op.StackBehaviourPush);
        if (op == OpCodes.Call || op == OpCodes.Callvirt || op == OpCodes.Newobj || op == OpCodes.Calli) {
            (pops, pushes) = CallEffect(op, token.Value, m);
        } else if (op == OpCodes.Ret) {
            pops = m.DecodeSignature(names, null).ReturnType == "Void" ? 0 : 1; pushes = 0;
        }
        if (pops < 0 || pushes < 0) throw new InvalidDataException($"Unresolved stack effect for {op.Name}");
        result.Add(new { offset = start, op = op.Name, operand, token, targets, value, pops, pushes });
    }
    return result.ToArray();
}

var methodOwner = new Dictionary<int, string>();
var types = new List<object>();
foreach (var th in reader.TypeDefinitions) {
    var t = reader.GetTypeDefinition(th);
    var props = t.GetProperties().Select(ph => {
        var pr = reader.GetPropertyDefinition(ph); var acc = pr.GetAccessors();
        return (object)new { name = reader.GetString(pr.Name),
            getter = acc.Getter.IsNil ? 0 : MetadataTokens.GetToken(acc.Getter),
            setter = acc.Setter.IsNil ? 0 : MetadataTokens.GetToken(acc.Setter) };
    }).ToArray();
    var events = t.GetEvents().Select(eh => {
        var e = reader.GetEventDefinition(eh); var acc = e.GetAccessors();
        return (object)new { name = reader.GetString(e.Name), type = Describe(e.Type),
            adder = acc.Adder.IsNil ? 0 : MetadataTokens.GetToken(acc.Adder),
            remover = acc.Remover.IsNil ? 0 : MetadataTokens.GetToken(acc.Remover),
            raiser = acc.Raiser.IsNil ? 0 : MetadataTokens.GetToken(acc.Raiser) };
    }).ToArray();
    var fields = t.GetFields().Select(fh => {
        var f = reader.GetFieldDefinition(fh); var ch = f.GetDefaultValue();
        return (object)new { token = MetadataTokens.GetToken(fh), name = reader.GetString(f.Name), attributes = f.Attributes.ToString(),
            type = f.DecodeSignature(names, null),
            constant = ch.IsNil ? null : Convert.ToHexString(reader.GetBlobBytes(reader.GetConstant(ch).Value)) };
    }).ToArray();
    var methods = t.GetMethods().Select(mh => {
        var m = reader.GetMethodDefinition(mh); var sig = m.DecodeSignature(names, null);
        var il = Il(m, out var ilSha, out var regions, out var maxStack, out var locals);
        return (object)new { token = MetadataTokens.GetToken(mh), name = reader.GetString(m.Name), attributes = m.Attributes.ToString(),
            rva = m.RelativeVirtualAddress, returns = sig.ReturnType, parameters = sig.ParameterTypes.ToArray(),
            parameterNames = m.GetParameters().Select(x => reader.GetParameter(x)).Where(x => x.SequenceNumber > 0).Select(x => reader.GetString(x.Name)).ToArray(),
            isStatic = (m.Attributes & MethodAttributes.Static) != 0, maxStack, locals, ilSha256 = ilSha, exceptionRegions = regions, il };
    }).ToArray();
    var interfaces = t.GetInterfaceImplementations().Select(ih => Describe(reader.GetInterfaceImplementation(ih).Interface)).ToArray();
    types.Add(new { token = MetadataTokens.GetToken(th), name = Describe(th), attributes = t.Attributes.ToString(),
        baseType = t.BaseType.IsNil ? null : Describe(t.BaseType), interfaces, fields, properties = props, events, methods });
}
var methodSpecs = Enumerable.Range(1, reader.GetTableRowCount(TableIndex.MethodSpec)).Select(i => MetadataTokens.MethodSpecificationHandle(i))
    .Select(h => new { token = MetadataTokens.GetToken(h), methodToken = MetadataTokens.GetToken(reader.GetMethodSpecification(h).Method),
        signatureHex = Convert.ToHexString(reader.GetBlobBytes(reader.GetMethodSpecification(h).Signature)) }).ToArray();
var rvaFields = reader.FieldDefinitions.Select(h => new { token = MetadataTokens.GetToken(h), rva = reader.GetFieldDefinition(h).GetRelativeVirtualAddress() })
    .Where(x => x.rva != 0).Select(x => {
        var data = pe.GetSectionData(x.rva);
        return new { x.token, x.rva, data = Convert.ToHexString(data.GetContent(0, Math.Min(262144, data.Length)).ToArray()) };
    }).ToArray();
var memberRefs = reader.MemberReferences.Select(h => new { token = MetadataTokens.GetToken(h), name = Describe(h), signature = MemberRefSignature(h) }).ToArray();
var assemblyRefs = reader.AssemblyReferences.Select(h => { var r = reader.GetAssemblyReference(h); return new { name = reader.GetString(r.Name), version = r.Version.ToString() }; }).ToArray();
var asm = reader.GetAssemblyDefinition();
File.WriteAllText(args[2], JsonSerializer.Serialize(new {
    tool = "ActionNativeAudit/1", input = args[0], sha256 = sha,
    assembly = new { name = reader.GetString(asm.Name), version = asm.Version.ToString() },
    assemblyRefs, methodSpecs, rvaFields, memberRefs, types,
}, new JsonSerializerOptions { WriteIndented = false }));
Console.WriteLine($"ok {args[0]} {sha} types={types.Count} methods={reader.MethodDefinitions.Count} memberRefs={memberRefs.Length}");

sealed class Names : ISignatureTypeProvider<string, object> {
    public string GetArrayType(string e, ArrayShape s) => e + "[" + new string(',', s.Rank - 1) + "]";
    public string GetByReferenceType(string e) => e + "&";
    public string GetFunctionPointerType(MethodSignature<string> s) => "fn";
    public string GetGenericInstantiation(string g, ImmutableArray<string> a) => g + "<" + string.Join(",", a) + ">";
    public string GetGenericMethodParameter(object c, int i) => "!!" + i;
    public string GetGenericTypeParameter(object c, int i) => "!" + i;
    public string GetModifiedType(string m, string u, bool r) => u;
    public string GetPinnedType(string e) => e;
    public string GetPointerType(string e) => e + "*";
    public string GetPrimitiveType(PrimitiveTypeCode t) => t.ToString();
    public string GetSZArrayType(string e) => e + "[]";
    public string GetTypeFromDefinition(MetadataReader r, TypeDefinitionHandle h, byte k) {
        var t = r.GetTypeDefinition(h); var parent = t.GetDeclaringType();
        return parent.IsNil ? r.GetString(t.Namespace) + "." + r.GetString(t.Name) : GetTypeFromDefinition(r, parent, k) + "+" + r.GetString(t.Name);
    }
    public string GetTypeFromReference(MetadataReader r, TypeReferenceHandle h, byte k) {
        var t = r.GetTypeReference(h); return r.GetString(t.Namespace) + "." + r.GetString(t.Name);
    }
    public string GetTypeFromSpecification(MetadataReader r, object c, TypeSpecificationHandle h, byte k) => r.GetTypeSpecification(h).DecodeSignature(this, c);
}
