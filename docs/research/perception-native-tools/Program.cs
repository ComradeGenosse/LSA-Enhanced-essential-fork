using System.Collections.Immutable;
using System.Reflection;
using System.Reflection.Emit;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;
using System.Text.Json;

// Reads PE metadata and IL as data. Never loads or invokes a game assembly.
try {
if (args.Length < 2) throw new ArgumentException("Usage: PerceptionNativeProbe <dll> <output.json> [Type::Method or 0x06000000 ...] [--damage]");
bool damage = args.Skip(2).Contains("--damage");
string pin = damage ? "64816a0d1131a6ec241f8951902b08afaee86fb0f73693399edefe2db8776750"
    : "9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653";
var hash = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(args[0]))).ToLowerInvariant();
if (hash != pin) throw new InvalidDataException("Input DLL pin mismatch.");
using var stream = File.OpenRead(args[0]);
using var pe = new PEReader(stream);
var reader = pe.GetMetadataReader();
var names = new Names();
var wanted = new HashSet<string> {
    "PerceptionSnapshot", "PerceptionSystem", "ReflexAwarenessMemory", "ReflexAwarenessService",
    "GunshotReflexDetector", "GunAimReflexDetector", "PedShotReflexDetector", "VehicleCrashReflexDetector",
    "ReflexSystem", "ReflexResult", "SpecialGeminiTurnRequest", "SpecialGeminiTurnScheduler",
    "SpecialGeminiTurnService", "DirectedInteractionManager", "NpcPlaybackCoordinator",
    "NearbyPersonContextProvider", "WorldContextProvider"
};
if (damage) wanted = new HashSet<string> { "DamageTrackerService", "PedTookDamageDelegate", "VehTookDamageDelegate", "PedDamageInfo", "VehDamageInfo", "WeaponDamageInfo" };
var requested = args.Skip(2).Where(x => x != "--damage").ToHashSet(StringComparer.Ordinal);
var found = new HashSet<string>(StringComparer.Ordinal);
var opcodes = typeof(OpCodes).GetFields().Where(f => f.FieldType == typeof(OpCode))
    .Select(f => (OpCode)f.GetValue(null)).ToDictionary(op => (ushort)op.Value);
string Describe(EntityHandle handle) => handle.Kind switch {
    HandleKind.TypeDefinition => names.GetTypeFromDefinition(reader, (TypeDefinitionHandle)handle, 0),
    HandleKind.TypeReference => names.GetTypeFromReference(reader, (TypeReferenceHandle)handle, 0),
    HandleKind.TypeSpecification => names.GetTypeFromSpecification(reader, null, (TypeSpecificationHandle)handle, 0),
    HandleKind.MethodDefinition => Describe(reader.GetMethodDefinition((MethodDefinitionHandle)handle).GetDeclaringType()) + "::" + reader.GetString(reader.GetMethodDefinition((MethodDefinitionHandle)handle).Name),
    HandleKind.FieldDefinition => Describe(reader.GetFieldDefinition((FieldDefinitionHandle)handle).GetDeclaringType()) + "::" + reader.GetString(reader.GetFieldDefinition((FieldDefinitionHandle)handle).Name),
    HandleKind.MemberReference => Describe(reader.GetMemberReference((MemberReferenceHandle)handle).Parent) + "::" + reader.GetString(reader.GetMemberReference((MemberReferenceHandle)handle).Name),
    HandleKind.MethodSpecification => Describe(reader.GetMethodSpecification((MethodSpecificationHandle)handle).Method),
    _ => handle.Kind.ToString()
};
object Body(MethodDefinition method) {
    if (method.RelativeVirtualAddress == 0) return null;
    var body = pe.GetMethodBody(method.RelativeVirtualAddress);
    var bytes = body.GetILBytes();
    var instructions = new List<object>();
    for (int cursor = 0; cursor < bytes.Length;) {
        int offset = cursor;
        ushort code = bytes[cursor++];
        if (code == 0xfe) code = (ushort)(0xfe00 | bytes[cursor++]);
        if (!opcodes.TryGetValue(code, out var op)) throw new InvalidDataException("Unknown IL opcode.");
        int size = op.OperandType switch {
            OperandType.InlineNone => 0,
            OperandType.ShortInlineBrTarget or OperandType.ShortInlineI or OperandType.ShortInlineVar => 1,
            OperandType.InlineVar => 2,
            OperandType.InlineI8 or OperandType.InlineR => 8,
            OperandType.InlineSwitch => 4 + 4 * BitConverter.ToInt32(bytes, cursor),
            _ => 4
        };
        if (cursor + size > bytes.Length) throw new InvalidDataException("Truncated IL operand.");
        string operand = size == 0 ? null : Convert.ToHexString(bytes.AsSpan(cursor, size));
        int? token = null;
        object value = null;
        int[] targets = null;
        if (op.OperandType is OperandType.InlineMethod or OperandType.InlineField or OperandType.InlineType or OperandType.InlineTok) {
            token = BitConverter.ToInt32(bytes, cursor);
            operand = Describe(MetadataTokens.EntityHandle(token.Value));
        }
        if (op.OperandType == OperandType.InlineString) operand = reader.GetUserString(MetadataTokens.UserStringHandle(BitConverter.ToInt32(bytes, cursor) & 0xffffff));
        if (op.OperandType == OperandType.InlineI) value = BitConverter.ToInt32(bytes, cursor);
        if (op.OperandType == OperandType.ShortInlineI) value = (sbyte)bytes[cursor];
        if (op.OperandType == OperandType.InlineR) value = BitConverter.ToDouble(bytes, cursor);
        if (op.OperandType == OperandType.ShortInlineR) value = BitConverter.ToSingle(bytes, cursor);
        if (op.OperandType == OperandType.ShortInlineBrTarget) targets = [cursor + size + (sbyte)bytes[cursor]];
        if (op.OperandType == OperandType.InlineBrTarget) targets = [cursor + size + BitConverter.ToInt32(bytes, cursor)];
        if (op.OperandType == OperandType.InlineSwitch) targets = Enumerable.Range(0, BitConverter.ToInt32(bytes, cursor))
            .Select(i => cursor + size + BitConverter.ToInt32(bytes, cursor + 4 + 4 * i)).ToArray();
        cursor += size;
        instructions.Add(new { offset, op = op.Name, operand, token, value, targets });
    }
    var regions = body.ExceptionRegions.Select(e => new {
        kind = e.Kind.ToString(), e.TryOffset, e.TryLength, e.HandlerOffset, e.HandlerLength,
        catchType = e.CatchType.IsNil ? null : Describe(e.CatchType)
    }).ToArray();
    return new { ilSha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(), instructions, regions };
}
var types = new List<object>();
foreach (var handle in reader.TypeDefinitions) {
    var type = reader.GetTypeDefinition(handle);
    string shortName = reader.GetString(type.Name);
    bool requestedType = type.GetMethods().Any(h => requested.Contains($"0x{MetadataTokens.GetToken(h):x8}") || requested.Contains(shortName + "::" + reader.GetString(reader.GetMethodDefinition(h).Name)));
    if (!wanted.Contains(shortName) && !requestedType) continue;
    var methods = new List<object>();
    foreach (var methodHandle in type.GetMethods()) {
        var method = reader.GetMethodDefinition(methodHandle);
        string name = reader.GetString(method.Name), key = shortName + "::" + name;
        string tokenKey = $"0x{MetadataTokens.GetToken(methodHandle):x8}";
        bool bodyRequested = requested.Contains(key) || requested.Contains(tokenKey);
        if (requested.Contains(key)) found.Add(key);
        if (requested.Contains(tokenKey)) found.Add(tokenKey);
        if ((method.Attributes & MethodAttributes.MemberAccessMask) != MethodAttributes.Public && !bodyRequested) continue;
        var signature = method.DecodeSignature(names, (object)null);
        methods.Add(new { name, token = $"0x{MetadataTokens.GetToken(methodHandle):x8}", attributes = method.Attributes.ToString(),
            returns = signature.ReturnType, parameters = signature.ParameterTypes.ToArray(), body = bodyRequested ? Body(method) : null });
    }
    var fields = type.GetFields().Select(h => (handle: h, field: reader.GetFieldDefinition(h)))
        .Where(x => (x.field.Attributes & FieldAttributes.FieldAccessMask) == FieldAttributes.Public).Select(x => {
            var constant = x.field.GetDefaultValue();
            return new { name = reader.GetString(x.field.Name), type = x.field.DecodeSignature(names, (object)null),
                constantHex = constant.IsNil ? null : Convert.ToHexString(reader.GetBlobBytes(reader.GetConstant(constant).Value)) };
        }).ToArray();
    var events = type.GetEvents().Select(h => {
        var e = reader.GetEventDefinition(h);
        return new { name = reader.GetString(e.Name), type = Describe(e.Type) };
    }).ToArray();
    types.Add(new { name = Describe(handle), methods, fields, events });
}
if (found.Count != requested.Count) throw new InvalidDataException("Requested method not found: " + string.Join(", ", requested.Except(found)));
File.WriteAllText(args[1], JsonSerializer.Serialize(new { dllSha256 = hash, types }, new JsonSerializerOptions { WriteIndented = true }) + "\n");
Console.WriteLine($"Read {types.Count} selected types and {found.Count} requested method names without executing the DLL.");
} catch (Exception error) {
    Console.Error.WriteLine("Probe failed: " + error.Message);
    Environment.ExitCode = 1;
}

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
