import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { COMMANDS_CONTRACT_SHA256,RNUI_DLL_SHA256,RNUI_ASSEMBLY_VERSION } from '../src/control/nativeSupport.mjs';
import { characterFailureReason } from '../src/characters/characterService.mjs';

const contractUrl = new URL('../../contracts/commands.v2.json',import.meta.url);
const catalogUrl = new URL('../../native/enhanced/Commands/CommandCatalog.cs',import.meta.url);
const exampleUrl = new URL('../../native/enhanced/LSA.Enhanced.example.json',import.meta.url);
const loaderUrl = new URL('../../native/promoted-characters/Loader.csproj',import.meta.url);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('contracts/commands.v2.json has one pinned hash on both sides of the boundary',async () => {
  const bytes = await readFile(contractUrl),source = await readFile(catalogUrl,'utf8');
  const pinned = source.match(/ContractSha256 = "([0-9a-f]{64})"/)?.[1];
  assert.equal(sha256(bytes),COMMANDS_CONTRACT_SHA256,'update COMMANDS_CONTRACT_SHA256 and CommandCatalog.ContractSha256 together');
  assert.equal(pinned,COMMANDS_CONTRACT_SHA256);
  assert.match(source,/ResourceName = "LSA\.Enhanced\.commands\.v2\.json"/);
  assert.match(await readFile(loaderUrl,'utf8'),/<EmbeddedResource Include="\.\.\/\.\.\/contracts\/commands\.v2\.json" LogicalName="LSA\.Enhanced\.commands\.v2\.json" \/>/);
});

test('the command catalog keeps gestures to read, control and ui commands with one executor each',async () => {
  const contract = JSON.parse(await readFile(contractUrl,'utf8'));
  assert.equal(contract.version,2);
  assert.deepEqual(Object.keys(contract.classes).sort(),['control','destructive','lifecycle','profile','read','ui']);
  const ids = contract.commands.map(command => command.id);
  for (const id of ['activity.status','activity.pause','activity.resume','activity.cancel','activity.assign','activity.history']) assert.ok(ids.includes(id),id);
  assert.equal(contract.commands.find(command => command.id === 'activity.assign').class,'lifecycle');
  assert.equal(contract.commands.find(command => command.id === 'activity.pause').gesture,true);
  assert.equal(contract.commands.find(command => command.id === 'activity.cancel').gesture,true);
  assert.equal(contract.commands.find(command => command.id === 'activity.resume').gesture,false);
  assert.equal(new Set(ids).size,ids.length);
  for (const command of contract.commands) {
    assert.match(command.id,/^[a-z]+\.[a-zA-Z]+$/);
    assert.ok(['relay','loader','bridge','companion','ui'].includes(command.executor),command.id);
    assert.ok(['none','current','character'].includes(command.target),command.id);
    assert.ok(command.hud.length > 0 && command.hud.length <= 80,command.id);
    if (command.gesture) assert.ok(['read','control','ui'].includes(command.class),`${command.id} may not be a gesture`);
  }
  for (const id of ['current.dismiss','current.promote','character.summon','character.dismiss','character.despawn','character.rename','character.memorySelect','character.memoryAdd'])
    assert.equal(contract.commands.find(command => command.id === id).gesture,false,`${id} is menu-only`);
  for (const [code,text] of Object.entries(contract.reasons)) { assert.match(code,/^[a-z][a-z0-9_]{0,63}$/); assert.ok(text.length > 0 && text.length <= 80,code); }
});

test('every reason the menu can receive from the companion has fixed HUD text',async () => {
  const { reasons } = JSON.parse(await readFile(contractUrl,'utf8'));
  const companion = ['profile_store_unavailable','identity_unavailable','native_stale','scripted_state','ownership_conflict','evidence_unavailable','owner_unavailable','unsafe_spawn_location',
    'appearance_unavailable','invalid_ped_model','summon_wait_timeout','character_missing','character_not_spawned','character_not_promoted','character_retired','profile_revision_conflict',
    'invalid_profile_edit','invalid_character_profile','memory_missing','memory_not_editable','invalid_memory','invalid_memory_edit','cannot_delete_adopted_ped','session_profile_limit',
    'invalid_capture','profile_store_limit','character_operation_failed','companion_unavailable','capability_disabled','capability_unavailable','no_activity','activity_not_paused','policy_denied','actor_not_owned'];
  for (const code of companion) assert.ok(reasons[code],`missing HUD text for ${code}`);
  // The companion's own failure classifier never produces a code the catalog lacks.
  for (const code of companion) assert.ok(reasons[characterFailureReason(new Error(code))]);
  const runtime = ['no_current_npc','target_changed','input_busy','scripted_state','ask_cooldown','native_stale','queue_full','native_unavailable','native_operation_failed','invalid_target','duplicate_request'];
  for (const code of runtime) assert.ok(reasons[code],`missing HUD text for ${code}`);
});

test('the packaged LSA.Enhanced example binds only gesture commands and keeps input and menu off',async () => {
  const contract = JSON.parse(await readFile(contractUrl,'utf8')),example = JSON.parse(await readFile(exampleUrl,'utf8'));
  assert.equal(example.version,1); assert.equal(example.input.enabled,false); assert.equal(example.ui.enabled,false);
  for (const binding of example.input.bindings) assert.equal(contract.commands.find(command => command.id === binding.command)?.gesture,true,binding.command);
  assert.deepEqual(example.input.keys,{ L4:'F6',R4:'F8',Menu:'F11' });
});

test('RAGENativeUI is a compile-only, hash-pinned reference that is never packaged',async () => {
  assert.match(RNUI_DLL_SHA256,/^[0-9a-f]{64}$/);
  assert.equal(RNUI_ASSEMBLY_VERSION,'1.9.3.0');
  const loader = await readFile(loaderUrl,'utf8');
  assert.match(loader,/<Reference Include="RAGENativeUI"><HintPath>\$\(RnuiReferencePath\)<\/HintPath><Private>false<\/Private><\/Reference>/);
  const builder = await readFile(new URL('../tools/buildCharactersAddon.mjs',import.meta.url),'utf8');
  assert.match(builder,/RNUI_DLL_SHA256/);
  assert.doesNotMatch(builder,/'RAGENativeUI\.dll'/);
  const bridge = await readFile(new URL('../../native/enhanced/Ui/UiBridge.cs',import.meta.url),'utf8');
  assert.match(bridge,/RequiredRnuiVersion = new Version\(1,9,3,0\)/);
  assert.doesNotMatch(bridge,/using RAGENativeUI/,'the bridge never names an RNUI type');
});
