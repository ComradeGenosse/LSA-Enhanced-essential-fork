using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Text.Json;

internal static class Program
{
    private sealed class Finding
    {
        public string severity { get; set; } = "";
        public string code { get; set; } = "";
        public string assembly { get; set; } = "";
        public string reference { get; set; } = "";
        public string detail { get; set; } = "";
    }
    private sealed class Report
    {
        public string referencePath { get; set; } = "";
        public string referenceSha256 { get; set; } = "";
        public string referenceIdentity { get; set; } = "";
        public List<string> scannedBinaries { get; set; } = new();
        public int rageTypeReferences { get; set; }
        public int rageMemberReferences { get; set; }
        public int resolvedMembers { get; set; }
        public int coreTypeReferences { get; set; }
        public int coreMemberReferences { get; set; }
        public int genericMethodSpecifications { get; set; }
        public List<Finding> findings { get; set; } = new();
        public bool passed => findings.All(f => f.severity != "error");
    }

    private sealed class AssemblyMetadata : IDisposable
    {
        public readonly FileStream Stream;
        public readonly PEReader Pe;
        public readonly MetadataReader Reader;
        public readonly string Path;
        public readonly Dictionary<string, TypeDefinitionHandle> Types;
        public readonly Canonical TypesProvider;
        public readonly string Name;
        public readonly Version Version;
        public AssemblyMetadata(string path)
        {
            Path = System.IO.Path.GetFullPath(path);
            Stream = File.OpenRead(Path);
            Pe = new PEReader(Stream);
            if (!Pe.HasMetadata) throw new InvalidDataException("No CLR metadata: " + path);
            Reader = Pe.GetMetadataReader();
            if (!Reader.IsAssembly) throw new InvalidDataException("Not a managed assembly: " + path);
            var asm = Reader.GetAssemblyDefinition();
            Name = Reader.GetString(asm.Name);
            Version = asm.Version;
            TypesProvider = new Canonical(Reader);
            Types = Reader.TypeDefinitions.ToDictionary(h => TypesProvider.TypeName(h), h => h);
        }
        public void Dispose() { Pe.Dispose(); Stream.Dispose(); }
    }

    private sealed class Canonical : ISignatureTypeProvider<string, object?>
    {
        private readonly MetadataReader md;
        public Canonical(MetadataReader md) { this.md = md; }
        public string TypeName(TypeDefinitionHandle h)
        {
            var d = md.GetTypeDefinition(h);
            string name = md.GetString(d.Name);
            var outer = d.GetDeclaringType();
            if (!outer.IsNil) return TypeName(outer) + "+" + name;
            string ns = md.GetString(d.Namespace);
            return string.IsNullOrEmpty(ns) ? name : ns + "." + name;
        }
        public string TypeName(TypeReferenceHandle h)
        {
            var d = md.GetTypeReference(h);
            string name = md.GetString(d.Name);
            if (d.ResolutionScope.Kind == HandleKind.TypeReference)
                return TypeName((TypeReferenceHandle)d.ResolutionScope) + "+" + name;
            string ns = md.GetString(d.Namespace);
            return string.IsNullOrEmpty(ns) ? name : ns + "." + name;
        }
        public string TypeName(EntityHandle h) => h.Kind switch
        {
            HandleKind.TypeReference => TypeName((TypeReferenceHandle)h),
            HandleKind.TypeDefinition => TypeName((TypeDefinitionHandle)h),
            HandleKind.TypeSpecification => md.GetTypeSpecification((TypeSpecificationHandle)h).DecodeSignature(this, null),
            _ => "unsupported-parent:" + h.Kind
        };
        public string GetArrayType(string elementType, ArrayShape shape) =>
            elementType + "[" + new string(',', Math.Max(0, shape.Rank - 1)) + "]";
        public string GetByReferenceType(string elementType) => elementType + "&";
        public string GetFunctionPointerType(MethodSignature<string> signature) => "fnptr(" + MethodText(signature) + ")";
        public string GetGenericInstantiation(string genericType, ImmutableArray<string> typeArguments) =>
            genericType + "<" + string.Join(",", typeArguments) + ">";
        public string GetGenericMethodParameter(object? genericContext, int index) => "!!" + index;
        public string GetGenericTypeParameter(object? genericContext, int index) => "!" + index;
        public string GetModifiedType(string modifier, string unmodifiedType, bool isRequired) =>
            (isRequired ? "modreq(" : "modopt(") + modifier + ")" + unmodifiedType;
        public string GetPinnedType(string elementType) => "pinned " + elementType;
        public string GetPointerType(string elementType) => elementType + "*";
        public string GetPrimitiveType(PrimitiveTypeCode typeCode) => typeCode switch
        {
            PrimitiveTypeCode.Void => "System.Void", PrimitiveTypeCode.Boolean => "System.Boolean",
            PrimitiveTypeCode.Char => "System.Char", PrimitiveTypeCode.SByte => "System.SByte",
            PrimitiveTypeCode.Byte => "System.Byte", PrimitiveTypeCode.Int16 => "System.Int16",
            PrimitiveTypeCode.UInt16 => "System.UInt16", PrimitiveTypeCode.Int32 => "System.Int32",
            PrimitiveTypeCode.UInt32 => "System.UInt32", PrimitiveTypeCode.Int64 => "System.Int64",
            PrimitiveTypeCode.UInt64 => "System.UInt64", PrimitiveTypeCode.Single => "System.Single",
            PrimitiveTypeCode.Double => "System.Double", PrimitiveTypeCode.String => "System.String",
            PrimitiveTypeCode.Object => "System.Object", PrimitiveTypeCode.IntPtr => "System.IntPtr",
            PrimitiveTypeCode.UIntPtr => "System.UIntPtr", PrimitiveTypeCode.TypedReference => "System.TypedReference",
            _ => typeCode.ToString()
        };
        public string GetSZArrayType(string elementType) => elementType + "[]";
        public string GetTypeFromDefinition(MetadataReader reader, TypeDefinitionHandle handle, byte rawTypeKind) => TypeName(handle);
        public string GetTypeFromReference(MetadataReader reader, TypeReferenceHandle handle, byte rawTypeKind) => TypeName(handle);
        public string GetTypeFromSpecification(MetadataReader reader, object? genericContext, TypeSpecificationHandle handle, byte rawTypeKind) =>
            reader.GetTypeSpecification(handle).DecodeSignature(this, genericContext);
        public static string MethodText(MethodSignature<string> sig) =>
            (sig.Header.IsInstance ? "instance " : "static ") +
            sig.Header.CallingConvention + " " +
            (((sig.Header.RawValue & 0x40) != 0) ? "explicit-this " : "") +
            "generic=" + sig.GenericParameterCount + " " +
            sig.ReturnType + "(" + string.Join(",", sig.ParameterTypes) + ")" +
            " required=" + sig.RequiredParameterCount;
    }

    private static void Add(Report report, string severity, string code, string binary, string refer, string detail) =>
        report.findings.Add(new Finding { severity = severity, code = code, assembly = binary, reference = refer, detail = detail });

    private static bool IsVisible(TypeAttributes attrs) =>
        (attrs & TypeAttributes.VisibilityMask) is TypeAttributes.Public or TypeAttributes.NestedPublic or
            TypeAttributes.NestedFamily or TypeAttributes.NestedFamORAssem;

    private static bool IsVisible(MethodAttributes attrs) =>
        (attrs & MethodAttributes.MemberAccessMask) is MethodAttributes.Public or MethodAttributes.Family or
            MethodAttributes.FamORAssem;

    private static bool IsVisible(FieldAttributes attrs) =>
        (attrs & FieldAttributes.FieldAccessMask) is FieldAttributes.Public or FieldAttributes.Family or
            FieldAttributes.FamORAssem;

    private static string? ScopeAssembly(MetadataReader md, TypeReferenceHandle h)
    {
        EntityHandle scope = md.GetTypeReference(h).ResolutionScope;
        while (scope.Kind == HandleKind.TypeReference) scope = md.GetTypeReference((TypeReferenceHandle)scope).ResolutionScope;
        return scope.Kind == HandleKind.AssemblyReference
            ? md.GetString(md.GetAssemblyReference((AssemblyReferenceHandle)scope).Name) : null;
    }

    private static string TypeKey(string name) => name.Split('<')[0];

    private static IEnumerable<TypeDefinitionHandle> Ancestors(AssemblyMetadata sdk, TypeDefinitionHandle current)
    {
        var visited = new HashSet<TypeDefinitionHandle>();
        while (!current.IsNil && visited.Add(current))
        {
            yield return current;
            var baseType = sdk.Reader.GetTypeDefinition(current).BaseType;
            if (baseType.Kind == HandleKind.TypeDefinition) current = (TypeDefinitionHandle)baseType;
            else if (baseType.Kind == HandleKind.TypeReference &&
                     sdk.Types.TryGetValue(sdk.TypesProvider.TypeName((TypeReferenceHandle)baseType), out var parent))
                current = parent;
            else break;
        }
    }

    private static void CheckMember(AssemblyMetadata sdk, AssemblyMetadata binary, MemberReferenceHandle h, Report report)
    {
        var md = binary.Reader;
        var member = md.GetMemberReference(h);
        var parent = member.Parent;
        string originalType;
        if (parent.Kind == HandleKind.TypeReference)
        {
            var tr = (TypeReferenceHandle)parent;
            if (ScopeAssembly(md, tr) != sdk.Name) return;
            originalType = binary.TypesProvider.TypeName(tr);
        }
        else if (parent.Kind == HandleKind.TypeSpecification)
        {
            originalType = binary.TypesProvider.TypeName(parent);
            // Generic type instantiations require substitution of class generic parameters.
            // Fail closed rather than silently reporting a successful ABI match.
            if (!originalType.StartsWith("Rage.", StringComparison.Ordinal)) return;
            Add(report, "error", "GENERIC_TYPE_SPEC_UNRESOLVED", binary.Path,
                originalType + "." + md.GetString(member.Name),
                "A generic instantiation must be resolved with type-argument substitution.");
            return;
        }
        else return;
        if (sdk.Name == "RagePluginHook") report.rageMemberReferences++;
        else report.coreMemberReferences++;
        string name = md.GetString(member.Name);
        string refer = originalType + "." + name;
        if (!sdk.Types.TryGetValue(TypeKey(originalType), out var type))
        {
            Add(report, "error", "MEMBER_PARENT_TYPE_MISSING", binary.Path, refer, "Type not present in RPH reference.");
            return;
        }
        var methods = new List<(string signature, bool visible)>();
        var fields = new List<(string signature, bool visible)>();
        foreach (var t in Ancestors(sdk, type))
        {
            var td = sdk.Reader.GetTypeDefinition(t);
            foreach (var m in td.GetMethods())
            {
                var def = sdk.Reader.GetMethodDefinition(m);
                if (sdk.Reader.GetString(def.Name) == name)
                    methods.Add((Canonical.MethodText(def.DecodeSignature(sdk.TypesProvider, null)), IsVisible(def.Attributes)));
            }
            foreach (var f in td.GetFields())
            {
                var def = sdk.Reader.GetFieldDefinition(f);
                if (sdk.Reader.GetString(def.Name) == name)
                    fields.Add((def.DecodeSignature(sdk.TypesProvider, null), IsVisible(def.Attributes)));
            }
        }
        string wanted;
        bool matched;
        bool accessible;
        if (member.GetKind() == MemberReferenceKind.Method)
        {
            wanted = Canonical.MethodText(member.DecodeMethodSignature(binary.TypesProvider, null));
            var match = methods.Where(x => x.signature == wanted).ToList();
            matched = match.Count > 0;
            accessible = match.Any(x => x.visible);
            if (!matched && methods.Count == 0)
                Add(report, "error", "MISSING_METHOD", binary.Path, refer, wanted);
            else if (!matched)
                Add(report, "error", "METHOD_SIGNATURE_MISMATCH", binary.Path, refer,
                    "Expected " + wanted + "; candidates: " + string.Join("; ", methods.Select(x => x.signature)));
        }
        else
        {
            wanted = member.DecodeFieldSignature(binary.TypesProvider, null);
            var match = fields.Where(x => x.signature == wanted).ToList();
            matched = match.Count > 0;
            accessible = match.Any(x => x.visible);
            if (!matched && fields.Count == 0)
                Add(report, "error", "MISSING_FIELD", binary.Path, refer, wanted);
            else if (!matched)
                Add(report, "error", "FIELD_SIGNATURE_MISMATCH", binary.Path, refer,
                    "Expected " + wanted + "; candidates: " + string.Join("; ", fields.Select(x => x.signature)));
        }
        if (matched && !accessible)
            Add(report, "error", "INACCESSIBLE_MEMBER", binary.Path, refer, wanted);
        if (matched && accessible) report.resolvedMembers++;
    }

    private static void Check(AssemblyMetadata sdk, AssemblyMetadata binary, Report report, IReadOnlyCollection<string> available)
    {
        var md = binary.Reader;
        if (!report.scannedBinaries.Contains(binary.Path)) report.scannedBinaries.Add(binary.Path);
        foreach (var a in md.AssemblyReferences)
        {
            var ar = md.GetAssemblyReference(a);
            var name = md.GetString(ar.Name);
            if (name == sdk.Name)
            {
                if (ar.Version != sdk.Version)
                    Add(report, "warning", "RPH_ASSEMBLY_VERSION_DIFFERENCE", binary.Path, name,
                        "Compiled reference " + ar.Version + "; inspected reference " + sdk.Version +
                        ". Binding/redirect behavior must be verified.");
            }
            else if (!name.Equals("mscorlib", StringComparison.OrdinalIgnoreCase) &&
                     !name.Equals("netstandard", StringComparison.OrdinalIgnoreCase) &&
                     !name.StartsWith("System", StringComparison.OrdinalIgnoreCase) &&
                     !name.StartsWith("Microsoft.", StringComparison.OrdinalIgnoreCase) &&
                     !available.Contains(name, StringComparer.OrdinalIgnoreCase))
                Add(report, "error", "DEPENDENCY_NOT_PROVIDED", binary.Path, name,
                    "Non-framework managed dependency absent from inspected binary set.");
        }
        foreach (var h in md.TypeReferences)
        {
            var tr = md.GetTypeReference(h);
            if (ScopeAssembly(md, h) != sdk.Name) continue;
            if (sdk.Name == "RagePluginHook") report.rageTypeReferences++;
            else report.coreTypeReferences++;
            string typeName = binary.TypesProvider.TypeName(h);
            if (!sdk.Types.TryGetValue(typeName, out var type))
                Add(report, "error", "MISSING_TYPE", binary.Path, typeName, "Not present in inspected RPH reference.");
            else if (!IsVisible(sdk.Reader.GetTypeDefinition(type).Attributes))
                Add(report, "error", "INACCESSIBLE_TYPE", binary.Path, typeName, "RPH type not externally visible.");
        }
        foreach (var h in md.MemberReferences) CheckMember(sdk, binary, h, report);
        for (int row = 1; row <= md.GetTableRowCount(TableIndex.MethodSpec); row++)
        {
            var ms = md.GetMethodSpecification(MetadataTokens.MethodSpecificationHandle(row));
            // The MemberRef underneath the MethodSpec was already checked above.
            if (ms.Method.Kind == HandleKind.MemberReference) report.genericMethodSpecifications++;
        }
    }

    private static int Main(string[] args)
    {
        if (args.Length < 2 || args.Length > 4)
        {
            Console.Error.WriteLine("Usage: RphSignatureAudit <real RagePluginHook.dll> <packaged RageHost.dll> [packaged Core.dll] [report.json]");
            return 2;
        }
        var report = new Report();
        try
        {
            report.referencePath = Path.GetFullPath(args[0]);
            report.referenceSha256 = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(args[0])));
            // No path from a fake test build may be accepted as a deployable reference.
            if (report.referencePath.Contains("FakeRphSdk", StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("fake_rph_reference_refused");
            using var sdk = new AssemblyMetadata(args[0]);
            report.referenceIdentity = sdk.Name + ", Version=" + sdk.Version;
            if (sdk.Name != "RagePluginHook" ||
                !sdk.Types.ContainsKey("Rage.Game") ||
                !sdk.Types.ContainsKey("Rage.Native.NativeFunction") || sdk.Types.Count < 25)
                throw new InvalidDataException("The supplied file does not expose the RPH SDK API; supply the installed SDK/RagePluginHook.dll, not the RAGEPluginHook.exe launcher.");
            var paths = new List<string> { args[1] };
            if (args.Length >= 3 && args[2].EndsWith(".dll", StringComparison.OrdinalIgnoreCase)) paths.Add(args[2]);
            var available = paths.Select(p => Path.GetFileNameWithoutExtension(p)).Append(sdk.Name).ToList();
            foreach (var path in paths)
                using (var binary = new AssemblyMetadata(path))
                    Check(sdk, binary, report, available);
            // The Core DLL is deployed in a separate assembly-probing directory.
            // Verify its concrete imports from the host as well as RPH imports.
            if (paths.Count > 1)
                using (var core = new AssemblyMetadata(paths[1]))
                using (var host = new AssemblyMetadata(paths[0]))
                    Check(core, host, report, available);
            // The RPH reference MUST be the real build input. This scan checks
            // emitted metadata, but does not itself prove the compile path.
            if (report.rageTypeReferences == 0 || report.rageMemberReferences == 0)
                Add(report, "error", "NO_RPH_IMPORTS", args[1], "RagePluginHook",
                    "No RPH imports found; scanner input likely points to the wrong build.");
        }
        catch (Exception error)
        {
            Add(report, "error", "SCAN_FAILURE", args[1], "", error.GetType().Name + ": " + error.Message);
        }
        if (args.Length == 4)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(args[3]))!);
                File.WriteAllText(args[3], JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
            }
            catch (Exception ex) { Console.Error.WriteLine("Could not write report: " + ex.Message); return 2; }
        }
        foreach (var f in report.findings)
            Console.WriteLine(f.severity.ToUpperInvariant() + " " + f.code + " " + f.reference + ": " + f.detail);
        Console.WriteLine("RPH ABI scan: types=" + report.rageTypeReferences +
            " members=" + report.rageMemberReferences +
            " coreTypes=" + report.coreTypeReferences + " coreMembers=" + report.coreMemberReferences + " resolved=" + report.resolvedMembers +
            " errors=" + report.findings.Count(x => x.severity == "error") +
            " warnings=" + report.findings.Count(x => x.severity == "warning") +
            " reference=" + report.referenceIdentity + " sha256=" + report.referenceSha256);
        return report.passed ? 0 : 1;
    }
}
