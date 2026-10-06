import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ACTIVITY_CAPABILITIES_SHA256, loadCapabilityRegistry } from '../src/activities/capabilityRegistry.mjs';

const DLL = '9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653';
const EXPECTED = [
  ['IActionStateModifier', 'ApplyActionState', 'Void', ['Rage.Ped', 'LosSantosAlive.NPC.NpcState', 'String', 'ActionStateModifierPhase']],
  ['LosSantosAlive.NPC.NpcActionQueue', 'QueueNpcAction', 'Void', ['String', 'String', 'String', 'Rage.Ped', 'Rage.Ped']],
  ['LosSantosAlive.NPC.NpcActions', 'UseScenario', 'Void', ['Rage.Ped', 'String']],
  ['LosSantosAlive.NPC.NpcActions', 'UseScenarioAtPosition', 'Void', ['Rage.Ped', 'String', 'Rage.Vector3', 'Single', 'String']],
  ['LosSantosAlive.NPC.NpcActions', 'ClearFollowFlags', 'Void', ['LosSantosAlive.NPC.NpcState']],
  ['LosSantosAlive.NPC.NpcActions', 'ClearHeldItem', 'Void', ['Rage.Ped']],
  ['LosSantosAlive.NPC.NpcActions', 'ChaseTarget', 'Void', ['Rage.Ped', 'Rage.Ped']],
  ['LosSantosAlive.NPC.NpcActions', 'StopDirectedInteraction', 'Void', ['Rage.Ped']],
  ['LosSantosAlive.NPC.Behaviors.FollowBehavior', 'StopFollowTarget', 'Void', ['LosSantosAlive.NPC.NpcState']],
  ['LosSantosAlive.NPC.Behaviors.ComplianceBehavior', 'StopSitOnGround', 'Void', ['LosSantosAlive.NPC.NpcState']],
  ['LosSantosAlive.NPC.Behaviors.MovementBehavior', 'StopApproachTarget', 'Void', ['LosSantosAlive.NPC.NpcState']],
  ['LosSantosAlive.NPC.Behaviors.MovementBehavior', 'StopChaseTarget', 'Void', ['LosSantosAlive.NPC.NpcState']],
  ['LosSantosAlive.NPC.Behaviors.VehicleBehavior', 'StopAllVehicleCommands', 'Void', ['Rage.Ped', 'LosSantosAlive.NPC.NpcState']],
  ['LosSantosAlive.NPC.Behaviors.VehicleBehavior', 'StopFollowTargetVehicle', 'Boolean', ['Rage.Ped', 'LosSantosAlive.NPC.NpcState']],
  ['LosSantosAlive.NPC.Behaviors.VehicleBehavior', 'StopVehicleTaskOnly', 'Void', ['Rage.Ped']],
  ['LosSantosAlive.NPC.Behaviors.CombatBehavior', 'StopWalkAwayFromTarget', 'Void', ['Rage.Ped', 'LosSantosAlive.NPC.NpcState', 'Boolean']],
  ['LosSantosAlive.NPC.Behaviors.CombatBehavior', 'StopTakeCover', 'Void', ['Rage.Ped', 'LosSantosAlive.NPC.NpcState', 'Boolean']],
  ['LosSantosAlive.NPC.NpcFocus', 'SetFocus', 'Void', ['Rage.Ped', 'Rage.Ped', 'String']],
  ['LosSantosAlive.NPC.Memory.PedContinuityMemoryService', 'TryGetMemory', 'Boolean', ['Rage.Ped', 'LosSantosAlive.NPC.Memory.PedContinuityMemory&']],
  ['LosSantosAlive.Locations.LocationResolver', 'Resolve', 'LosSantosAlive.Locations.LocationDefinition', ['String', 'Rage.Ped']],
  ['LosSantosAlive.NPC.Navigation.DestinationResolver', 'TryResolve', 'Boolean', ['String', 'Rage.Vector3&']],
  ['LosSantosAlive.Integrations.IntegrationManager', 'ApplyActionStateModifiers', 'Void', ['Rage.Ped', 'LosSantosAlive.NPC.NpcState', 'String', 'ActionStateModifierPhase']],
  ['LosSantosAlive.NPC.Actions.NpcActionRegistry', 'HasAction', 'Boolean', ['String']],
  ['LosSantosAlive.NPC.NpcState', 'HasActiveReflex', 'Boolean', null],
];

function method(data, type, name, returns, parameters) {
  const matches = data.types.filter(item => item.name === type);
  if (matches.length !== 1) throw new Error('type:' + type);
  const found = matches[0].methods.filter(item => item.name === name && item.returns === returns && JSON.stringify(item.parameters) === JSON.stringify(parameters));
  if (found.length !== 1) throw new Error('signature:' + type + '.' + name);
}
function field(data, type, name, fieldType) {
  const matches = data.types.filter(item => item.name === type);
  if (matches.length !== 1 || matches[0].fields.filter(item => item.name === name && item.type === fieldType).length !== 1) throw new Error('field:' + type + '.' + name);
}

export async function verifyActivitiesContract({ metadataText, contractBytes, sourceText } = {}) {
  try {
    const metadataBytes = metadataText ?? await readFile(new URL('../docs/activities-native-metadata.json', import.meta.url));
    const contract = contractBytes ?? await readFile(new URL('../../contracts/activity-capabilities.v1.json', import.meta.url));
    const source = sourceText ?? await readFile(new URL('../../native/activities/CapabilityTable.cs', import.meta.url), 'utf8');
    const hash = value => createHash('sha256').update(value).digest('hex');
    const metadataSha = hash(metadataBytes);
    if (hash(contract) !== ACTIVITY_CAPABILITIES_SHA256) throw new Error('contract');
    const pinned = source.match(/ContractSha256 = "([0-9a-f]{64})"/)?.[1];
    if (pinned !== ACTIVITY_CAPABILITIES_SHA256) throw new Error('native-pin');
    const metadata = JSON.parse(String(metadataBytes));
    if (metadata.dllSha256 !== DLL) throw new Error('dll');
    for (const [type, name, returns, parameters] of EXPECTED) {
      if (parameters) method(metadata, type, name, returns, parameters); else field(metadata, type, name, returns);
    }
    const registry = loadCapabilityRegistry(contract);
    const members = new Set();
    for (const row of registry.document.capabilities) {
      for (const value of [row.execution.essentialName, row.cancel.essentialName]) {
        if (!value) continue;
        for (const token of value.split(/[|+]/)) if (/^(NpcActions|FollowBehavior|ComplianceBehavior|MovementBehavior|VehicleBehavior|CombatBehavior)\./.test(token)) members.add(token);
      }
      if (row.phase === 'never' || row.exposure === 'excluded' || registry.excluded.has(row.id)) {
        if (registry.enabled(row.id, { mode: 'on', hello: { [row.id]: true }, requested: [row.id], passedProbes: row.probes, source: 'player_ux', priority: 'player_direct' })) throw new Error('enabled:' + row.id);
      }
    }
    for (const id of ['attack', 'aim_at', 'flee_from', 'equip_weapon']) if (registry.enabled(id, { mode: 'on', hello: { [id]: true }, requested: [id], passedProbes: ['Q1'] })) throw new Error('excluded:' + id);
    for (const member of members) {
      const [type, name] = member.includes('NpcActions.') ? ['LosSantosAlive.NPC.NpcActions', member.split('.').pop()] : member.startsWith('FollowBehavior.') ? ['LosSantosAlive.NPC.Behaviors.FollowBehavior', member.split('.').pop()] : member.startsWith('ComplianceBehavior.') ? ['LosSantosAlive.NPC.Behaviors.ComplianceBehavior', member.split('.').pop()] : member.startsWith('MovementBehavior.') ? ['LosSantosAlive.NPC.Behaviors.MovementBehavior', member.split('.').pop()] : member.startsWith('VehicleBehavior.') ? ['LosSantosAlive.NPC.Behaviors.VehicleBehavior', member.split('.').pop()] : member.startsWith('CombatBehavior.') ? ['LosSantosAlive.NPC.Behaviors.CombatBehavior', member.split('.').pop()] : null;
      if (!type || metadata.types.find(item => item.name === type)?.methods.some(item => item.name === name) !== true) throw new Error('member:' + member);
    }
    if (metadata.types.find(item => item.name === 'LosSantosAlive.NPC.NpcActions').methods.some(item => item.name === 'lsawalkto' || item.name === 'lsadriveto')) throw new Error('extension');
    return { available: true, version: 1, dllSha256: DLL, contractSha256: ACTIVITY_CAPABILITIES_SHA256, metadataSha256: metadataSha, dispatch: false };
  } catch { return { available: false, reason: 'activity_contract_unavailable', dispatch: false }; }
}
