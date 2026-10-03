#nullable disable
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Reflection.Emit;
using System.Collections.Immutable;
using System.Text.Json;
using System.Security.Cryptography;

if(args.Length!=2)throw new ArgumentException("Usage: NativeAudit <assembly> <output.json>");
var file = args[0];
using var stream = File.OpenRead(file);
using var pe = new PEReader(stream);
var reader = pe.GetMetadataReader();
var provider = new Names();
string Describe(EntityHandle h) {
  try { return h.Kind switch {
    HandleKind.TypeDefinition => provider.GetTypeFromDefinition(reader,(TypeDefinitionHandle)h,0),
    HandleKind.TypeReference => provider.GetTypeFromReference(reader,(TypeReferenceHandle)h,0),
    HandleKind.TypeSpecification => provider.GetTypeFromSpecification(reader,null,(TypeSpecificationHandle)h,0),
    HandleKind.MethodDefinition => Describe(reader.GetMethodDefinition((MethodDefinitionHandle)h).GetDeclaringType())+"::"+reader.GetString(reader.GetMethodDefinition((MethodDefinitionHandle)h).Name),
    HandleKind.MemberReference => Describe(reader.GetMemberReference((MemberReferenceHandle)h).Parent)+"::"+reader.GetString(reader.GetMemberReference((MemberReferenceHandle)h).Name),
    HandleKind.FieldDefinition => Describe(reader.GetFieldDefinition((FieldDefinitionHandle)h).GetDeclaringType())+"::"+reader.GetString(reader.GetFieldDefinition((FieldDefinitionHandle)h).Name),
    HandleKind.MethodSpecification => Describe(reader.GetMethodSpecification((MethodSpecificationHandle)h).Method),
    _ => h.Kind.ToString()
  }; } catch { return h.Kind.ToString(); }
}
var ops = typeof(OpCodes).GetFields().Where(f=>f.FieldType==typeof(OpCode)).Select(f=>(OpCode)f.GetValue(null)).ToDictionary(o=>(ushort)o.Value);
object[] IL(MethodDefinition m) {
  if(m.RelativeVirtualAddress==0)return [];
  try {
    var bytes=pe.GetMethodBody(m.RelativeVirtualAddress).GetILBytes();
    var result=new List<object>();
    for(int p=0;p<bytes.Length;) {
      int start=p; ushort code=bytes[p++];if(code==0xfe)code=(ushort)(0xfe00|bytes[p++]);
      if(!ops.TryGetValue(code,out var op)){result.Add(new{offset=start,op="UNKNOWN",operand=code.ToString()});break;}
      string operand="";int? rawToken=null; int[] targets=null; object value=null; int size=op.OperandType switch {
        OperandType.InlineNone=>0,
        OperandType.ShortInlineBrTarget or OperandType.ShortInlineI or OperandType.ShortInlineVar=>1,
        OperandType.InlineVar=>2,
        OperandType.InlineI8 or OperandType.InlineR=>8,
        OperandType.InlineSwitch=>4+4*BitConverter.ToInt32(bytes,p),
        _=>4
      };
      if(op.OperandType==OperandType.InlineString)operand=reader.GetUserString(MetadataTokens.UserStringHandle(BitConverter.ToInt32(bytes,p)&0xffffff));
      else if(op.OperandType is OperandType.InlineMethod or OperandType.InlineField or OperandType.InlineType or OperandType.InlineTok){rawToken=BitConverter.ToInt32(bytes,p);operand=Describe(MetadataTokens.EntityHandle(rawToken.Value));}
      else if(size>0)operand=Convert.ToHexString(bytes.AsSpan(p,size));
      if(op.OperandType==OperandType.ShortInlineBrTarget) targets=[p+size+(sbyte)bytes[p]];
      if(op.OperandType==OperandType.InlineBrTarget) targets=[p+size+BitConverter.ToInt32(bytes,p)];
      if(op.OperandType==OperandType.InlineSwitch) targets=Enumerable.Range(0,BitConverter.ToInt32(bytes,p)).Select(i=>p+size+BitConverter.ToInt32(bytes,p+4+4*i)).ToArray();
      if(op.OperandType==OperandType.InlineI)value=BitConverter.ToInt32(bytes,p);
      if(op.OperandType==OperandType.ShortInlineI)value=(sbyte)bytes[p];
      if(op.OperandType==OperandType.InlineVar)value=BitConverter.ToUInt16(bytes,p);
      if(op.OperandType==OperandType.ShortInlineVar)value=bytes[p];
      p+=size;result.Add(new{offset=start,op=op.Name,operand,rawToken,targets,value});
    }
    return result.ToArray();
  } catch(Exception e){return [new{error=e.Message}];}
}
var types = new List<object>();
foreach(var h in reader.TypeDefinitions) {
  var t=reader.GetTypeDefinition(h);var name=reader.GetString(t.Name);
  var methods=t.GetMethods().Select(mh=>{
    var m=reader.GetMethodDefinition(mh);var sig=m.DecodeSignature(provider,(object)null);
    var regions = m.RelativeVirtualAddress == 0 ? [] : pe.GetMethodBody(m.RelativeVirtualAddress).ExceptionRegions.Select(e=>new{kind=e.Kind.ToString(),tryOffset=e.TryOffset,tryLength=e.TryLength,handlerOffset=e.HandlerOffset,handlerLength=e.HandlerLength,catchType=e.CatchType.IsNil?null:Describe(e.CatchType),filterOffset=e.Kind==ExceptionRegionKind.Filter?(int?)e.FilterOffset:null}).ToArray();
    return new{name=reader.GetString(m.Name),declaringType=Describe(h),attributes=m.Attributes.ToString(),returns=sig.ReturnType,parameters=sig.ParameterTypes.ToArray(),token=MetadataTokens.GetToken(mh),exceptionRegions=regions,il=IL(m)};
  }).ToArray();
  var fields=t.GetFields().Select(fh=>{var f=reader.GetFieldDefinition(fh);var ch=f.GetDefaultValue();return new{token=MetadataTokens.GetToken(fh),name=reader.GetString(f.Name),attributes=f.Attributes.ToString(),type=f.DecodeSignature(provider,(object)null),constant=ch.IsNil?null:Convert.ToHexString(reader.GetBlobBytes(reader.GetConstant(ch).Value))};}).ToArray();
  var events=t.GetEvents().Select(eh=>{var e=reader.GetEventDefinition(eh);return new{name=reader.GetString(e.Name),type=Describe(e.Type)};}).ToArray();
  types.Add(new{name=Describe(h),attributes=t.Attributes.ToString(),methods,fields,events});
}
var methodSpecs=Enumerable.Range(1,reader.GetTableRowCount(TableIndex.MethodSpec)).Select(i=>MetadataTokens.MethodSpecificationHandle(i)).Select(h=>new{token=MetadataTokens.GetToken(h),methodToken=MetadataTokens.GetToken(reader.GetMethodSpecification(h).Method),signatureHex=Convert.ToHexString(reader.GetBlobBytes(reader.GetMethodSpecification(h).Signature))}).ToArray();
var rvaFields=reader.FieldDefinitions.Select(h=>new{token=MetadataTokens.GetToken(h),rva=reader.GetFieldDefinition(h).GetRelativeVirtualAddress()}).Where(x=>x.rva!=0).Select(x=>new{x.token,x.rva,data=Convert.ToHexString(pe.GetSectionData(x.rva).GetContent(0,Math.Min(62144,pe.GetSectionData(x.rva).Length)).ToArray())}).ToArray();
var memberRefs=reader.MemberReferences.Select(h=>new{token=MetadataTokens.GetToken(h),name=Describe(h)}).ToArray();
var assemblyRefs=reader.AssemblyReferences.Select(h=>{var ar=reader.GetAssemblyReference(h);return new{name=reader.GetString(ar.Name),version=ar.Version.ToString()};}).ToArray();
File.WriteAllText(args[1],JsonSerializer.Serialize(new{dllSha256=Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file))).ToLowerInvariant(),assemblyRefs,methodSpecs,rvaFields,memberRefs,types},new JsonSerializerOptions{WriteIndented=true}));
sealed class Names : ISignatureTypeProvider<string,object> {
 public string GetArrayType(string e,ArrayShape s)=>e+"["+new string(',',s.Rank-1)+"]";
 public string GetByReferenceType(string e)=>e+"&";
 public string GetFunctionPointerType(MethodSignature<string> s)=>"fn";
 public string GetGenericInstantiation(string g,ImmutableArray<string>a)=>g+"<"+string.Join(",",a)+">";
 public string GetGenericMethodParameter(object c,int i)=>"!!"+i;
 public string GetGenericTypeParameter(object c,int i)=>"!"+i;
 public string GetModifiedType(string m,string u,bool r)=>u;
 public string GetPinnedType(string e)=>e;
 public string GetPointerType(string e)=>e+"*";
 public string GetPrimitiveType(PrimitiveTypeCode t)=>t.ToString();
 public string GetSZArrayType(string e)=>e+"[]";
 public string GetTypeFromDefinition(MetadataReader r,TypeDefinitionHandle h,byte k){var t=r.GetTypeDefinition(h);var parent=t.GetDeclaringType();return parent.IsNil?r.GetString(t.Namespace)+"."+r.GetString(t.Name):GetTypeFromDefinition(r,parent,k)+"+"+r.GetString(t.Name);}
 public string GetTypeFromReference(MetadataReader r,TypeReferenceHandle h,byte k){var t=r.GetTypeReference(h);return r.GetString(t.Namespace)+"."+r.GetString(t.Name);}
 public string GetTypeFromSpecification(MetadataReader r,object c,TypeSpecificationHandle h,byte k)=>r.GetTypeSpecification(h).DecodeSignature(this,c);
}
