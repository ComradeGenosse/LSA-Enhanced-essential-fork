using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Collections.Immutable;
using System.Text.Json;
using System.Security.Cryptography;

var file = args[0];
using var stream = File.OpenRead(file);
using var pe = new PEReader(stream);
var reader = pe.GetMetadataReader();
var types = new List<object>();
var wanted = new HashSet<string> { "NpcPlaybackCoordinator", "NpcPlaybackStartedEvent", "NpcPlaybackEndedEvent", "NpcActionRegistry", "RoleActionRouter", "ActorHydrationCoordinator", "ConversationHydrationCoordinator" };
if (args.Skip(1).Contains("--identity")) wanted = new HashSet<string> { "IIntegration", "IntegrationManager", "IntegrationJsonBlock", "ActorContext" };
if (args.Skip(1).Contains("--characters")) wanted = new HashSet<string> { "NpcActions", "NpcState", "NpcStateStore", "NpcFocus", "NpcTargeting", "ActorContextProvider" };
if (args.Skip(1).Contains("--intelligence")) wanted = new HashSet<string> { "PerceptionSnapshot", "PerceptionSystem", "NpcState", "NpcStateStore", "NpcTargeting", "NpcPlaybackCoordinator", "NpcPlaybackStartedEvent", "NpcPlaybackEndedEvent", "IIntegration", "DamageTrackerService", "PedDamageInfo", "VehDamageInfo", "WeaponDamageInfo", "DamageType" };
if (args.Skip(1).Contains("--activities")) wanted = new HashSet<string> { "NpcActionQueue", "NpcActionRegistry", "NpcActionContext", "NpcActions", "NpcState", "NpcStateStore", "NpcFocus", "FollowBehavior", "ComplianceBehavior", "MovementBehavior", "VehicleBehavior", "CombatBehavior", "ResumeActivityBehavior", "IActionStateModifier", "ActionStateModifierPhase", "PedContinuityMemoryService", "PedContinuityMemory", "LocationResolver", "LocationDefinition", "ActivityPoint", "DestinationResolver", "NpcItemStore", "IntegrationManager" };
bool characters = args.Skip(1).Contains("--characters");
// UX phase 1 player-control seams: typed request entry and input gates only.
bool controls = args.Skip(1).Contains("--controls");
if (controls) wanted = new HashSet<string> { "InputController", "TextInputService", "LsaControlsMenu", "NpcTargeting" };
var controlMethods = new HashSet<string> { "SendTextPrompt", "get_IsOpen", "get_BlocksLsaInput", "IsValidHumanPed" };
var characterMethods = new HashSet<string> { "FollowTarget", "WaitHere", "HasExclusiveControl", "ReleaseExclusiveControlForExternalSystem", "GetStateForActiveBehavior", "TryGetState", "SetFocus", "GetPlayerConversationPed", "GetCurrentSpeakerPed", "Populate", "DemoteToPassiveRuntime" };
var characterFields = new HashSet<string> { "FollowPlayerOnFoot", "FollowPaused", "EnterPassengerSeatWhenPlayerEnters", "ExitVehicleWhenPlayerExits", "StayUnderLsaControl", "InDirectedInteraction", "AccompliceMode" };
var provider = new Names { NestedNames = args.Skip(1).Contains("--intelligence") };
foreach (var handle in reader.TypeDefinitions) {
    var type = reader.GetTypeDefinition(handle);
    if (!wanted.Contains(reader.GetString(type.Name))) continue;
    var methods = type.GetMethods().Select(h => reader.GetMethodDefinition(h)).Where(m => (m.Attributes & System.Reflection.MethodAttributes.MemberAccessMask) == System.Reflection.MethodAttributes.Public && (!characters || characterMethods.Contains(reader.GetString(m.Name))) && (!controls || controlMethods.Contains(reader.GetString(m.Name)))).Select(m => {
        var sig = m.DecodeSignature(provider, (object)null);
        return new { name = reader.GetString(m.Name), returns = sig.ReturnType, parameters = sig.ParameterTypes.ToArray() };
    }).ToArray();
    var fields = type.GetFields().Select(h => reader.GetFieldDefinition(h)).Where(f => (f.Attributes & System.Reflection.FieldAttributes.FieldAccessMask) == System.Reflection.FieldAttributes.Public && (!characters || characterFields.Contains(reader.GetString(f.Name))) && !controls).Select(f => new { name = reader.GetString(f.Name), type = f.DecodeSignature(provider, (object)null) }).ToArray();
    var typeNamespace = reader.GetString(type.Namespace);
    var typeName = reader.GetString(type.Name);
    types.Add(new { name = string.IsNullOrEmpty(typeNamespace) ? typeName : typeNamespace + "." + typeName, methods, fields });
}
Console.WriteLine(JsonSerializer.Serialize(new { dllSha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file))).ToLowerInvariant(), types }, new JsonSerializerOptions { WriteIndented = true }));
sealed class Names : ISignatureTypeProvider<string, object> {
 public bool NestedNames;
 public string GetArrayType(string e, ArrayShape s) => e + "[" + new string(',',s.Rank-1) + "]";
 public string GetByReferenceType(string e) => e + "&";
 public string GetFunctionPointerType(MethodSignature<string> s) => "fn";
 public string GetGenericInstantiation(string g, ImmutableArray<string> a) => g + "<" + string.Join(",",a) + ">";
 public string GetGenericMethodParameter(object c,int i) => "!!"+i;
 public string GetGenericTypeParameter(object c,int i) => "!"+i;
 public string GetModifiedType(string m,string u,bool r) => u;
 public string GetPinnedType(string e) => e;
 public string GetPointerType(string e) => e+"*";
 public string GetPrimitiveType(PrimitiveTypeCode t) => t.ToString();
 public string GetSZArrayType(string e) => e+"[]";
 static string Qualified(string ns,string name) => string.IsNullOrEmpty(ns) ? name : ns + "." + name;
 public string GetTypeFromDefinition(MetadataReader r,TypeDefinitionHandle h,byte k) { var t=r.GetTypeDefinition(h);return NestedNames && !t.GetDeclaringType().IsNil ? GetTypeFromDefinition(r,t.GetDeclaringType(),k)+"+"+r.GetString(t.Name) : Qualified(r.GetString(t.Namespace),r.GetString(t.Name)); }
 public string GetTypeFromReference(MetadataReader r,TypeReferenceHandle h,byte k) { var t=r.GetTypeReference(h);return Qualified(r.GetString(t.Namespace),r.GetString(t.Name)); }
 public string GetTypeFromSpecification(MetadataReader r,object c,TypeSpecificationHandle h,byte k) => r.GetTypeSpecification(h).DecodeSignature(this,c);
}
