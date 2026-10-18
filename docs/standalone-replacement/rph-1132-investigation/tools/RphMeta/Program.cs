// RphMeta (Opus 5.5 redo) — read-only static metadata analysis built on dnlib.
// It never executes analysed code and has no IL-dump command. Outputs are text/TSV/JSONL.
//
// Commands
//   info    FILE                       identity, refs, module attributes, resource names, RVA blob sizes
//   types   FILE                       every TypeDef (+ base), assembly/module attributes, TypeRefs
//   api     FILE OUT.tsv               full type/member surface with canonical signatures
//   refs    FILE TARGET OUT.tsv        every TypeRef/MemberRef/MethodSpec/CustomAttribute into TARGET
//   audit   PLUGIN TARGET API OUT.tsv  resolve every import into TARGET against API with two
//                                      independent matchers (dnlib + exact CLR-style), check
//                                      accessibility, generic constraints and custom-attribute
//                                      named arguments. Exit code = number of failures (capped).
//   methods FILE TARGET OUT.jsonl      per method: TARGET tokens, ldstr literals, same-module callees
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using dnlib.DotNet;
using dnlib.DotNet.Emit;

static class Program
{
    static int Main(string[] a)
    {
        if (a.Length < 2) { Console.Error.WriteLine("see header for usage"); return 2; }
        switch (a[0])
        {
            case "info": Info(a[1]); return 0;
            case "types": Types(a[1]); return 0;
            case "api": Api(a[1], a[2]); return 0;
            case "refs": Refs(a[1], a[2], a[3]); return 0;
            case "audit": return Audit(a[1], a[2], a[3], a[4]);
            case "methods": Methods(a[1], a[2], a[3]); return 0;
            case "tables": Tables(a[1]); return 0;
            case "genparams": GenParams(a[1], a[2]); return 0;
            default: Console.Error.WriteLine("unknown command"); return 2;
        }
    }

    static ModuleDefMD Load(string path, ModuleContext ctx = null) =>
        ModuleDefMD.Load(File.ReadAllBytes(path), new ModuleCreationOptions(ctx ?? ModuleDef.CreateModuleContext()));

    // ------------------------------------------------------------------ canonical signatures
    // Scope-qualified class/valuetype names, positional generic parameters, CLR element kinds.
    static string Asm(ITypeDefOrRef t)
    {
        try { return t.DefinitionAssembly?.Name ?? "?"; } catch { return "?"; }
    }
    static string T(ITypeDefOrRef t) => t == null ? "?" : "[" + Asm(t) + "]" + t.FullName;

    static string S(TypeSig s)
    {
        switch (s)
        {
            case null: return "?";
            case CorLibTypeSig c: return c.FullName;
            case ClassSig c: return "class " + T(c.TypeDefOrRef);
            case ValueTypeSig v: return "valuetype " + T(v.TypeDefOrRef);
            case GenericMVar m: return "!!" + m.Number;
            case GenericVar v: return "!" + v.Number;
            case SZArraySig z: return S(z.Next) + "[]";
            case ArraySig r: return S(r.Next) + "[" + new string(',', (int)Math.Max(0, r.Rank - 1)) + "]";
            case ByRefSig b: return S(b.Next) + "&";
            case PtrSig p: return S(p.Next) + "*";
            case PinnedSig p: return "pinned " + S(p.Next);
            case CModReqdSig q: return "modreq(" + T(q.Modifier) + ")" + S(q.Next);
            case CModOptSig o: return "modopt(" + T(o.Modifier) + ")" + S(o.Next);
            case GenericInstSig g: return S(g.GenericType) + "<" + string.Join(",", g.GenericArguments.Select(S)) + ">";
            case FnPtrSig f: return "fnptr(" + M(f.MethodSig, "") + ")";
            case SentinelSig: return "...";
            default: return s.GetType().Name + ":" + s.FullName;
        }
    }

    static string M(MethodSig sig, string name)
    {
        if (sig == null) return name + "(?)";
        var sb = new StringBuilder(name);
        if (sig.GenParamCount > 0) sb.Append('`').Append(sig.GenParamCount);
        sb.Append('(').Append(string.Join(",", sig.Params.Select(S)));
        if (sig.ParamsAfterSentinel != null && sig.ParamsAfterSentinel.Count > 0)
            sb.Append(",...,").Append(string.Join(",", sig.ParamsAfterSentinel.Select(S)));
        sb.Append("):").Append(S(sig.RetType));
        sb.Append(sig.HasThis ? " instance" : " static");
        if (sig.ExplicitThis) sb.Append(" explicitthis");
        if ((sig.CallingConvention & CallingConvention.Mask) == CallingConvention.VarArg) sb.Append(" vararg");
        return sb.ToString();
    }

    static string F(FieldSig sig, string name) => name + ":" + S(sig?.Type);

    static bool InTarget(ITypeDefOrRef t, string target)
    {
        if (t == null) return false;
        if (t is TypeSpec ts) return SigIn(ts.TypeSig, target);
        return string.Equals(Asm(t), target, StringComparison.OrdinalIgnoreCase);
    }
    // A member belongs to TARGET only if its declaring type DEFINITION lives there.
    // Dictionary<int, Rage.Vector3>::.ctor is an mscorlib member, not an RPH member.
    static ITypeDefOrRef OwnerDefinition(ITypeDefOrRef t) =>
        t is TypeSpec ts ? (ts.TypeSig as GenericInstSig)?.GenericType?.TypeDefOrRef : t;
    static bool DeclaredIn(ITypeDefOrRef t, string target)
    {
        var d = OwnerDefinition(t);
        return d != null && !(d is TypeSpec) && string.Equals(Asm(d), target, StringComparison.OrdinalIgnoreCase);
    }

    static bool SigIn(TypeSig s, string target) => s switch
    {
        null => false,
        TypeDefOrRefSig d => InTarget(d.TypeDefOrRef, target),
        GenericInstSig g => SigIn(g.GenericType, target) || g.GenericArguments.Any(x => SigIn(x, target)),
        NonLeafSig n => SigIn(n.Next, target),
        _ => false
    };
    static bool MSigIn(MethodSig m, string target) =>
        m != null && (SigIn(m.RetType, target) || m.Params.Any(p => SigIn(p, target)));

    static string Canon(MemberRef mr) =>
        mr.IsMethodRef ? T(mr.DeclaringType) + "::" + M(mr.MethodSig, mr.Name)
                       : T(mr.DeclaringType) + "::" + F(mr.FieldSig, mr.Name) + " field";

    // ------------------------------------------------------------------ info / types / api
    static void Info(string path)
    {
        var bytes = File.ReadAllBytes(path);
        using var mod = Load(path);
        Console.WriteLine($"sha256={Convert.ToHexString(SHA256.HashData(bytes))} size={bytes.Length}");
        Console.WriteLine($"module={mod.Name} kind={mod.Kind} machine={mod.Machine} cor20={mod.Cor20HeaderFlags} runtime={mod.RuntimeVersion}");
        Console.WriteLine($"assembly={mod.Assembly?.FullName}");
        foreach (var ar in mod.GetAssemblyRefs()) Console.WriteLine($"assemblyref={ar.FullName}");
        foreach (var mr in mod.GetModuleRefs()) Console.WriteLine($"moduleref={mr.Name}");
        foreach (var ca in mod.CustomAttributes) Console.WriteLine($"module_attribute={ca.TypeFullName}");
        var types = mod.GetTypes().ToList();
        Console.WriteLine($"typedefs={types.Count} rage_namespace_typedefs={types.Count(t => t.Namespace.String == "Rage" || t.Namespace.String.StartsWith("Rage.", StringComparison.Ordinal))}");
        foreach (var r in mod.Resources) Console.WriteLine($"resource={r.Name} kind={r.ResourceType}");
        foreach (var f in types.SelectMany(t => t.Fields).Where(f => f.HasFieldRVA))
        {
            int size = 0; try { size = f.InitialValue?.Length ?? 0; } catch { }
            Console.WriteLine($"rva_field_bytes={size}");
        }
        var pinvokeModules = types.SelectMany(t => t.Methods).Where(m => m.ImplMap != null)
            .GroupBy(m => m.ImplMap.Module?.Name.String ?? "?").Select(g => $"{g.Key}:{g.Count()}");
        Console.WriteLine($"pinvoke_modules={string.Join(",", pinvokeModules)}");
        var pinvokeNames = types.SelectMany(t => t.Methods).Where(m => m.ImplMap != null)
            .Select(m => m.ImplMap.Name.String).Distinct().OrderBy(x => x, StringComparer.Ordinal);
        Console.WriteLine($"pinvoke_entrypoints={string.Join(",", pinvokeNames)}");
        var callsTo = new HashSet<string>(StringComparer.Ordinal);
        foreach (var m in types.SelectMany(t => t.Methods))
        {
            if (!m.HasBody) continue;
            foreach (var ins in m.Body.Instructions)
                if (ins.Operand is IMethod im && im.DeclaringType != null &&
                    (im.FullName.Contains("System.Reflection.Assembly::Load", StringComparison.Ordinal) ||
                     im.FullName.Contains("System.AppDomain::add_AssemblyResolve", StringComparison.Ordinal) ||
                     im.FullName.Contains("System.AppDomain::add_ResourceResolve", StringComparison.Ordinal) ||
                     im.FullName.Contains("System.AppDomain::CreateDomain", StringComparison.Ordinal)))
                    callsTo.Add(im.FullName);
        }
        foreach (var c in callsTo.OrderBy(x => x, StringComparer.Ordinal)) Console.WriteLine($"framework_call={c}");
    }

    static void Types(string path)
    {
        using var mod = Load(path);
        foreach (var t in mod.GetTypes())
            Console.WriteLine($"TYPEDEF\t{t.FullName}\tbase={t.BaseType?.FullName}\t{t.Visibility}");
        if (mod.Assembly != null)
            foreach (var ca in mod.Assembly.CustomAttributes)
                Console.WriteLine($"ASSEMBLY_ATTR\t{ca.TypeFullName}\t{string.Join("|", ca.ConstructorArguments.Select(x => x.Value?.ToString()))}");
        foreach (var ca in mod.CustomAttributes) Console.WriteLine($"MODULE_ATTR\t{ca.TypeFullName}");
        foreach (var tr in mod.GetTypeRefs()) Console.WriteLine($"TYPEREF\t{tr.FullName}\t{tr.Scope?.ScopeName}");
    }

    static void Api(string path, string outPath)
    {
        using var mod = Load(path);
        var o = new List<string>();
        foreach (var t in mod.GetTypes().OrderBy(t => t.FullName, StringComparer.Ordinal))
        {
            o.Add($"TYPE\t{T(t)}\t{t.Visibility}\tbase={(t.BaseType == null ? "" : T(t.BaseType))}\tgen={t.GenericParameters.Count}");
            foreach (var m in t.Methods)
                o.Add($"METHOD\t{T(t)}::{M(m.MethodSig, m.Name)}\t{m.Access}{(m.IsVirtual ? ",virtual" : "")}{(m.IsAbstract ? ",abstract" : "")}");
            foreach (var f in t.Fields)
                o.Add($"FIELD\t{T(t)}::{F(f.FieldSig, f.Name)}{(f.IsStatic ? " static" : " instance")}\t{f.Access}");
            foreach (var p in t.Properties)
                o.Add($"PROPERTY\t{T(t)}::{p.Name}:{S(p.PropertySig?.RetType)}\tget={(p.GetMethod != null ? p.GetMethod.Access.ToString() : "-")}\tset={(p.SetMethod != null ? p.SetMethod.Access.ToString() : "-")}");
        }
        File.WriteAllLines(outPath, o);
        Console.WriteLine($"api lines={o.Count}");
    }

    // ------------------------------------------------------------------ refs
    static IEnumerable<CustomAttribute> AllAttributes(ModuleDefMD mod)
    {
        if (mod.Assembly != null) foreach (var ca in mod.Assembly.CustomAttributes) yield return ca;
        foreach (var ca in mod.CustomAttributes) yield return ca;
        foreach (var t in mod.GetTypes())
        {
            foreach (var ca in t.CustomAttributes) yield return ca;
            foreach (var m in t.Methods) { foreach (var ca in m.CustomAttributes) yield return ca;
                foreach (var p in m.ParamDefs) foreach (var ca in p.CustomAttributes) yield return ca; }
            foreach (var f in t.Fields) foreach (var ca in f.CustomAttributes) yield return ca;
            foreach (var p in t.Properties) foreach (var ca in p.CustomAttributes) yield return ca;
            foreach (var e in t.Events) foreach (var ca in e.CustomAttributes) yield return ca;
        }
    }

    static void Refs(string path, string target, string outPath)
    {
        using var mod = Load(path);
        var o = new List<string>();
        foreach (var tr in mod.GetTypeRefs())
            if (InTarget(tr, target)) o.Add($"TYPEREF\t{T(tr)}\ttoken=0x{tr.MDToken.Raw:X8}");
        for (uint rid = 1; rid <= mod.Metadata.TablesStream.MemberRefTable.Rows; rid++)
        {
            var mr = mod.ResolveMemberRef(rid);
            if (mr == null) continue;
            bool decl = InTarget(mr.DeclaringType, target);
            bool sig = mr.IsMethodRef ? MSigIn(mr.MethodSig, target) : SigIn(mr.FieldSig?.Type, target);
            if (decl || sig) o.Add($"{(mr.IsMethodRef ? "METHODREF" : "FIELDREF")}\t{Canon(mr)}\t{(decl ? "declared_in_target" : "signature_mentions_target")}\ttoken=0x{mr.MDToken.Raw:X8}");
        }
        for (uint rid = 1; rid <= mod.Metadata.TablesStream.MethodSpecTable.Rows; rid++)
        {
            var ms = mod.ResolveMethodSpec(rid);
            if (ms?.Method is MemberRef mr && (InTarget(mr.DeclaringType, target) ||
                (ms.GenericInstMethodSig?.GenericArguments.Any(x => SigIn(x, target)) ?? false)))
                o.Add($"METHODSPEC\t{Canon(mr)}<{string.Join(",", ms.GenericInstMethodSig.GenericArguments.Select(S))}>\ttoken=0x{ms.MDToken.Raw:X8}");
        }
        foreach (var ca in AllAttributes(mod))
            if (InTarget(ca.AttributeType, target))
                o.Add($"ATTRIBUTE\t{T(ca.AttributeType)}\tctor_args={string.Join("|", ca.ConstructorArguments.Select(x => x.Value?.ToString()))}\tnamed={string.Join("|", ca.NamedArguments.Select(n => (n.IsProperty ? "P:" : "F:") + n.Name + "=" + n.Argument.Value))}");
        o.Sort(StringComparer.Ordinal);
        File.WriteAllLines(outPath, o);
        Console.WriteLine($"refs into {target}: {o.Count}");
    }

    // ------------------------------------------------------------------ audit (two matchers)
    sealed class OneAssemblyResolver : IAssemblyResolver
    {
        readonly string name; readonly AssemblyDef asm;
        public OneAssemblyResolver(string name, AssemblyDef asm) { this.name = name; this.asm = asm; }
        public AssemblyDef Resolve(IAssembly a, ModuleDef src) =>
            string.Equals(a.Name, name, StringComparison.OrdinalIgnoreCase) ? asm : null;
    }

    static TypeDef FindType(ModuleDef api, ITypeDefOrRef tr)
    {
        if (tr is TypeRef r && r.DeclaringType != null)
        {
            var outer = FindType(api, r.DeclaringType);
            return outer?.NestedTypes.FirstOrDefault(n => n.Name == r.Name);
        }
        return api.Types.FirstOrDefault(t => t.Namespace == tr.Namespace && t.Name == tr.Name);
    }

    static bool TypeAccessible(TypeDef t)
    {
        for (var cur = t; cur != null; cur = cur.DeclaringType)
            if (!(cur.IsPublic || cur.IsNestedPublic)) return false;
        return true;
    }

    static IEnumerable<TypeDef> Chain(TypeDef t)
    {
        var seen = new HashSet<TypeDef>();
        for (var cur = t; cur != null && seen.Add(cur);)
        {
            yield return cur;
            TypeDef next = null;
            try { next = cur.BaseType?.ResolveTypeDef(); } catch { }
            cur = next;
        }
    }

    static bool DerivesFrom(TypeDef t, TypeDef ancestor) => Chain(t).Any(x => x == ancestor) ||
        Chain(t).Any(x => x.Interfaces.Any(i => { try { return i.Interface.ResolveTypeDef() == ancestor; } catch { return false; } }));

    static int Audit(string pluginPath, string target, string apiPath, string outPath)
    {
        var apiCtx = new ModuleContext();
        var api = ModuleDefMD.Load(File.ReadAllBytes(apiPath), apiCtx);
        var ctx = new ModuleContext();
        var res = new OneAssemblyResolver(target, api.Assembly);
        ctx.AssemblyResolver = res; ctx.Resolver = new Resolver(res);
        using var mod = ModuleDefMD.Load(File.ReadAllBytes(pluginPath), ctx);
        var o = new List<string>();
        int okTypes = 0, okMembers = 0, okSpecs = 0, okNamed = 0, fail = 0, disagree = 0;

        foreach (var tr in mod.GetTypeRefs().Where(t => InTarget(t, target)))
        {
            var td = FindType(api, tr);
            if (td == null) { fail++; o.Add($"FAIL\tMISSING_TYPE\t{T(tr)}"); }
            else if (!TypeAccessible(td)) { fail++; o.Add($"FAIL\tINACCESSIBLE_TYPE\t{T(tr)}\t{td.Visibility}"); }
            else { okTypes++; o.Add($"OK\tTYPE\t{T(tr)}"); }
        }

        var resolvedRefs = new Dictionary<uint, IMemberDef>(); // keyed by token: MethodSpec.Method may be a distinct instance
        for (uint rid = 1; rid <= mod.Metadata.TablesStream.MemberRefTable.Rows; rid++)
        {
            var mr = mod.ResolveMemberRef(rid);
            if (mr == null || !DeclaredIn(mr.DeclaringType, target)) continue;
            string c = Canon(mr);
            // Matcher 1: exact canonical string match with base-type walk (CLR MemberRef semantics).
            IMemberDef exact = null; var candidates = new List<string>();
            // Generic-instance parents are matched against the generic definition: member
            // signatures on both sides use positional !N / !!N, so canonical strings compare.
            var owner = FindType(api, OwnerDefinition(mr.DeclaringType));
            if (owner != null)
                foreach (var t in Chain(owner))
                {
                    if (mr.IsMethodRef)
                        foreach (var m in t.Methods.Where(m => m.Name == mr.Name))
                        {
                            string mc = M(m.MethodSig, m.Name);
                            candidates.Add(T(t) + "::" + mc + " {" + m.Access + "}");
                            if (exact == null && mc == M(mr.MethodSig, mr.Name)) exact = m;
                        }
                    else
                        foreach (var f in t.Fields.Where(f => f.Name == mr.Name))
                        {
                            string fc = F(f.FieldSig, f.Name);
                            candidates.Add(T(t) + "::" + fc + " {" + f.Access + "}");
                            // Field MemberRef signatures carry no static/instance bit; the CLR matches
                            // name + field type (static-ness is checked against the IL opcode at JIT).
                            if (exact == null && fc == F(mr.FieldSig, mr.Name)) exact = f;
                        }
                    if (exact != null) break;
                }
            // Matcher 2: dnlib's own resolver.
            IMemberDef viaDnlib = null;
            try { viaDnlib = mr.IsMethodRef ? mr.ResolveMethod() : mr.ResolveField(); } catch { }
            if ((exact == null) != (viaDnlib == null)) { disagree++; o.Add($"WARN\tMATCHERS_DISAGREE\t{c}\texact={(exact != null)}\tdnlib={(viaDnlib != null)}"); }
            if (owner == null) { fail++; o.Add($"FAIL\tMISSING_DECLARING_TYPE\t{c}"); continue; }
            if (exact == null) { fail++; o.Add($"FAIL\tMISSING_MEMBER\t{c}\tsame_name=[{string.Join(" ; ", candidates)}]"); continue; }
            string access = exact is MethodDef emd ? emd.Access.ToString() : ((FieldDef)exact).Access.ToString();
            bool accessible = access == "Public" || access == "Family" || access == "FamilyOrAssembly";
            if (!accessible) { fail++; o.Add($"FAIL\tINACCESSIBLE_MEMBER\t{c}\t{access}"); continue; }
            if (exact is MethodDef emd2 && mr.MethodSig != null && emd2.MethodSig.HasThis != mr.MethodSig.HasThis)
            { fail++; o.Add($"FAIL\tSTATIC_INSTANCE_MISMATCH\t{c}"); continue; }
            okMembers++; resolvedRefs[mr.MDToken.Raw] = exact;
            o.Add($"OK\tMEMBER\t{c}\t{access}{(access != "Public" ? "\tPROTECTED_ACCESS" : "")}");
        }

        // MethodSpecs: arity and generic constraints against the resolved definition.
        for (uint rid = 1; rid <= mod.Metadata.TablesStream.MethodSpecTable.Rows; rid++)
        {
            var ms = mod.ResolveMethodSpec(rid);
            if (!(ms?.Method is MemberRef mr) || !DeclaredIn(mr.DeclaringType, target)) continue;
            var args = ms.GenericInstMethodSig?.GenericArguments ?? new List<TypeSig>();
            string c = Canon(mr) + "<" + string.Join(",", args.Select(S)) + ">";
            if (!resolvedRefs.TryGetValue(mr.MDToken.Raw, out var def) || !(def is MethodDef md)) { o.Add($"SKIP\tSPEC_OF_UNRESOLVED\t{c}"); continue; }
            if (md.GenericParameters.Count != args.Count) { fail++; o.Add($"FAIL\tGENERIC_ARITY\t{c}"); continue; }
            var problems = new List<string>();
            for (int i = 0; i < args.Count; i++)
            {
                var gp = md.GenericParameters[i];
                var arg = args[i];
                // A caller's own generic parameter (!N / !!N) is validated by the compiler against
                // the caller's declared constraints and by the CLR at concrete instantiation time.
                if (arg is GenericVar || arg is GenericMVar) continue;
                var argTd = (arg as TypeDefOrRefSig)?.TypeDefOrRef;
                TypeDef argDef = null;
                if (argTd != null) argDef = InTarget(argTd, target) ? FindType(api, argTd) : null;
                if (gp.Flags.HasFlag(GenericParamAttributes.NotNullableValueTypeConstraint) && !(arg.IsValueType)) problems.Add($"{gp.Name}:struct");
                if (gp.Flags.HasFlag(GenericParamAttributes.ReferenceTypeConstraint) && arg.IsValueType) problems.Add($"{gp.Name}:class");
                foreach (var gc in gp.GenericParamConstraints)
                {
                    TypeDef need = null; try { need = gc.Constraint.ResolveTypeDef(); } catch { }
                    if (need == null || need.Module != api) continue; // only judge RPH-defined constraints
                    if (argDef == null || !DerivesFrom(argDef, need)) problems.Add($"{gp.Name}:{need.FullName}");
                }
            }
            if (problems.Count > 0) { fail++; o.Add($"FAIL\tGENERIC_CONSTRAINT\t{c}\t{string.Join(",", problems)}"); }
            else { okSpecs++; o.Add($"OK\tSPEC\t{c}"); }
        }

        // Custom attributes: named properties/fields must exist with the same type (read by reflection).
        foreach (var ca in AllAttributes(mod).Where(x => InTarget(x.AttributeType, target)))
        {
            var at = FindType(api, ca.AttributeType);
            if (at == null) { fail++; o.Add($"FAIL\tATTRIBUTE_TYPE_MISSING\t{T(ca.AttributeType)}"); continue; }
            foreach (var na in ca.NamedArguments)
            {
                string want = S(na.Type);
                bool found = false; string got = "";
                foreach (var t in Chain(at))
                {
                    if (na.IsProperty)
                    {
                        var p = t.Properties.FirstOrDefault(x => x.Name == na.Name);
                        if (p != null) { got = S(p.PropertySig?.RetType); found = got == want && p.SetMethod != null && p.SetMethod.IsPublic; break; }
                    }
                    else
                    {
                        var f = t.Fields.FirstOrDefault(x => x.Name == na.Name);
                        if (f != null) { got = S(f.FieldSig?.Type); found = got == want && f.IsPublic; break; }
                    }
                }
                if (found) { okNamed++; o.Add($"OK\tNAMED_ARG\t{T(at)}.{na.Name}:{want}"); }
                else { fail++; o.Add($"FAIL\tNAMED_ARG\t{T(at)}.{na.Name}:{want}\tfound={got}"); }
            }
        }
        o.Insert(0, $"SUMMARY\ttypes_ok={okTypes}\tmembers_ok={okMembers}\tspecs_ok={okSpecs}\tnamed_args_ok={okNamed}\tfailures={fail}\tmatcher_disagreements={disagree}\tapi={Path.GetFileName(apiPath)}\tplugin={Path.GetFileName(pluginPath)}");
        File.WriteAllLines(outPath, o);
        Console.WriteLine(o[0]);
        return Math.Min(fail + disagree, 100);
    }

    static void Tables(string path)
    {
        using var mod = Load(path);
        foreach (var t in mod.Metadata.TablesStream.MDTables)
            if (t.Rows > 0) Console.WriteLine($"{t.Table}\t{t.Rows}");
    }

    // Generic parameter flags/constraints of methods named NAME (e.g. CallByName) in FILE.
    static void GenParams(string path, string name)
    {
        using var mod = Load(path);
        foreach (var m in mod.GetTypes().SelectMany(t => t.Methods).Where(m => m.Name == name && m.GenericParameters.Count > 0))
            foreach (var gp in m.GenericParameters)
                Console.WriteLine($"{T(m.DeclaringType)}::{M(m.MethodSig, m.Name)}\t{gp.Name}\tflags={gp.Flags}\tconstraints={string.Join(",", gp.GenericParamConstraints.Select(c => c.Constraint.FullName))}");
    }

    // ------------------------------------------------------------------ methods (per-method facts)
    static void Methods(string path, string target, string outPath)
    {
        using var mod = Load(path);
        using var w = new StreamWriter(outPath);
        foreach (var t in mod.GetTypes())
            foreach (var m in t.Methods)
            {
                if (!m.HasBody) continue;
                var rph = new List<object>(); var strs = new List<string>(); var calls = new List<object>();
                foreach (var ins in m.Body.Instructions)
                {
                    switch (ins.Operand)
                    {
                        case string s when ins.OpCode.Code == Code.Ldstr: strs.Add(s); break;
                        case MemberRef mr when InTarget(mr.DeclaringType, target) || (mr.IsMethodRef ? MSigIn(mr.MethodSig, target) : SigIn(mr.FieldSig?.Type, target)):
                            rph.Add(new { il = ins.Offset, op = ins.OpCode.Name, member = Canon(mr) }); break;
                        case MethodSpec ms when ms.Method is MemberRef mr2 && InTarget(mr2.DeclaringType, target):
                            rph.Add(new { il = ins.Offset, op = ins.OpCode.Name, member = Canon(mr2) + "<" + string.Join(",", ms.GenericInstMethodSig.GenericArguments.Select(S)) + ">" }); break;
                        case ITypeDefOrRef tr when InTarget(tr, target):
                            rph.Add(new { il = ins.Offset, op = ins.OpCode.Name, member = "type " + T(tr) }); break;
                    }
                    if (ins.Operand is MethodDef callee && callee.Module == mod)
                        calls.Add(new { il = ins.Offset, op = ins.OpCode.Name, token = $"0x{callee.MDToken.Raw:X8}", name = callee.FullName });
                    else if (ins.Operand is MethodSpec spec && spec.Method is MethodDef gdef && gdef.Module == mod)
                        calls.Add(new { il = ins.Offset, op = ins.OpCode.Name, token = $"0x{gdef.MDToken.Raw:X8}", name = gdef.FullName });
                }
                w.WriteLine(JsonSerializer.Serialize(new
                {
                    token = $"0x{m.MDToken.Raw:X8}", type = t.FullName, name = m.Name.String, full = m.FullName,
                    cctor = m.IsStaticConstructor, rph, strings = strs, calls
                }));
            }
        Console.WriteLine($"methods -> {outPath}");
    }
}
