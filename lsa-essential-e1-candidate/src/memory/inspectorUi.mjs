export const inspectorHtml=()=>`<section id="memoryControls"><h2>Memory K runtime controls</h2>
<button id="pauseLearned" type="button">Pause Learned Memory</button>
<button id="resumeLearned" type="button">Allow learned memory after restart</button>
<button id="refreshCapabilities" type="button">Refresh runtime status</button>
<p id="pauseStatus" role="status"></p><details><summary>Capability settings and operational states</summary>
<p>Capability changes are saved for the next companion restart. Dependencies are never activated automatically.</p>
<div id="capabilityRows"></div></details></section>`;
export const inspectorDetailHtml=()=>`<details open><summary>Stored learned memory inspector (P2 SQLite)</summary>
<p>Private local administration. Raw conversations, reported claims, interpretations and witnessed events retain their original evidence labels.</p>
<p id="inspectorScope"></p><select id="inspectorKind" aria-label="Memory category">
<option value="facts">Facts, reported claims and interpretations</option><option value="conversations">Raw conversation history</option>
<option value="npc_dialogue">Raw NPC dialogue</option><option value="events">Event memories</option>
<option value="corrections">Corrections</option><option value="suppressed">Forgotten / recovery history</option></select>
<button id="inspectRefresh" type="button">Load memories</button><button id="inspectPrev" type="button">Previous page</button>
<button id="inspectNext" type="button">Next page</button><button id="inspectExport" type="button">Export selected privately</button>
<p id="inspectorStatus" role="status"></p><div id="inspectorRecords"></div></details>`;
export const inspectorScript=()=>`
let capabilityView=null,inspectorOffset=0,inspectorVersion=0,inspectorView=null,inspectorContext=null;
function inspectorReset(){++inspectorVersion;inspectorView=null;inspectorContext=null;inspectorOffset=0;$('inspectorRecords').replaceChildren();}
async function loadCapabilities(){
  capabilityView=await api('inspector_status');
  $('capabilityRows').replaceChildren();
  for(const row of capabilityView.capabilities){
    const block=document.createElement('div'),label=document.createElement('p'),select=document.createElement('select'),button=document.createElement('button');
    label.textContent=row.id+' · requested '+row.requestedMode+' · running request '+row.runningRequestedMode+
      ' · effective '+(row.effectiveMode??'unknown')+' · '+row.operationalState+(row.restartRequired?' · PENDING RESTART':'')+
      ' · '+(row.reason??'')+' · dependencies: '+row.dependencies.join(', ')+
      (row.missingDependencies.length?' · missing: '+row.missingDependencies.join(', '):'');
    for(const mode of row.modes){const option=document.createElement('option');option.value=option.textContent=mode;select.append(option);}
    select.value=row.requestedMode;select.setAttribute('aria-label',row.id+' requested mode');
    button.textContent='Save for restart';button.onclick=()=>run(async()=>{
      const explicit=capabilityView.explicitConfiguration;
      if(!confirm('Save '+row.id+' = '+select.value+' for the next companion restart?'+
        (explicit?'':' This creates explicit Memory K configuration. Other unspecified optional capabilities will be off.')))return;
      await api('inspector_control',{operation:'capability',id:row.id,mode:select.value,revision:capabilityView.revision,
        confirmation:explicit?null:'use_explicit_capabilities'});await loadCapabilities();
    });
    block.append(label,select,button);
    if(row.blockers.length){const details=document.createElement('details'),summary=document.createElement('summary'),reasons=document.createElement('small');summary.textContent='Policy checks (not operation receipts)';reasons.textContent=row.blockers.join('; ');details.append(summary,reasons);block.append(details);}
    $('capabilityRows').append(block);
  }
  const pause=capabilityView.pause;
  $('pauseStatus').textContent='Learned memory: '+pause.operationalState+' · persisted pause '+pause.requested+
    (pause.restartRequired?' · '+(pause.requested?'pause':'resume')+' pending companion restart':'')+'. Existing data and authenticated privacy administration are preserved.';
  $('pauseLearned').disabled=pause.effective&&pause.requested;
  $('resumeLearned').disabled=!pause.effective&&!pause.requested;
}
function inspectorScope(){return {characterId:current.characterId,worldProfileId:inspectorContext.worldProfileId,
  timelineId:inspectorContext.timelineId,protagonistKey:'unknown'};}
async function loadInspector(){
  if(!current)return;
  const version=++inspectorVersion,characterId=current.characterId;
  $('inspectorRecords').replaceChildren();$('inspectorStatus').textContent='Loading private P2 records…';inspectorView=null;
  try{
    const context=await api('inspector_context');
    if(version!==inspectorVersion||current?.characterId!==characterId)return;
    inspectorContext=context;
    $('inspectorScope').textContent='NPC '+characterId+' · world '+(context.worldProfileId??'unavailable')+' · timeline '+(context.timelineId??'unavailable');
    if(!context.ready){$('inspectorStatus').textContent=context.reason;return;}
    const view=await api('inspector_memory',{operation:'inspect',scope:inspectorScope(),kind:$('inspectorKind').value,offset:inspectorOffset});
    if(version!==inspectorVersion||current?.characterId!==characterId)return;
    inspectorView=view;
    $('inspectorStatus').textContent=(view.items.length?'Records '+(view.offset+1)+'–'+(view.offset+view.items.length):'No stored records in this category.')+' '+view.recallNote;
    $('inspectPrev').disabled=view.offset===0;$('inspectNext').disabled=!view.hasMore;
    for(const item of view.items){
      const block=document.createElement('article'),choice=document.createElement('input'),title=document.createElement('p'),text=document.createElement('p'),details=document.createElement('details'),summary=document.createElement('summary'),raw=document.createElement('pre');
      choice.type='checkbox';choice.value=item.recordId;choice.style.width='auto';choice.setAttribute('aria-label','Select '+item.recordId);
      title.textContent=item.category+' · '+item.atUtc+' · '+item.recall;
      text.textContent=item.content;summary.textContent='Details and provenance';raw.textContent=JSON.stringify(item,null,2);raw.style.whiteSpace='pre-wrap';
      details.append(summary,raw);block.append(choice,title,text,details);
      const mutate=(operation,extra={})=>run(async()=>{
        if(version!==inspectorVersion||current?.characterId!==characterId)throw Error('inspector_selection_changed');
        const target=operation==='restore'?item.trashId:item.recordId;
        if(!confirm(operation==='forget'?'Forget this memory and its linked source/derived bundle? It will be blocked from recall and replay. P2 may retain it privately for seven-day recovery.':
          operation==='restore'?'Restore this complete privacy bundle using the existing P2 recovery checks? Superseded records stay superseded.':
          'Replace the active factual memory with a player-reported correction? The original stays in private history.'))return;
        await api('inspector_memory',{operation,scope:inspectorScope(),recordId:item.recordId,trashId:item.trashId,
          confirmation:target,operationId:crypto.randomUUID(),...extra});await loadInspector();
      });
      if(item.canForget){const b=document.createElement('button');b.textContent='Forget';b.className='danger';b.onclick=()=>mutate('forget');block.append(b);}
      if(item.canCorrect){const b=document.createElement('button');b.textContent='Correct factual memory';b.onclick=()=>{const content=prompt('Corrected factual memory (player-reported):',item.content);if(content?.trim())mutate('correct',{content,expectedHash:item.checksum});};block.append(b);}
      if(item.restoreSupported){const b=document.createElement('button');b.textContent='Request safe P2 restore';b.onclick=()=>mutate('restore');block.append(b);}
      $('inspectorRecords').append(block);
    }
  }catch(e){if(version===inspectorVersion)$('inspectorStatus').textContent=e.message.replaceAll('_',' ');}
}
$('inspectorKind').onchange=()=>{inspectorOffset=0;void loadInspector();};
$('inspectRefresh').onclick=()=>loadInspector();
$('inspectPrev').onclick=()=>{inspectorOffset=Math.max(0,inspectorOffset-50);void loadInspector();};
$('inspectNext').onclick=()=>{if(inspectorView?.hasMore){inspectorOffset+=50;void loadInspector();}};
$('inspectExport').onclick=()=>run(async()=>{
  if(!inspectorView)throw Error('inspector_load_records_first');
  const recordIds=[...$('inspectorRecords').querySelectorAll('input:checked')].map(el=>el.value);
  if(!recordIds.length)throw Error('inspector_select_records_first');
  if(!confirm('Download the selected private memory records? Keep the file private; this export is not a safe live backup restore.'))return;
  const result=await api('inspector_memory',{operation:'export',scope:inspectorScope(),kind:inspectorView.kind,offset:inspectorView.offset,recordIds});
  const url=URL.createObjectURL(new Blob([result.json],{type:'application/json'})),a=document.createElement('a');
  a.href=url;a.download='lsa-private-memories.json';a.click();URL.revokeObjectURL(url);
});
$('refreshCapabilities').onclick=()=>run(loadCapabilities);
$('pauseLearned').onclick=()=>run(async()=>{
  if(!confirm('Pause optional learned-memory activity now and after restart? Active turns will be cancelled. No data is deleted. Resuming requires an explicit companion restart.'))return;
  try{await api('inspector_control',{operation:'pause',paused:true,revision:capabilityView.revision});}finally{await loadCapabilities();}
});
$('resumeLearned').onclick=()=>run(async()=>{
  if(!confirm('Allow configured learned-memory capabilities after the next companion restart? The current process stays paused.'))return;
  await api('inspector_control',{operation:'pause',paused:false,revision:capabilityView.revision});await loadCapabilities();
});
run(loadCapabilities);
`;
