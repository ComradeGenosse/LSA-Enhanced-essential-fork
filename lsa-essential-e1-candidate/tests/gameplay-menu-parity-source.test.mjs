import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
test('F11 top-level gameplay sections and browser administration retain distinct paths',async()=>{
  const native=await read('native/enhanced/Ui/NativeMenu.cs');
  const view=await read('native/enhanced/Ui/ViewModels/MenuModels.cs');
  for(const section of ['Current NPC','My Characters','Activities & Navigation','Director & Social','Gameplay Controls','Diagnostics','Settings / Browser Editor'])
    assert.ok(native.includes('"'+section+'"'),section);
  assert.match(native,/Bind\(navigation,"Activities & Navigation"/);
  assert.match(native,/Bind\(director,"Director & Social"/);
  assert.match(native,/Bind\(settingsPage,"Settings \/ Browser Editor"/);
  assert.match(native,/return GameplayNavigationView\.Build\(/);
  assert.match(native,/return DirectorSocialView\.Build\(/);
  assert.match(view,/Banish addon-created NPC/);
  assert.match(view,/Not verified/);
});
test('F11 uses shared dispatch, bounded slots and existing Director runtime endpoints',async()=>{
  const dispatch=await read('native/enhanced/Commands/LoaderDispatcher.cs');
  const model=await read('native/enhanced/Ui/ViewModels/MenuModels.cs');
  const server=await read('lsa-essential-e1-candidate/src/characters/editorServer.mjs');
  const catalog=JSON.parse(await read('contracts/commands.v2.json'));
  assert.ok(catalog.commands.some(c=>c.id==='director.socialManual'&&c.executor==='companion'&&c.gesture===false));
  assert.match(dispatch,/body\["slots"\] = slots/);
  assert.match(dispatch,/DirectorQueued\(body\)/);
  assert.match(dispatch,/MatchesSelection\(npc,args\)/);
  assert.match(model,/ExpectedEncounterId/);
  for(const action of ["'director_social_manual'","'director_social_status'","'activity_menu_readiness'"])
    assert.ok(server.includes(action),action);
  assert.ok(!catalog.commands.some(c=>c.id==='character.delete'),'persistent deletion stays browser-only');
});
