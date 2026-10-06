import http from 'node:http';
import { randomBytes,timingSafeEqual } from 'node:crypto';
import { characterFailureReason } from './characterService.mjs';
import { publishControlEndpoint } from '../control/endpointFile.mjs';
import { describeCurrent } from '../control/currentDescribe.mjs';
import { isUuid } from '../identity/identityContract.mjs';
// Optional native-client expectation of Essential's current NPC (UX phases 2-3).
const expectedEncounter = value => { if (value === undefined || value === null) return null; if (!isUuid(value)) throw new Error('invalid_editor_request'); return value; };

function editorHtml(token, summonWaitMs) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LSA Characters</title>
<style>body{font:16px system-ui;background:#151b24;color:#e4eaf4;max-width:1100px;margin:32px auto;padding:0 20px}button,input,textarea,select{font:inherit;padding:8px;margin:5px 0;border-radius:5px;border:1px solid #596779;background:#202a38;color:inherit}button{cursor:pointer}main{display:grid;grid-template-columns:260px 1fr;gap:24px}label{display:block}input,textarea{box-sizing:border-box;width:100%}textarea{min-height:65px}#list button{display:block;width:100%;text-align:left}.controls{display:flex;gap:8px;flex-wrap:wrap}.danger{border-color:#da6373}#status{white-space:pre-wrap}small{color:#aebcce}@media(max-width:700px){main{display:block}}</style>
<h1>LSA Characters</h1><p>Promote the NPC currently selected in Essential, then keep their character, voice, and memories between game sessions.</p>
<div class="controls"><button id="promote">Promote current NPC</button><button id="refresh">Refresh</button></div><p id="status" role="status"></p>
<main><aside id="list"></aside><section id="detail" hidden><h2 id="title"></h2><small id="identity"></small>
<details><summary>Read-only profile information</summary><pre id="metadata" style="white-space:pre-wrap"></pre></details>
<div class="controls" id="controls"></div><form id="profile"><label>Name<input name="name" maxlength="80" required></label>
<label>Nicknames (one per line)<textarea name="nicknames"></textarea></label><label>Biography<textarea name="biography" maxlength="1200"></textarea></label>
<label>Personality<textarea name="personality" maxlength="1200"></textarea></label><label>Traits (one per line)<textarea name="traits"></textarea></label>
<label>Relationship<select name="relationshipState"><option>associate</option><option>friend</option><option>trusted</option><option>strained</option><option>neutral</option></select></label>
<label>Relationship details<textarea name="relationship" maxlength="600"></textarea></label><label>Player notes<textarea name="playerNotes" maxlength="2400"></textarea></label>
<label>Availability<select name="availability"><option>available</option><option>dead</option><option>retired</option></select></label><button>Save profile</button></form>
<h3>Memories</h3><small>Only memories you select are supplied to dialogue (at most three per turn). No automatic extraction is performed.</small><div id="memories"></div>
<form id="memory"><label>Memory<textarea name="text" maxlength="1200" required></textarea></label><label>Category<select name="category"><option>note</option><option>relationship</option><option>promise</option><option>event</option><option>biography</option><option>other</option></select></label><label>Importance<input name="importance" type="number" min="0" max="100" value="50"></label><label><input name="selected" type="checkbox" style="width:auto"> Supply to dialogue</label><button>Add memory</button><button id="cancelMemory" type="button">Cancel edit</button></form>
<p><button id="remove" class="danger">Unpromote and delete profile</button></p></section></main>
<script>
const auth=${JSON.stringify(token)},summonWaitMs=${Number(summonWaitMs)};let profiles=[],current=null,editingMemory=null,summonPending=false;
const $=id=>document.getElementById(id),status=text=>$('status').textContent=text;
async function api(action,data={}){const response=await fetch('/api',{method:'POST',headers:{'content-type':'application/json','x-lsa-editor':auth},body:JSON.stringify({action,...data})});const result=await response.json();if(!response.ok)throw Error(result.error);return result;}
async function run(job){try{status('Working…');await job();status('Saved.');}catch(error){status(error.message.replaceAll('_',' '));}}
function lines(text){return text.split('\\n').map(value=>value.trim()).filter(Boolean);}
function select(profile){current=profile;editingMemory=null;$('detail').hidden=false;$('title').textContent=profile.name;$('identity').textContent=profile.characterId+' · '+profile.gender+' · '+profile.ageBand+' · '+profile.runtimeStatus+' · voice '+(profile.voiceReference?.voice||'pending');
$('metadata').textContent=JSON.stringify({modelHash:profile.modelHash,appearance:profile.appearance,voiceReference:profile.voiceReference,promotedAtUtc:profile.promotion.promotedAtUtc,createdAtUtc:profile.createdAtUtc,updatedAtUtc:profile.updatedAtUtc,revision:profile.revision},null,2);
const form=$('profile');for(const field of ['name','biography','playerNotes'])form.elements[field].value=profile[field];form.elements.nicknames.value=profile.nicknames.join('\\n');form.elements.personality.value=profile.personality.description;form.elements.traits.value=profile.personality.traits.join('\\n');form.elements.relationshipState.value=profile.relationship.state;form.elements.relationship.value=profile.relationship.description;form.elements.availability.value=profile.status;
$('memories').replaceChildren();for(const memory of profile.memories){const block=document.createElement('div'),content=document.createElement('p');content.textContent=(memory.selectedForContext?'✓ ':'')+memory.category+' · '+memory.importance+' · '+memory.text;block.append(content);for(const action of ['Edit','Remove']){const button=document.createElement('button');button.textContent=action;button.disabled=!memory.editable;button.onclick=()=>action==='Edit'?editMemory(memory):run(async()=>{if(!confirm('Remove this memory?'))return;await api('memory',{characterId:current.characterId,operation:'delete',expectedRevision:current.revision,memoryId:memory.memoryId});await refresh(current.characterId);});block.append(button);}$('memories').append(block);} $('memory').reset();$('memory').querySelector('button').textContent='Add memory';}
async function refresh(id=current?.characterId){profiles=await api('list');$('list').replaceChildren();for(const profile of profiles){const button=document.createElement('button');button.textContent=profile.name+' · '+profile.runtimeStatus;button.onclick=()=>select(profile);$('list').append(button);}const profile=profiles.find(item=>item.characterId===id);if(profile)select(profile);else {$('detail').hidden=true;current=null;}}
function editMemory(memory){editingMemory=memory.memoryId;const form=$('memory');form.elements.text.value=memory.text;form.elements.category.value=memory.category;form.elements.importance.value=memory.importance;form.elements.selected.checked=memory.selectedForContext;form.querySelector('button').textContent='Save memory';form.scrollIntoView({behavior:'smooth'});}
$('promote').onclick=()=>run(async()=>{const profile=await api('promote');await refresh(profile.characterId);});$('refresh').onclick=()=>run(()=>refresh());
for(const operation of ['summon','follow','wait','dismiss','despawn']){const button=document.createElement('button');button.textContent=operation[0].toUpperCase()+operation.slice(1);button.onclick=()=>operation==='summon'?summon(button):run(async()=>{await api('control',{characterId:current.characterId,operation});await refresh(current.characterId);});$('controls').append(button);}
async function summon(button){if(summonPending||!current)return;const characterId=current.characterId;summonPending=true;button.disabled=true;status('Waiting for GTA — return to gameplay to complete summon (up to '+Math.ceil(summonWaitMs/1000)+' seconds).');try{await api('control',{characterId,operation:'summon'});await refresh(characterId);status('Character summoned.');}catch(error){status(error.message==='summon_wait_timeout'?'Summon timed out. Return to gameplay, then try Summon again.':error.message.replaceAll('_',' '));}finally{summonPending=false;button.disabled=false;}}
$('profile').onsubmit=event=>{event.preventDefault();run(async()=>{const f=event.target.elements;await api('edit',{characterId:current.characterId,expectedRevision:current.revision,patch:{name:f.name.value.trim(),nicknames:lines(f.nicknames.value),biography:f.biography.value,personality:{description:f.personality.value,traits:lines(f.traits.value)},relationship:{state:f.relationshipState.value,description:f.relationship.value},playerNotes:f.playerNotes.value,status:f.availability.value}});await refresh();});};
$('memory').onsubmit=event=>{event.preventDefault();run(async()=>{const f=event.target.elements;await api('memory',{characterId:current.characterId,operation:editingMemory?'edit':'create',memoryId:editingMemory,expectedRevision:current.revision,patch:{text:f.text.value,category:f.category.value,importance:Number(f.importance.value),selectedForContext:f.selected.checked}});await refresh();$('memory').querySelector('button').textContent='Add memory';});};
$('cancelMemory').onclick=()=>{editingMemory=null;$('memory').reset();$('memory').querySelector('button').textContent='Add memory';};
$('remove').onclick=()=>run(async()=>{const confirmation=prompt('This permanently deletes the profile and its memories. Type the CharacterId to confirm:', '');if(confirmation!==current.characterId)return;await api('remove',{characterId:current.characterId,confirmation,expectedRevision:current.revision});await refresh();});run(()=>refresh());
</script></html>`;
}
export async function startCharacterEditor(service,{ port = service.config.promotedCharacters.editorPort,endpointPath = null } = {}) {
  const token = randomBytes(32).toString('hex'); let origin;
  const server = http.createServer(async (request,response) => {
    response.setHeader('cache-control','no-store'); response.setHeader('x-content-type-options','nosniff');
    response.setHeader('referrer-policy','no-referrer'); response.setHeader('x-frame-options','DENY');
    response.setHeader('content-security-policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const send = (code,value) => { response.writeHead(code,{'content-type':'application/json; charset=utf-8'}); response.end(JSON.stringify(value)); };
    if (request.headers.host !== new URL(origin).host) return send(403,{error:'invalid_editor_host'});
    if (request.method === 'GET' && request.url === '/') { response.writeHead(200,{'content-type':'text/html; charset=utf-8'}); response.end(editorHtml(token,service.config.promotedCharacters.summonWaitMs)); return; }
    const supplied = request.headers['x-lsa-editor'];
    if (request.method !== 'POST' || request.url !== '/api' || request.headers.origin !== origin || request.headers['content-type'] !== 'application/json' || typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied,'hex'),Buffer.from(token,'hex'))) return send(403,{error:'editor_access_denied'});
    try {
      let bytes = 0; const chunks = [];
      for await (const chunk of request) { bytes += chunk.length; if (bytes > 16384) return send(413,{error:'editor_request_limit'}); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid_editor_request');
      let result;
      switch (body.action) {
        case 'list': result = await service.list(); break;
        case 'promote': result = await service.promote(expectedEncounter(body.expectedEncounterId)); break;
        case 'edit': result = await service.edit(body.characterId,body.patch,body.expectedRevision); break;
        case 'memory': result = await service.memory(body.characterId,body.operation,{memoryId:body.memoryId,patch:body.patch,expectedRevision:body.expectedRevision}); break;
        case 'control': result = await service.control(body.characterId,body.operation); break;
        case 'control_current': result = await service.controlCurrent(body.operation,expectedEncounter(body.expectedEncounterId)); break;
        case 'activity': result = await service.activity(body.operation,{expectedEncounterId:expectedEncounter(body.expectedEncounterId),intent:body.intent,slots:body.slots}); break;
        case 'remove': result = await service.remove(body.characterId,body.confirmation,body.expectedRevision); break;
        case 'current_describe': result = describeCurrent(service,{ encounterId:body.encounterId ?? null,ownerAlias:body.ownerAlias ?? null }); break;
        default: throw new Error('invalid_editor_action');
      }
      send(200,result);
    } catch (error) {
      service.emit('character_safe_failure',{reason:characterFailureReason(error)});
      send(400,{error:/^[a-z][a-z0-9_]{0,63}$/.test(error.message) ? error.message : 'character_operation_failed'});
    }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000; server.maxConnections = 8;
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(port,'127.0.0.1',resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  server.on('error',() => service.emit('character_safe_failure',{reason:'owner_unavailable'})); server.unref();
  // UX phase 1: native clients read the token from a per-user endpoint file
  // instead of scraping this page. Failure leaves the page handshake working.
  let endpoint = null;
  if (endpointPath) try { endpoint = await publishControlEndpoint(endpointPath,{url:origin,token}); } catch {}
  return { url:origin,endpointPublished:endpoint !== null,close:async () => { await endpoint?.close(); await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); } };
}
