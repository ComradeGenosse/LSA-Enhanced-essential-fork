import { normalizeConfig } from '../../lsa-essential-e1-candidate/src/config/e1Config.mjs';
import { MEMORY_K_CAPABILITIES } from '../../lsa-essential-e1-candidate/src/memory/capabilityPolicy.mjs';

export const TARGETS = Object.freeze({
  e1: 'plugins/LosSantosAliveServer/e1.config.json',
  promoted: 'plugins/LSA.PromotedCharacters.json',
  enhanced: 'plugins/LSA.Enhanced.json'
});

export const E1_GROUPS = Object.freeze({
  ai: ['provider','reasoningModel','reasoningEffort','transcriptionModel','maxOutputTokens','providerWorkDeadlineMs','turnDeadlineMs','maxMicDurationMs','maxHistoryMessages','reasoningBaseUrl','transcriptionBaseUrl','ttsBaseUrl','retry','structuredStreamingEnabled','earlyTtsEnabled','streamingMaxOutputTokens','streamingMaxSegments','streamingMaxSegmentChars','streamingMaxDialogueChars','streamingMaxPcmBytes','playbackCompletionGraceMs','playbackCompletionMinMs','playbackCompletionMaxMs'],
  voice: ['speechProvider','elevenLabs','expressiveDelivery','ttsModel','ttsVoice','speechVoices','speechVoiceProfiles','voiceAssignment','ttsSpeed','ttsVolume','actingEnabled'],
  memory: ['persistentIdentity','promotedCharacters','memoryK'],
  perception: ['intelligence','spontaneousSpeech','dialogueKnowledge'],
  npcBehavior: ['activities','reactions'],
  diagnostics: ['dialogueLogging','observabilityEnabled','observabilityMaxFileBytes','observabilityMaxTotalBytes','observabilityMaxFiles']
});
const has = (x,k) => Object.prototype.hasOwnProperty.call(x,k);
const object = x => x && typeof x === 'object' && !Array.isArray(x);
const clone = x => JSON.parse(JSON.stringify(x));
const issue = (code,detail) => ({code,detail});
const secretKey = key => /(?:api[_-]?key|secret|password|credential|access[_-]?token|private[_-]?key|authorization)/i.test(key);
const safeKey = key => !['__proto__','constructor','prototype'].includes(key);
function assertSafeKeys(value,path='
export function removeSecrets(x) {
  if (Array.isArray(x)) return x.map(removeSecrets);
  if (!object(x)) return x;
  return Object.fromEntries(Object.entries(x).filter(([k])=>!secretKey(k)).map(([k,v])=>[k,removeSecrets(v)]));
}
export function assertNoSecrets(value,path='
  for(const [key,item] of Object.entries(value)) {
    if (secretKey(key)) throw new Error('Secret field prohibited in master: '+path+'.'+key);
    assertNoSecrets(item,path+'.'+key);
  }
}
export function importSections(raw) {
  assertSafeKeys(raw);
  const e1=removeSecrets(raw.e1), promoted=removeSecrets(raw.promoted), enhanced=removeSecrets(raw.enhanced);
  const sections={ai:{},voice:{},memory:{native:{}},perception:{companion:{},native:{}},npcBehavior:{companion:{},native:{}},ux:{},controls:{},diagnostics:{},extensions:{e1:{},promoted:{},enhanced:{}}};
  const used=new Set();
  for(const [group,keys] of Object.entries(E1_GROUPS)) for(const key of keys) {
    if(!has(e1,key)) continue;
    if(group==='perception'||group==='npcBehavior') sections[group].companion[key]=clone(e1[key]);
    else sections[group][key]=clone(e1[key]);
    used.add(key);
  }
  for(const [key,value] of Object.entries(e1)) if(!used.has(key)) sections.extensions.e1[key]=clone(value);
  for(const key of ['enabled','worldProfileId','pipeName','identityPipeName','editorPort','memoryK']) {
    if(has(promoted,key)) {sections.memory.native[key]=clone(promoted[key]);}
  }
  for(const key of ['intelligence']) if(has(promoted,key)) sections.perception.native[key]=clone(promoted[key]);
  for(const key of ['activities','reactions','npcVoicePresence']) if(has(promoted,key)) sections.npcBehavior.native[key]=clone(promoted[key]);
  for(const key of ['version','input','quickCommands','talkTargeting','ui','feedback']) {
    if(!has(enhanced,key)) continue;
    const group=key==='input'?'controls':key==='version'?'extensions':key==='quickCommands'||key==='talkTargeting'||key==='ui'||key==='feedback'?'ux':null;
    if(group==='extensions') sections.extensions.enhanced[key]=clone(enhanced[key]);
    else sections[group][key]=clone(enhanced[key]);
  }
  for(const [key,value] of Object.entries(promoted)) if(!['enabled','worldProfileId','pipeName','identityPipeName','editorPort','memoryK','intelligence','activities','reactions','npcVoicePresence'].includes(key)) sections.extensions.promoted[key]=clone(value);
  for(const [key,value] of Object.entries(enhanced)) if(!['version','input','quickCommands','talkTargeting','ui','feedback'].includes(key)) sections.extensions.enhanced[key]=clone(value);
  return sections;
}
export function generate(master,original) {
  const s=master.sections;
  if(!object(s)) throw new Error('Missing master.sections');
  const result=clone(original);
  const present=(obj,key)=>obj&&has(obj,key);
  for(const [group,keys] of Object.entries(E1_GROUPS)) for(const key of keys) {
    const source=group==='perception'||group==='npcBehavior'?s[group]?.companion:s[group];
    if(present(source,key)) result.e1[key]=clone(source[key]);
  }
  for(const [key,value] of Object.entries(s.extensions?.e1||{})) result.e1[key]=clone(value);
  for(const key of ['enabled','worldProfileId','pipeName','identityPipeName','editorPort','memoryK']) if(present(s.memory?.native,key)) result.promoted[key]=clone(s.memory.native[key]);
  for(const key of ['intelligence']) if(present(s.perception?.native,key)) result.promoted[key]=clone(s.perception.native[key]);
  for(const key of ['activities','reactions','npcVoicePresence']) if(present(s.npcBehavior?.native,key)) result.promoted[key]=clone(s.npcBehavior.native[key]);
  for(const key of ['input']) if(present(s.controls,key)) result.enhanced[key]=clone(s.controls[key]);
  for(const key of ['quickCommands','talkTargeting','ui','feedback']) if(present(s.ux,key)) result.enhanced[key]=clone(s.ux[key]);
  for(const name of ['promoted','enhanced']) for(const [key,value] of Object.entries(s.extensions?.[name]||{})) result[name][key]=clone(value);
  return result;
}
function physical(name) {
  if(typeof name==='number'&&Number.isInteger(name)&&name>0&&name<255) return name;
  if(typeof name!=='string') return null;
  if(/^\d+$/.test(name)) return +name;
  const x=name.trim().toUpperCase(), aliases={XBUTTON1:'MOUSE4',XBUTTON2:'MOUSE5',LBUTTON:'MOUSE1',RBUTTON:'MOUSE2',MBUTTON:'MOUSE3',RETURN:'ENTER'};
  const key=aliases[x]||x;
  if(/^F([1-9]|1\d|2[0-4])$/.test(key)) return 0x6f+Number(key.slice(1));
  if(/^[A-Z]$/.test(key)) return key.charCodeAt(0);
  if(/^(D?[0-9])$/.test(key)) return key.charCodeAt(key.length-1);
  const mouse={MOUSE1:1,MOUSE2:2,MOUSE3:4,MOUSE4:5,MOUSE5:6};
  if(has(mouse,key)) return mouse[key];
  const extra={INSERT:45,DELETE:46,HOME:36,END:35,PAGEUP:33,PAGEDOWN:34,UP:38,DOWN:40,LEFT:37,RIGHT:39,PAUSE:19,SCROLLLOCK:145,CAPSLOCK:20,BACK:8,ESCAPE:27,ENTER:13,TAB:9,SPACE:32,MULTIPLY:106,ADD:107,SUBTRACT:109,DECIMAL:110,DIVIDE:111,LSHIFTKEY:160,RSHIFTKEY:161,LCONTROLKEY:162,RCONTROLKEY:163,LMENU:164,RMENU:165};
  if(has(extra,key)) return extra[key];
  if(/^NUMPAD[0-9]$/.test(key)) return 96+Number(key.slice(-1));
  return null;
}
export function essentialBindings(text) {
  if(typeof text!=='string') return null;
  const result={};
  for(const line of text.split(/\r?\n/)) {
    const m=/^\s*(TalkKey|TextKey|MarkPedKey|MarkedPedTalkKey)\s*=\s*([^#;\s]+)\s*$/i.exec(line);
    if(m) result[(['TalkKey','TextKey','MarkPedKey','MarkedPedTalkKey'].find(x=>x.toLowerCase()===m[1].toLowerCase()))]=/^(none)$/i.test(m[2])?null:physical(m[2]);
  }
  return result;
}
function checkEnhanced(e,problems) {
  if(e.version!==1) problems.push(issue('ENHANCED_SCHEMA','version must be 1'));
  const allowed=['version','input','quickCommands','talkTargeting','ui','feedback'];
  for(const k of Object.keys(e)) if(!allowed.includes(k)) problems.push(issue('ENHANCED_SCHEMA','Unsupported root key '+k));
  const i=e.input||{},talk=e.talkTargeting||{},ui=e.ui||{},feedback=e.feedback||{},quick=e.quickCommands||{};
  if(!object(i)||!object(talk)||!object(ui)||!object(feedback)||!object(quick)) {problems.push(issue('ENHANCED_SCHEMA','sections must be objects'));return;}
  const only=(obj,allowed,label)=>{for(const key of Object.keys(obj)) if(!allowed.includes(key)) problems.push(issue('ENHANCED_SCHEMA','Unknown '+label+'.'+key));};
  only(i,['enabled','keys','timing','bindings'],'input');
  only(talk,['enabled','key','talkHoldMs','cycleWindowMs','selectionTimeoutMs','radiusMeters','retentionRadiusMeters','maxCandidates','indicator'],'talkTargeting');
  only(ui,['enabled'],'ui');
  only(feedback,['hud'],'feedback');
  only(quick,['ordinaryNpc','phrases'],'quickCommands');
  if(has(quick,'ordinaryNpc')&&!['ask','off'].includes(quick.ordinaryNpc)) problems.push(issue('ENHANCED_SCHEMA','quickCommands.ordinaryNpc must be ask or off'));
  if(has(quick,'phrases')) {
    if(!object(quick.phrases)) problems.push(issue('ENHANCED_SCHEMA','quickCommands.phrases must be an object'));
    else {only(quick.phrases,['follow','wait','dismiss'],'quickCommands.phrases');for(const [k,v] of Object.entries(quick.phrases)) if(typeof v!=='string'||v.length>120||(k!=='dismiss'&&!v.trim())||/[\x00-\x1f\x7f]/.test(v)) problems.push(issue('ENHANCED_SCHEMA','Invalid phrase '+k));}
  }
  const keys=i.keys||{L4:'F6',R4:'F8',Menu:'F11'},used=new Set();
  if(!object(keys)||Object.keys(keys).length<1||Object.keys(keys).length>8) problems.push(issue('ENHANCED_SCHEMA','input.keys must contain 1–8 keys'));
  else for(const [logical,p] of Object.entries(keys)) {
    const vk=physical(p);
    if(!/^[a-z][a-z0-9]{0,15}$/i.test(logical)||vk===null||[115,118,123,27,13,9,32,1,2,4].includes(vk)) problems.push(issue('ENHANCED_SCHEMA','Invalid/reserved input.keys.'+logical));
    if(used.has(vk)) problems.push(issue('ROUTER_DUPLICATE','Duplicate physical router key '+p));
    used.add(vk);
  }
  const bool=(obj,k)=>{if(has(obj,k)&&typeof obj[k]!=='boolean') problems.push(issue('ENHANCED_SCHEMA',k+' must be boolean'));};
  bool(i,'enabled');bool(talk,'enabled');bool(talk,'indicator');bool(ui,'enabled');
  if(talk.enabled && !talk.key) problems.push(issue('ENHANCED_SCHEMA','talkTargeting.key is required'));
  if(talk.key && physical(talk.key)===null) problems.push(issue('ENHANCED_SCHEMA','Invalid talkTargeting.key'));
  if(!['notification','subtitle','off'].includes(feedback.hud||'notification')) problems.push(issue('ENHANCED_SCHEMA','Invalid feedback.hud'));
  if(talk.enabled && used.has(physical(talk.key))) problems.push(issue('UX4_ROUTER_COLLISION','UX4 talk key is also a router input key'));
  const timing=i.timing||{};if(!object(timing)) problems.push(issue('ENHANCED_SCHEMA','Invalid input.timing'));
  else only(timing,['chordWindowMs','holdMs','doubleTapMs','relayPulseMs','commandCooldownMs'],'input.timing');
  const ranges={talkHoldMs:[120,500],cycleWindowMs:[500,3000],selectionTimeoutMs:[2000,30000],radiusMeters:[3,30],maxCandidates:[1,16]};
  for(const [k,range] of Object.entries(ranges)) if(has(talk,k)&&(!Number.isFinite(talk[k])||talk[k]<range[0]||talk[k]>range[1])) problems.push(issue('ENHANCED_SCHEMA','talkTargeting.'+k+' out of range'));
  if(talk.retentionRadiusMeters!==undefined&&(talk.retentionRadiusMeters<(talk.radiusMeters||15)||talk.retentionRadiusMeters>50)) problems.push(issue('ENHANCED_SCHEMA','Invalid talkTargeting.retentionRadiusMeters'));
  for(const [k,range] of Object.entries({chordWindowMs:[40,250],holdMs:[300,3000],doubleTapMs:[100,500],relayPulseMs:[30,200],commandCooldownMs:[250,3000]})) if(has(timing,k)&&(!Number.isSafeInteger(timing[k])||timing[k]<range[0]||timing[k]>range[1])) problems.push(issue('ENHANCED_SCHEMA','input.timing.'+k+' out of range'));
  if((timing.holdMs||600)<(timing.chordWindowMs||120)+100) problems.push(issue('ENHANCED_SCHEMA','holdMs too short for chordWindowMs'));
  if(Array.isArray(i.bindings)) {
    if(i.bindings.length>16) problems.push(issue('ENHANCED_SCHEMA','Too many input bindings'));
    const ids=new Set(),gestures=new Set();
    for(const b of i.bindings) {
      if(!object(b)||!['tap','chord','hold','chordHold','doubleTap'].includes(b.gesture)||!Array.isArray(b.keys)||b.keys.length!==(['chord','chordHold'].includes(b.gesture)?2:1)||b.keys.some(k=>!has(keys,k))) problems.push(issue('ENHANCED_SCHEMA','Invalid input.bindings entry'));
      else {
        only(b,['id','gesture','keys','command'],'input.bindings');
        if(typeof b.id!=='string'||!/^[a-z][a-zA-Z0-9_]{0,31}$/.test(b.id)) problems.push(issue('ENHANCED_SCHEMA','Invalid gesture id'));
        if(typeof b.command!=='string'||!b.command.includes('.')) problems.push(issue('ENHANCED_SCHEMA','Invalid gesture command'));
        if(ids.has(b.id)) problems.push(issue('ENHANCED_SCHEMA','Duplicate binding id '+b.id));
        ids.add(b.id);
        const sig=b.gesture+':'+[...b.keys].sort().join(',');
        if(gestures.has(sig)) problems.push(issue('ENHANCED_SCHEMA','Duplicate gesture '+sig));
        gestures.add(sig);
      }
    }
  } else if(has(i,'bindings')) problems.push(issue('ENHANCED_SCHEMA','input.bindings must be array'));
  if(Buffer.byteLength(JSON.stringify(e),'utf8')>16384) problems.push(issue('ENHANCED_SCHEMA','Enhanced settings exceed native 16 KiB limit'));
}
export function validateConfigs(raw,master,essentialText) {
  const problems=[],warnings=[];
  assertNoSecrets(master);
  try { normalizeConfig(raw.e1,{}); }catch(e) { problems.push(issue('E1_SCHEMA',e.message)); }
  checkEnhanced(raw.enhanced,problems);
  const p=raw.promoted,e=raw.e1,n=raw.enhanced;
  for(const k of ['enabled']) if(has(p,k)&&typeof p[k]!=='boolean') problems.push(issue('NATIVE_SCHEMA','promoted.'+k+' must be boolean'));
  if(p.editorPort!==undefined&&(!Number.isSafeInteger(p.editorPort)||p.editorPort<1024||p.editorPort>65535)) problems.push(issue('NATIVE_SCHEMA','Invalid editorPort'));
  for(const k of ['pipeName','identityPipeName']) if(has(p,k)&&(typeof p[k]!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(p[k]))) problems.push(issue('NATIVE_SCHEMA','Invalid '+k));
  if(p.enabled===true&&!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p.worldProfileId||'')) problems.push(issue('NATIVE_SCHEMA','Invalid/missing native worldProfileId'));
  for(const [group,sub] of [['intelligence',p.intelligence||{}],['activities',p.activities||{}],['reactions',p.reactions||{}]]) {
    if(!['off','shadow',...(group==='activities'||group==='reactions'?['on']:[])].includes(sub.mode||'off')) problems.push(issue('INVALID_MODE','native '+group+'.mode unsupported'));
  }
  for(const group of ['intelligence','activities','reactions']) {
    const sub=e[group]||{};
    if(!['off','shadow',...(group==='activities'||group==='reactions'?['on']:[])].includes(sub.mode||'off')) problems.push(issue('INVALID_MODE','companion '+group+'.mode unsupported'));
    if(sub.pipeName!==undefined&&(typeof sub.pipeName!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(sub.pipeName))) problems.push(issue('INVALID_PIPE','companion '+group+' pipe invalid'));
  }
  if(!['off','shadow'].includes(e.intelligence?.radio||'off')) problems.push(issue('INVALID_MODE','companion intelligence.radio unsupported'));
  if(!['off','shadow','experimental'].includes(p.intelligence?.directorMode||'off')) problems.push(issue('INVALID_MODE','native directorMode unsupported'));
  if(!['normal','testing'].includes(p.intelligence?.directorAttemptPreset||'normal')) problems.push(issue('INVALID_MODE','native directorAttemptPreset unsupported'));
  if(!['off','shadow'].includes(p.intelligence?.radio||'off')) problems.push(issue('INVALID_MODE','native radio unsupported'));
  if((p.intelligence?.directorMode||'off')!=='off'&&(p.intelligence?.mode||'off')!=='shadow') problems.push(issue('FEATURE_DEPENDENCY','Native Director requires shadow intelligence'));
  if(p.intelligence?.directorAttemptPreset==='testing'&&p.intelligence?.directorMode!=='experimental') problems.push(issue('FEATURE_DEPENDENCY','Testing preset requires native experimental director'));
  if(e.intelligence?.radio&&p.intelligence?.radio&&e.intelligence.radio!==p.intelligence.radio) problems.push(issue('FEATURE_MISMATCH','Radio perception mode differs'));
  if(e.activities?.dialogueReceipts!==undefined&&p.activities?.dialogueReceipts!==undefined&&e.activities.dialogueReceipts!==p.activities.dialogueReceipts) problems.push(issue('FEATURE_MISMATCH','Activity dialogueReceipts differs'));
  if(typeof p.npcVoicePresence?.mouthEnabled==='boolean'&&p.npcVoicePresence.mouthEnabled&&(p.npcVoicePresence.mode||'off')!=='on') problems.push(issue('FEATURE_DEPENDENCY','Mouth animation needs native voice presence on'));
  if(!['off','shadow','on'].includes(p.npcVoicePresence?.mode||'off')) problems.push(issue('INVALID_MODE','npcVoicePresence.mode unsupported'));
  for(const group of ['intelligence','activities','reactions']) {
    const a=e[group]||{},b=p[group]||{};
    if(a.pipeName&&b.pipeName&&a.pipeName!==b.pipeName) problems.push(issue('PIPE_MISMATCH',group+' pipe differs between E1/native'));
    if((a.mode||'off')!==(b.mode||'off')) problems.push(issue('FEATURE_MISMATCH',group+' mode differs between E1/native'));
  }
  if(e.promotedCharacters?.pipeName&&p.pipeName&&e.promotedCharacters.pipeName!==p.pipeName) problems.push(issue('PIPE_MISMATCH','promoted character pipe differs'));
  if(e.persistentIdentity?.pipeName&&p.identityPipeName&&e.persistentIdentity.pipeName!==p.identityPipeName) problems.push(issue('PIPE_MISMATCH','identity pipe differs'));
  if(e.persistentIdentity?.worldProfileId&&p.worldProfileId&&e.persistentIdentity.worldProfileId!==p.worldProfileId) problems.push(issue('WORLD_MISMATCH','worldProfileId differs'));
  if(e.promotedCharacters?.editorPort&&p.editorPort&&e.promotedCharacters.editorPort!==p.editorPort) problems.push(issue('EDITOR_MISMATCH','editorPort differs'));
  if(e.promotedCharacters?.enabled!==undefined&&p.enabled!==undefined&&e.promotedCharacters.enabled!==p.enabled) problems.push(issue('FEATURE_MISMATCH','promotedCharacters enabled differs'));
  if(e.spontaneousSpeech?.mode!=='off'&&e.spontaneousSpeech?.mode!==undefined&&p.intelligence?.directorMode!=='experimental') problems.push(issue('FEATURE_MISMATCH','Spontaneous speech requires native experimental director'));
  if((p.reactions?.mode||'off')!=='off'&&!p.enabled) problems.push(issue('FEATURE_DEPENDENCY','Native reactions require promoted host enabled'));
  if((p.activities?.mode||'off')!=='off'&&!p.enabled) problems.push(issue('FEATURE_DEPENDENCY','Native activities require promoted host enabled'));
  const capabilityModes=e.memoryK?.capabilities||{};
  for(const d of MEMORY_K_CAPABILITIES) {
    const mode=capabilityModes[d.id]||'off';
    if(mode!=='off'&&d.support==='absent') problems.push(issue('UNIMPLEMENTED_FEATURE',d.id+' has no production implementation'));
    if(mode==='on') for(const dep of d.dependencies) if(has(capabilityModes,dep)&&capabilityModes[dep]==='off') problems.push(issue('FEATURE_DEPENDENCY',d.id+' requires '+dep));
  }
  const essential=essentialBindings(essentialText);
  const talk=n.talkTargeting||{},input=n.input||{};
  if(input.enabled||talk.enabled) {
    if(!essential) problems.push(issue('ESSENTIAL_BINDINGS_UNAVAILABLE','Essential controls file required when input or UX4 is active'));
    else if(Object.values(essential).some(x=>x===undefined)) problems.push(issue('ESSENTIAL_BINDINGS_INCOMPLETE','Essential key bindings are incomplete'));
    if(essential) {
      for(const [name,key] of Object.entries(input.keys||{L4:'F6',R4:'F8',Menu:'F11'})) if(input.enabled) for(const [setting,vk] of Object.entries(essential)) if(vk!==null&&vk===physical(key)) problems.push(issue('ROUTER_ESSENTIAL_COLLISION',name+' '+key+' conflicts with Essential '+setting));
      if(talk.enabled) {
        const vk=physical(talk.key);
        for(const setting of ['TextKey','MarkPedKey','MarkedPedTalkKey']) if(vk!==null&&vk===essential[setting]) problems.push(issue('UX4_ESSENTIAL_COLLISION',talk.key+' conflicts with Essential '+setting));
        if(vk!==essential.TalkKey && master.approvals?.neutralTalkKey!==talk.key) problems.push(issue('UX4_NEUTRAL_BINDING_UNCONFIRMED','UX4 '+talk.key+' differs from Essential Talk '+(essential.TalkKey===5?'Mouse4':essential.TalkKey===6?'Mouse5':'VK'+essential.TalkKey)+'; approve neutral mode only after verifying Steam Input'));
      }
    }
  }
  if(raw.e1.speechProvider==='elevenlabs'&&!(raw.e1.elevenLabs?.voices&&Object.keys(raw.e1.elevenLabs.voices).length)) problems.push(issue('VOICE_DEPENDENCY','ElevenLabs selected without mapped voices'));
  for(const name of ['e1','promoted','enhanced']) if(JSON.stringify(raw[name]).length===0) problems.push(issue('EMPTY_CONFIG','Empty '+name));
  return {ok:problems.length===0,problems,warnings,restartRequired:['e1','promoted']};
}) {
  if(!object(value)&&!Array.isArray(value)) return;
  for(const [k,v] of Object.entries(value)) {
    if(!safeKey(k)) throw new Error('Unsafe key '+path+'.'+k);
    assertSafeKeys(v,path+'.'+k);
  }
}
export function removeSecrets(x) {
  if (Array.isArray(x)) return x.map(removeSecrets);
  if (!object(x)) return x;
  return Object.fromEntries(Object.entries(x).filter(([k])=>!secretKey(k)).map(([k,v])=>[k,removeSecrets(v)]));
}
export function assertNoSecrets(value,path='$') {
  if (!object(value) && !Array.isArray(value)) return;
  for(const [key,item] of Object.entries(value)) {
    if (secretKey(key)) throw new Error('Secret field prohibited in master: '+path+'.'+key);
    assertNoSecrets(item,path+'.'+key);
  }
}
export function importSections(raw) {
  const e1=removeSecrets(raw.e1), promoted=removeSecrets(raw.promoted), enhanced=removeSecrets(raw.enhanced);
  const sections={ai:{},voice:{},memory:{native:{}},perception:{companion:{},native:{}},npcBehavior:{companion:{},native:{}},ux:{},controls:{},diagnostics:{},extensions:{e1:{},promoted:{},enhanced:{}}};
  const used=new Set();
  for(const [group,keys] of Object.entries(E1_GROUPS)) for(const key of keys) {
    if(!has(e1,key)) continue;
    if(group==='perception'||group==='npcBehavior') sections[group].companion[key]=clone(e1[key]);
    else sections[group][key]=clone(e1[key]);
    used.add(key);
  }
  for(const [key,value] of Object.entries(e1)) if(!used.has(key)) sections.extensions.e1[key]=clone(value);
  for(const key of ['enabled','worldProfileId','pipeName','identityPipeName','editorPort','memoryK']) {
    if(has(promoted,key)) {sections.memory.native[key]=clone(promoted[key]);}
  }
  for(const key of ['intelligence']) if(has(promoted,key)) sections.perception.native[key]=clone(promoted[key]);
  for(const key of ['activities','reactions','npcVoicePresence']) if(has(promoted,key)) sections.npcBehavior.native[key]=clone(promoted[key]);
  for(const key of ['version','input','quickCommands','talkTargeting','ui','feedback']) {
    if(!has(enhanced,key)) continue;
    const group=key==='input'?'controls':key==='version'?'extensions':key==='quickCommands'||key==='talkTargeting'||key==='ui'||key==='feedback'?'ux':null;
    if(group==='extensions') sections.extensions.enhanced[key]=clone(enhanced[key]);
    else sections[group][key]=clone(enhanced[key]);
  }
  for(const [key,value] of Object.entries(promoted)) if(!['enabled','worldProfileId','pipeName','identityPipeName','editorPort','memoryK','intelligence','activities','reactions','npcVoicePresence'].includes(key)) sections.extensions.promoted[key]=clone(value);
  for(const [key,value] of Object.entries(enhanced)) if(!['version','input','quickCommands','talkTargeting','ui','feedback'].includes(key)) sections.extensions.enhanced[key]=clone(value);
  return sections;
}
export function generate(master,original) {
  const s=master.sections;
  if(!object(s)) throw new Error('Missing master.sections');
  const result=clone(original);
  const present=(obj,key)=>obj&&has(obj,key);
  for(const [group,keys] of Object.entries(E1_GROUPS)) for(const key of keys) {
    const source=group==='perception'||group==='npcBehavior'?s[group]?.companion:s[group];
    if(present(source,key)) result.e1[key]=clone(source[key]);
  }
  for(const [key,value] of Object.entries(s.extensions?.e1||{})) result.e1[key]=clone(value);
  for(const key of ['enabled','worldProfileId','pipeName','identityPipeName','editorPort','memoryK']) if(present(s.memory?.native,key)) result.promoted[key]=clone(s.memory.native[key]);
  for(const key of ['intelligence']) if(present(s.perception?.native,key)) result.promoted[key]=clone(s.perception.native[key]);
  for(const key of ['activities','reactions','npcVoicePresence']) if(present(s.npcBehavior?.native,key)) result.promoted[key]=clone(s.npcBehavior.native[key]);
  for(const key of ['input']) if(present(s.controls,key)) result.enhanced[key]=clone(s.controls[key]);
  for(const key of ['quickCommands','talkTargeting','ui','feedback']) if(present(s.ux,key)) result.enhanced[key]=clone(s.ux[key]);
  for(const name of ['promoted','enhanced']) for(const [key,value] of Object.entries(s.extensions?.[name]||{})) result[name][key]=clone(value);
  return result;
}
function physical(name) {
  if(typeof name==='number'&&Number.isInteger(name)&&name>0&&name<255) return name;
  if(typeof name!=='string') return null;
  if(/^\d+$/.test(name)) return +name;
  const x=name.trim().toUpperCase(), aliases={XBUTTON1:'MOUSE4',XBUTTON2:'MOUSE5',LBUTTON:'MOUSE1',RBUTTON:'MOUSE2',MBUTTON:'MOUSE3',RETURN:'ENTER'};
  const key=aliases[x]||x;
  if(/^F([1-9]|1\d|2[0-4])$/.test(key)) return 0x6f+Number(key.slice(1));
  if(/^[A-Z]$/.test(key)) return key.charCodeAt(0);
  if(/^(D?[0-9])$/.test(key)) return key.charCodeAt(key.length-1);
  const mouse={MOUSE1:1,MOUSE2:2,MOUSE3:4,MOUSE4:5,MOUSE5:6};
  if(has(mouse,key)) return mouse[key];
  const extra={INSERT:45,DELETE:46,HOME:36,END:35,PAGEUP:33,PAGEDOWN:34,UP:38,DOWN:40,LEFT:37,RIGHT:39,PAUSE:19,SCROLLLOCK:145,CAPSLOCK:20,BACK:8,ESCAPE:27,ENTER:13,TAB:9,SPACE:32};
  if(has(extra,key)) return extra[key];
  if(/^NUMPAD[0-9]$/.test(key)) return 96+Number(key.slice(-1));
  return null;
}
export function essentialBindings(text) {
  if(typeof text!=='string') return null;
  const result={};
  for(const line of text.split(/\r?\n/)) {
    const m=/^\s*(TalkKey|TextKey|MarkPedKey|MarkedPedTalkKey)\s*=\s*([^#;\s]+)\s*$/i.exec(line);
    if(m) result[(['TalkKey','TextKey','MarkPedKey','MarkedPedTalkKey'].find(x=>x.toLowerCase()===m[1].toLowerCase()))]=/^(none)$/i.test(m[2])?null:physical(m[2]);
  }
  return result;
}
function checkEnhanced(e,problems) {
  if(e.version!==1) problems.push(issue('ENHANCED_SCHEMA','version must be 1'));
  const allowed=['version','input','quickCommands','talkTargeting','ui','feedback'];
  for(const k of Object.keys(e)) if(!allowed.includes(k)) problems.push(issue('ENHANCED_SCHEMA','Unsupported root key '+k));
  const i=e.input||{},talk=e.talkTargeting||{},ui=e.ui||{},feedback=e.feedback||{};
  if(!object(i)||!object(talk)||!object(ui)||!object(feedback)) {problems.push(issue('ENHANCED_SCHEMA','sections must be objects'));return;}
  const keys=i.keys||{L4:'F6',R4:'F8',Menu:'F11'},used=new Set();
  if(!object(keys)||Object.keys(keys).length<1||Object.keys(keys).length>8) problems.push(issue('ENHANCED_SCHEMA','input.keys must contain 1–8 keys'));
  else for(const [logical,p] of Object.entries(keys)) {
    const vk=physical(p);
    if(!/^[a-z][a-z0-9]{0,15}$/i.test(logical)||vk===null||[115,118,123,27,13,9,32,1,2,4].includes(vk)) problems.push(issue('ENHANCED_SCHEMA','Invalid/reserved input.keys.'+logical));
    if(used.has(vk)) problems.push(issue('ROUTER_DUPLICATE','Duplicate physical router key '+p));
    used.add(vk);
  }
  const bool=(obj,k)=>{if(has(obj,k)&&typeof obj[k]!=='boolean') problems.push(issue('ENHANCED_SCHEMA',k+' must be boolean'));};
  bool(i,'enabled');bool(talk,'enabled');bool(talk,'indicator');bool(ui,'enabled');
  if(talk.enabled && !talk.key) problems.push(issue('ENHANCED_SCHEMA','talkTargeting.key is required'));
  if(talk.key && physical(talk.key)===null) problems.push(issue('ENHANCED_SCHEMA','Invalid talkTargeting.key'));
  if(!['notification','subtitle','off'].includes(feedback.hud||'notification')) problems.push(issue('ENHANCED_SCHEMA','Invalid feedback.hud'));
  if(talk.enabled && used.has(physical(talk.key))) problems.push(issue('UX4_ROUTER_COLLISION','UX4 talk key is also a router input key'));
  const timing=i.timing||{};if(!object(timing)) problems.push(issue('ENHANCED_SCHEMA','Invalid input.timing'));
  const ranges={talkHoldMs:[120,500],cycleWindowMs:[500,3000],selectionTimeoutMs:[2000,30000],radiusMeters:[3,30],maxCandidates:[1,16]};
  for(const [k,range] of Object.entries(ranges)) if(has(talk,k)&&(!Number.isFinite(talk[k])||talk[k]<range[0]||talk[k]>range[1])) problems.push(issue('ENHANCED_SCHEMA','talkTargeting.'+k+' out of range'));
  if(talk.retentionRadiusMeters!==undefined&&(talk.retentionRadiusMeters<(talk.radiusMeters||15)||talk.retentionRadiusMeters>50)) problems.push(issue('ENHANCED_SCHEMA','Invalid talkTargeting.retentionRadiusMeters'));
  for(const [k,range] of Object.entries({chordWindowMs:[40,250],holdMs:[300,3000],doubleTapMs:[100,500],relayPulseMs:[30,200],commandCooldownMs:[250,3000]})) if(has(timing,k)&&(!Number.isSafeInteger(timing[k])||timing[k]<range[0]||timing[k]>range[1])) problems.push(issue('ENHANCED_SCHEMA','input.timing.'+k+' out of range'));
  if((timing.holdMs||600)<(timing.chordWindowMs||120)+100) problems.push(issue('ENHANCED_SCHEMA','holdMs too short for chordWindowMs'));
  if(Array.isArray(i.bindings)) {
    const ids=new Set(),gestures=new Set();
    for(const b of i.bindings) {
      if(!object(b)||!['tap','chord','hold','chordHold','doubleTap'].includes(b.gesture)||!Array.isArray(b.keys)||b.keys.length!==(['chord','chordHold'].includes(b.gesture)?2:1)||b.keys.some(k=>!has(keys,k))) problems.push(issue('ENHANCED_SCHEMA','Invalid input.bindings entry'));
      else {
        if(ids.has(b.id)) problems.push(issue('ENHANCED_SCHEMA','Duplicate binding id '+b.id));
        ids.add(b.id);
        const sig=b.gesture+':'+[...b.keys].sort().join(',');
        if(gestures.has(sig)) problems.push(issue('ENHANCED_SCHEMA','Duplicate gesture '+sig));
        gestures.add(sig);
      }
    }
  } else if(has(i,'bindings')) problems.push(issue('ENHANCED_SCHEMA','input.bindings must be array'));
  if(Buffer.byteLength(JSON.stringify(e),'utf8')>16384) problems.push(issue('ENHANCED_SCHEMA','Enhanced settings exceed native 16 KiB limit'));
}
export function validateConfigs(raw,master,essentialText) {
  const problems=[],warnings=[];
  assertNoSecrets(master);
  try { normalizeConfig(raw.e1,{}); }catch(e) { problems.push(issue('E1_SCHEMA',e.message)); }
  checkEnhanced(raw.enhanced,problems);
  const p=raw.promoted,e=raw.e1,n=raw.enhanced;
  for(const k of ['enabled']) if(has(p,k)&&typeof p[k]!=='boolean') problems.push(issue('NATIVE_SCHEMA','promoted.'+k+' must be boolean'));
  if(p.editorPort!==undefined&&(!Number.isSafeInteger(p.editorPort)||p.editorPort<1024||p.editorPort>65535)) problems.push(issue('NATIVE_SCHEMA','Invalid editorPort'));
  for(const k of ['pipeName','identityPipeName']) if(has(p,k)&&(typeof p[k]!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(p[k]))) problems.push(issue('NATIVE_SCHEMA','Invalid '+k));
  if(p.enabled===true&&!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p.worldProfileId||'')) problems.push(issue('NATIVE_SCHEMA','Invalid/missing native worldProfileId'));
  for(const [group,sub] of [['intelligence',p.intelligence||{}],['activities',p.activities||{}],['reactions',p.reactions||{}]]) {
    if(!['off','shadow',...(group==='activities'||group==='reactions'?['on']:[])].includes(sub.mode||'off')) problems.push(issue('INVALID_MODE','native '+group+'.mode unsupported'));
  }
  if(!['off','shadow','experimental'].includes(p.intelligence?.directorMode||'off')) problems.push(issue('INVALID_MODE','native directorMode unsupported'));
  if(!['off','shadow','on'].includes(p.npcVoicePresence?.mode||'off')) problems.push(issue('INVALID_MODE','npcVoicePresence.mode unsupported'));
  for(const group of ['intelligence','activities','reactions']) {
    const a=e[group]||{},b=p[group]||{};
    if(a.pipeName&&b.pipeName&&a.pipeName!==b.pipeName) problems.push(issue('PIPE_MISMATCH',group+' pipe differs between E1/native'));
    if((a.mode||'off')!==(b.mode||'off')) problems.push(issue('FEATURE_MISMATCH',group+' mode differs between E1/native'));
  }
  if(e.promotedCharacters?.pipeName&&p.pipeName&&e.promotedCharacters.pipeName!==p.pipeName) problems.push(issue('PIPE_MISMATCH','promoted character pipe differs'));
  if(e.persistentIdentity?.pipeName&&p.identityPipeName&&e.persistentIdentity.pipeName!==p.identityPipeName) problems.push(issue('PIPE_MISMATCH','identity pipe differs'));
  if(e.persistentIdentity?.worldProfileId&&p.worldProfileId&&e.persistentIdentity.worldProfileId!==p.worldProfileId) problems.push(issue('WORLD_MISMATCH','worldProfileId differs'));
  if(e.promotedCharacters?.editorPort&&p.editorPort&&e.promotedCharacters.editorPort!==p.editorPort) problems.push(issue('EDITOR_MISMATCH','editorPort differs'));
  if(e.promotedCharacters?.enabled!==undefined&&p.enabled!==undefined&&e.promotedCharacters.enabled!==p.enabled) problems.push(issue('FEATURE_MISMATCH','promotedCharacters enabled differs'));
  if(e.spontaneousSpeech?.mode!=='off'&&e.spontaneousSpeech?.mode!==undefined&&p.intelligence?.directorMode!=='experimental') problems.push(issue('FEATURE_MISMATCH','Spontaneous speech requires native experimental director'));
  if((p.reactions?.mode||'off')!=='off'&&!p.enabled) problems.push(issue('FEATURE_DEPENDENCY','Native reactions require promoted host enabled'));
  if((p.activities?.mode||'off')!=='off'&&!p.enabled) problems.push(issue('FEATURE_DEPENDENCY','Native activities require promoted host enabled'));
  const capabilityModes=e.memoryK?.capabilities||{};
  for(const d of MEMORY_K_CAPABILITIES) {
    const mode=capabilityModes[d.id]||'off';
    if(mode!=='off'&&d.support==='absent') problems.push(issue('UNIMPLEMENTED_FEATURE',d.id+' has no production implementation'));
    if(mode==='on') for(const dep of d.dependencies) if(has(capabilityModes,dep)&&capabilityModes[dep]==='off') problems.push(issue('FEATURE_DEPENDENCY',d.id+' requires '+dep));
  }
  const essential=essentialBindings(essentialText);
  const talk=n.talkTargeting||{},input=n.input||{};
  if(input.enabled||talk.enabled) {
    if(!essential) problems.push(issue('ESSENTIAL_BINDINGS_UNAVAILABLE','Essential controls file required when input or UX4 is active'));
    else if(Object.values(essential).some(x=>x===undefined)) problems.push(issue('ESSENTIAL_BINDINGS_INCOMPLETE','Essential key bindings are incomplete'));
    if(essential) {
      for(const [name,key] of Object.entries(input.keys||{L4:'F6',R4:'F8',Menu:'F11'})) if(input.enabled) for(const [setting,vk] of Object.entries(essential)) if(vk!==null&&vk===physical(key)) problems.push(issue('ROUTER_ESSENTIAL_COLLISION',name+' '+key+' conflicts with Essential '+setting));
      if(talk.enabled) {
        const vk=physical(talk.key);
        for(const setting of ['TextKey','MarkPedKey','MarkedPedTalkKey']) if(vk!==null&&vk===essential[setting]) problems.push(issue('UX4_ESSENTIAL_COLLISION',talk.key+' conflicts with Essential '+setting));
        if(vk!==essential.TalkKey && master.approvals?.neutralTalkKey!==talk.key) problems.push(issue('UX4_NEUTRAL_BINDING_UNCONFIRMED','UX4 '+talk.key+' differs from Essential Talk '+(Object.keys(essential).find(x=>x==='TalkKey')||'Unknown')+'; approve neutral mode only after verifying Steam Input'));
      }
    }
  }
  if(raw.e1.speechProvider==='elevenlabs'&&!(raw.e1.elevenLabs?.voices&&Object.keys(raw.e1.elevenLabs.voices).length)) problems.push(issue('VOICE_DEPENDENCY','ElevenLabs selected without mapped voices'));
  for(const name of ['e1','promoted','enhanced']) if(JSON.stringify(raw[name]).length===0) problems.push(issue('EMPTY_CONFIG','Empty '+name));
  return {ok:problems.length===0,problems,warnings,restartRequired:['e1','promoted']};
}) {
  if(path==='
  for(const [key,item] of Object.entries(value)) {
    if (secretKey(key)) throw new Error('Secret field prohibited in master: '+path+'.'+key);
    assertNoSecrets(item,path+'.'+key);
  }
}
export function importSections(raw) {
  assertSafeKeys(raw);
  const e1=removeSecrets(raw.e1), promoted=removeSecrets(raw.promoted), enhanced=removeSecrets(raw.enhanced);
  const sections={ai:{},voice:{},memory:{native:{}},perception:{companion:{},native:{}},npcBehavior:{companion:{},native:{}},ux:{},controls:{},diagnostics:{},extensions:{e1:{},promoted:{},enhanced:{}}};
  const used=new Set();
  for(const [group,keys] of Object.entries(E1_GROUPS)) for(const key of keys) {
    if(!has(e1,key)) continue;
    if(group==='perception'||group==='npcBehavior') sections[group].companion[key]=clone(e1[key]);
    else sections[group][key]=clone(e1[key]);
    used.add(key);
  }
  for(const [key,value] of Object.entries(e1)) if(!used.has(key)) sections.extensions.e1[key]=clone(value);
  for(const key of ['enabled','worldProfileId','pipeName','identityPipeName','editorPort','memoryK']) {
    if(has(promoted,key)) {sections.memory.native[key]=clone(promoted[key]);}
  }
  for(const key of ['intelligence']) if(has(promoted,key)) sections.perception.native[key]=clone(promoted[key]);
  for(const key of ['activities','reactions','npcVoicePresence']) if(has(promoted,key)) sections.npcBehavior.native[key]=clone(promoted[key]);
  for(const key of ['version','input','quickCommands','talkTargeting','ui','feedback']) {
    if(!has(enhanced,key)) continue;
    const group=key==='input'?'controls':key==='version'?'extensions':key==='quickCommands'||key==='talkTargeting'||key==='ui'||key==='feedback'?'ux':null;
    if(group==='extensions') sections.extensions.enhanced[key]=clone(enhanced[key]);
    else sections[group][key]=clone(enhanced[key]);
  }
  for(const [key,value] of Object.entries(promoted)) if(!['enabled','worldProfileId','pipeName','identityPipeName','editorPort','memoryK','intelligence','activities','reactions','npcVoicePresence'].includes(key)) sections.extensions.promoted[key]=clone(value);
  for(const [key,value] of Object.entries(enhanced)) if(!['version','input','quickCommands','talkTargeting','ui','feedback'].includes(key)) sections.extensions.enhanced[key]=clone(value);
  return sections;
}
export function generate(master,original) {
  const s=master.sections;
  if(!object(s)) throw new Error('Missing master.sections');
  const result=clone(original);
  const present=(obj,key)=>obj&&has(obj,key);
  for(const [group,keys] of Object.entries(E1_GROUPS)) for(const key of keys) {
    const source=group==='perception'||group==='npcBehavior'?s[group]?.companion:s[group];
    if(present(source,key)) result.e1[key]=clone(source[key]);
  }
  for(const [key,value] of Object.entries(s.extensions?.e1||{})) result.e1[key]=clone(value);
  for(const key of ['enabled','worldProfileId','pipeName','identityPipeName','editorPort','memoryK']) if(present(s.memory?.native,key)) result.promoted[key]=clone(s.memory.native[key]);
  for(const key of ['intelligence']) if(present(s.perception?.native,key)) result.promoted[key]=clone(s.perception.native[key]);
  for(const key of ['activities','reactions','npcVoicePresence']) if(present(s.npcBehavior?.native,key)) result.promoted[key]=clone(s.npcBehavior.native[key]);
  for(const key of ['input']) if(present(s.controls,key)) result.enhanced[key]=clone(s.controls[key]);
  for(const key of ['quickCommands','talkTargeting','ui','feedback']) if(present(s.ux,key)) result.enhanced[key]=clone(s.ux[key]);
  for(const name of ['promoted','enhanced']) for(const [key,value] of Object.entries(s.extensions?.[name]||{})) result[name][key]=clone(value);
  return result;
}
function physical(name) {
  if(typeof name==='number'&&Number.isInteger(name)&&name>0&&name<255) return name;
  if(typeof name!=='string') return null;
  if(/^\d+$/.test(name)) return +name;
  const x=name.trim().toUpperCase(), aliases={XBUTTON1:'MOUSE4',XBUTTON2:'MOUSE5',LBUTTON:'MOUSE1',RBUTTON:'MOUSE2',MBUTTON:'MOUSE3',RETURN:'ENTER'};
  const key=aliases[x]||x;
  if(/^F([1-9]|1\d|2[0-4])$/.test(key)) return 0x6f+Number(key.slice(1));
  if(/^[A-Z]$/.test(key)) return key.charCodeAt(0);
  if(/^(D?[0-9])$/.test(key)) return key.charCodeAt(key.length-1);
  const mouse={MOUSE1:1,MOUSE2:2,MOUSE3:4,MOUSE4:5,MOUSE5:6};
  if(has(mouse,key)) return mouse[key];
  const extra={INSERT:45,DELETE:46,HOME:36,END:35,PAGEUP:33,PAGEDOWN:34,UP:38,DOWN:40,LEFT:37,RIGHT:39,PAUSE:19,SCROLLLOCK:145,CAPSLOCK:20,BACK:8,ESCAPE:27,ENTER:13,TAB:9,SPACE:32};
  if(has(extra,key)) return extra[key];
  if(/^NUMPAD[0-9]$/.test(key)) return 96+Number(key.slice(-1));
  return null;
}
export function essentialBindings(text) {
  if(typeof text!=='string') return null;
  const result={};
  for(const line of text.split(/\r?\n/)) {
    const m=/^\s*(TalkKey|TextKey|MarkPedKey|MarkedPedTalkKey)\s*=\s*([^#;\s]+)\s*$/i.exec(line);
    if(m) result[(['TalkKey','TextKey','MarkPedKey','MarkedPedTalkKey'].find(x=>x.toLowerCase()===m[1].toLowerCase()))]=/^(none)$/i.test(m[2])?null:physical(m[2]);
  }
  return result;
}
function checkEnhanced(e,problems) {
  if(e.version!==1) problems.push(issue('ENHANCED_SCHEMA','version must be 1'));
  const allowed=['version','input','quickCommands','talkTargeting','ui','feedback'];
  for(const k of Object.keys(e)) if(!allowed.includes(k)) problems.push(issue('ENHANCED_SCHEMA','Unsupported root key '+k));
  const i=e.input||{},talk=e.talkTargeting||{},ui=e.ui||{},feedback=e.feedback||{};
  if(!object(i)||!object(talk)||!object(ui)||!object(feedback)) {problems.push(issue('ENHANCED_SCHEMA','sections must be objects'));return;}
  const keys=i.keys||{L4:'F6',R4:'F8',Menu:'F11'},used=new Set();
  if(!object(keys)||Object.keys(keys).length<1||Object.keys(keys).length>8) problems.push(issue('ENHANCED_SCHEMA','input.keys must contain 1–8 keys'));
  else for(const [logical,p] of Object.entries(keys)) {
    const vk=physical(p);
    if(!/^[a-z][a-z0-9]{0,15}$/i.test(logical)||vk===null||[115,118,123,27,13,9,32,1,2,4].includes(vk)) problems.push(issue('ENHANCED_SCHEMA','Invalid/reserved input.keys.'+logical));
    if(used.has(vk)) problems.push(issue('ROUTER_DUPLICATE','Duplicate physical router key '+p));
    used.add(vk);
  }
  const bool=(obj,k)=>{if(has(obj,k)&&typeof obj[k]!=='boolean') problems.push(issue('ENHANCED_SCHEMA',k+' must be boolean'));};
  bool(i,'enabled');bool(talk,'enabled');bool(talk,'indicator');bool(ui,'enabled');
  if(talk.enabled && !talk.key) problems.push(issue('ENHANCED_SCHEMA','talkTargeting.key is required'));
  if(talk.key && physical(talk.key)===null) problems.push(issue('ENHANCED_SCHEMA','Invalid talkTargeting.key'));
  if(!['notification','subtitle','off'].includes(feedback.hud||'notification')) problems.push(issue('ENHANCED_SCHEMA','Invalid feedback.hud'));
  if(talk.enabled && used.has(physical(talk.key))) problems.push(issue('UX4_ROUTER_COLLISION','UX4 talk key is also a router input key'));
  const timing=i.timing||{};if(!object(timing)) problems.push(issue('ENHANCED_SCHEMA','Invalid input.timing'));
  const ranges={talkHoldMs:[120,500],cycleWindowMs:[500,3000],selectionTimeoutMs:[2000,30000],radiusMeters:[3,30],maxCandidates:[1,16]};
  for(const [k,range] of Object.entries(ranges)) if(has(talk,k)&&(!Number.isFinite(talk[k])||talk[k]<range[0]||talk[k]>range[1])) problems.push(issue('ENHANCED_SCHEMA','talkTargeting.'+k+' out of range'));
  if(talk.retentionRadiusMeters!==undefined&&(talk.retentionRadiusMeters<(talk.radiusMeters||15)||talk.retentionRadiusMeters>50)) problems.push(issue('ENHANCED_SCHEMA','Invalid talkTargeting.retentionRadiusMeters'));
  for(const [k,range] of Object.entries({chordWindowMs:[40,250],holdMs:[300,3000],doubleTapMs:[100,500],relayPulseMs:[30,200],commandCooldownMs:[250,3000]})) if(has(timing,k)&&(!Number.isSafeInteger(timing[k])||timing[k]<range[0]||timing[k]>range[1])) problems.push(issue('ENHANCED_SCHEMA','input.timing.'+k+' out of range'));
  if((timing.holdMs||600)<(timing.chordWindowMs||120)+100) problems.push(issue('ENHANCED_SCHEMA','holdMs too short for chordWindowMs'));
  if(Array.isArray(i.bindings)) {
    const ids=new Set(),gestures=new Set();
    for(const b of i.bindings) {
      if(!object(b)||!['tap','chord','hold','chordHold','doubleTap'].includes(b.gesture)||!Array.isArray(b.keys)||b.keys.length!==(['chord','chordHold'].includes(b.gesture)?2:1)||b.keys.some(k=>!has(keys,k))) problems.push(issue('ENHANCED_SCHEMA','Invalid input.bindings entry'));
      else {
        if(ids.has(b.id)) problems.push(issue('ENHANCED_SCHEMA','Duplicate binding id '+b.id));
        ids.add(b.id);
        const sig=b.gesture+':'+[...b.keys].sort().join(',');
        if(gestures.has(sig)) problems.push(issue('ENHANCED_SCHEMA','Duplicate gesture '+sig));
        gestures.add(sig);
      }
    }
  } else if(has(i,'bindings')) problems.push(issue('ENHANCED_SCHEMA','input.bindings must be array'));
  if(Buffer.byteLength(JSON.stringify(e),'utf8')>16384) problems.push(issue('ENHANCED_SCHEMA','Enhanced settings exceed native 16 KiB limit'));
}
export function validateConfigs(raw,master,essentialText) {
  const problems=[],warnings=[];
  assertNoSecrets(master);
  try { normalizeConfig(raw.e1,{}); }catch(e) { problems.push(issue('E1_SCHEMA',e.message)); }
  checkEnhanced(raw.enhanced,problems);
  const p=raw.promoted,e=raw.e1,n=raw.enhanced;
  for(const k of ['enabled']) if(has(p,k)&&typeof p[k]!=='boolean') problems.push(issue('NATIVE_SCHEMA','promoted.'+k+' must be boolean'));
  if(p.editorPort!==undefined&&(!Number.isSafeInteger(p.editorPort)||p.editorPort<1024||p.editorPort>65535)) problems.push(issue('NATIVE_SCHEMA','Invalid editorPort'));
  for(const k of ['pipeName','identityPipeName']) if(has(p,k)&&(typeof p[k]!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(p[k]))) problems.push(issue('NATIVE_SCHEMA','Invalid '+k));
  if(p.enabled===true&&!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p.worldProfileId||'')) problems.push(issue('NATIVE_SCHEMA','Invalid/missing native worldProfileId'));
  for(const [group,sub] of [['intelligence',p.intelligence||{}],['activities',p.activities||{}],['reactions',p.reactions||{}]]) {
    if(!['off','shadow',...(group==='activities'||group==='reactions'?['on']:[])].includes(sub.mode||'off')) problems.push(issue('INVALID_MODE','native '+group+'.mode unsupported'));
  }
  if(!['off','shadow','experimental'].includes(p.intelligence?.directorMode||'off')) problems.push(issue('INVALID_MODE','native directorMode unsupported'));
  if(!['off','shadow','on'].includes(p.npcVoicePresence?.mode||'off')) problems.push(issue('INVALID_MODE','npcVoicePresence.mode unsupported'));
  for(const group of ['intelligence','activities','reactions']) {
    const a=e[group]||{},b=p[group]||{};
    if(a.pipeName&&b.pipeName&&a.pipeName!==b.pipeName) problems.push(issue('PIPE_MISMATCH',group+' pipe differs between E1/native'));
    if((a.mode||'off')!==(b.mode||'off')) problems.push(issue('FEATURE_MISMATCH',group+' mode differs between E1/native'));
  }
  if(e.promotedCharacters?.pipeName&&p.pipeName&&e.promotedCharacters.pipeName!==p.pipeName) problems.push(issue('PIPE_MISMATCH','promoted character pipe differs'));
  if(e.persistentIdentity?.pipeName&&p.identityPipeName&&e.persistentIdentity.pipeName!==p.identityPipeName) problems.push(issue('PIPE_MISMATCH','identity pipe differs'));
  if(e.persistentIdentity?.worldProfileId&&p.worldProfileId&&e.persistentIdentity.worldProfileId!==p.worldProfileId) problems.push(issue('WORLD_MISMATCH','worldProfileId differs'));
  if(e.promotedCharacters?.editorPort&&p.editorPort&&e.promotedCharacters.editorPort!==p.editorPort) problems.push(issue('EDITOR_MISMATCH','editorPort differs'));
  if(e.promotedCharacters?.enabled!==undefined&&p.enabled!==undefined&&e.promotedCharacters.enabled!==p.enabled) problems.push(issue('FEATURE_MISMATCH','promotedCharacters enabled differs'));
  if(e.spontaneousSpeech?.mode!=='off'&&e.spontaneousSpeech?.mode!==undefined&&p.intelligence?.directorMode!=='experimental') problems.push(issue('FEATURE_MISMATCH','Spontaneous speech requires native experimental director'));
  if((p.reactions?.mode||'off')!=='off'&&!p.enabled) problems.push(issue('FEATURE_DEPENDENCY','Native reactions require promoted host enabled'));
  if((p.activities?.mode||'off')!=='off'&&!p.enabled) problems.push(issue('FEATURE_DEPENDENCY','Native activities require promoted host enabled'));
  const capabilityModes=e.memoryK?.capabilities||{};
  for(const d of MEMORY_K_CAPABILITIES) {
    const mode=capabilityModes[d.id]||'off';
    if(mode!=='off'&&d.support==='absent') problems.push(issue('UNIMPLEMENTED_FEATURE',d.id+' has no production implementation'));
    if(mode==='on') for(const dep of d.dependencies) if(has(capabilityModes,dep)&&capabilityModes[dep]==='off') problems.push(issue('FEATURE_DEPENDENCY',d.id+' requires '+dep));
  }
  const essential=essentialBindings(essentialText);
  const talk=n.talkTargeting||{},input=n.input||{};
  if(input.enabled||talk.enabled) {
    if(!essential) problems.push(issue('ESSENTIAL_BINDINGS_UNAVAILABLE','Essential controls file required when input or UX4 is active'));
    else if(Object.values(essential).some(x=>x===undefined)) problems.push(issue('ESSENTIAL_BINDINGS_INCOMPLETE','Essential key bindings are incomplete'));
    if(essential) {
      for(const [name,key] of Object.entries(input.keys||{L4:'F6',R4:'F8',Menu:'F11'})) if(input.enabled) for(const [setting,vk] of Object.entries(essential)) if(vk!==null&&vk===physical(key)) problems.push(issue('ROUTER_ESSENTIAL_COLLISION',name+' '+key+' conflicts with Essential '+setting));
      if(talk.enabled) {
        const vk=physical(talk.key);
        for(const setting of ['TextKey','MarkPedKey','MarkedPedTalkKey']) if(vk!==null&&vk===essential[setting]) problems.push(issue('UX4_ESSENTIAL_COLLISION',talk.key+' conflicts with Essential '+setting));
        if(vk!==essential.TalkKey && master.approvals?.neutralTalkKey!==talk.key) problems.push(issue('UX4_NEUTRAL_BINDING_UNCONFIRMED','UX4 '+talk.key+' differs from Essential Talk '+(Object.keys(essential).find(x=>x==='TalkKey')||'Unknown')+'; approve neutral mode only after verifying Steam Input'));
      }
    }
  }
  if(raw.e1.speechProvider==='elevenlabs'&&!(raw.e1.elevenLabs?.voices&&Object.keys(raw.e1.elevenLabs.voices).length)) problems.push(issue('VOICE_DEPENDENCY','ElevenLabs selected without mapped voices'));
  for(const name of ['e1','promoted','enhanced']) if(JSON.stringify(raw[name]).length===0) problems.push(issue('EMPTY_CONFIG','Empty '+name));
  return {ok:problems.length===0,problems,warnings,restartRequired:['e1','promoted']};
}) {
  if(!object(value)&&!Array.isArray(value)) return;
  for(const [k,v] of Object.entries(value)) {
    if(!safeKey(k)) throw new Error('Unsafe key '+path+'.'+k);
    assertSafeKeys(v,path+'.'+k);
  }
}
export function removeSecrets(x) {
  if (Array.isArray(x)) return x.map(removeSecrets);
  if (!object(x)) return x;
  return Object.fromEntries(Object.entries(x).filter(([k])=>!secretKey(k)).map(([k,v])=>[k,removeSecrets(v)]));
}
export function assertNoSecrets(value,path='$') {
  if (!object(value) && !Array.isArray(value)) return;
  for(const [key,item] of Object.entries(value)) {
    if (secretKey(key)) throw new Error('Secret field prohibited in master: '+path+'.'+key);
    assertNoSecrets(item,path+'.'+key);
  }
}
export function importSections(raw) {
  const e1=removeSecrets(raw.e1), promoted=removeSecrets(raw.promoted), enhanced=removeSecrets(raw.enhanced);
  const sections={ai:{},voice:{},memory:{native:{}},perception:{companion:{},native:{}},npcBehavior:{companion:{},native:{}},ux:{},controls:{},diagnostics:{},extensions:{e1:{},promoted:{},enhanced:{}}};
  const used=new Set();
  for(const [group,keys] of Object.entries(E1_GROUPS)) for(const key of keys) {
    if(!has(e1,key)) continue;
    if(group==='perception'||group==='npcBehavior') sections[group].companion[key]=clone(e1[key]);
    else sections[group][key]=clone(e1[key]);
    used.add(key);
  }
  for(const [key,value] of Object.entries(e1)) if(!used.has(key)) sections.extensions.e1[key]=clone(value);
  for(const key of ['enabled','worldProfileId','pipeName','identityPipeName','editorPort','memoryK']) {
    if(has(promoted,key)) {sections.memory.native[key]=clone(promoted[key]);}
  }
  for(const key of ['intelligence']) if(has(promoted,key)) sections.perception.native[key]=clone(promoted[key]);
  for(const key of ['activities','reactions','npcVoicePresence']) if(has(promoted,key)) sections.npcBehavior.native[key]=clone(promoted[key]);
  for(const key of ['version','input','quickCommands','talkTargeting','ui','feedback']) {
    if(!has(enhanced,key)) continue;
    const group=key==='input'?'controls':key==='version'?'extensions':key==='quickCommands'||key==='talkTargeting'||key==='ui'||key==='feedback'?'ux':null;
    if(group==='extensions') sections.extensions.enhanced[key]=clone(enhanced[key]);
    else sections[group][key]=clone(enhanced[key]);
  }
  for(const [key,value] of Object.entries(promoted)) if(!['enabled','worldProfileId','pipeName','identityPipeName','editorPort','memoryK','intelligence','activities','reactions','npcVoicePresence'].includes(key)) sections.extensions.promoted[key]=clone(value);
  for(const [key,value] of Object.entries(enhanced)) if(!['version','input','quickCommands','talkTargeting','ui','feedback'].includes(key)) sections.extensions.enhanced[key]=clone(value);
  return sections;
}
export function generate(master,original) {
  const s=master.sections;
  if(!object(s)) throw new Error('Missing master.sections');
  const result=clone(original);
  const present=(obj,key)=>obj&&has(obj,key);
  for(const [group,keys] of Object.entries(E1_GROUPS)) for(const key of keys) {
    const source=group==='perception'||group==='npcBehavior'?s[group]?.companion:s[group];
    if(present(source,key)) result.e1[key]=clone(source[key]);
  }
  for(const [key,value] of Object.entries(s.extensions?.e1||{})) result.e1[key]=clone(value);
  for(const key of ['enabled','worldProfileId','pipeName','identityPipeName','editorPort','memoryK']) if(present(s.memory?.native,key)) result.promoted[key]=clone(s.memory.native[key]);
  for(const key of ['intelligence']) if(present(s.perception?.native,key)) result.promoted[key]=clone(s.perception.native[key]);
  for(const key of ['activities','reactions','npcVoicePresence']) if(present(s.npcBehavior?.native,key)) result.promoted[key]=clone(s.npcBehavior.native[key]);
  for(const key of ['input']) if(present(s.controls,key)) result.enhanced[key]=clone(s.controls[key]);
  for(const key of ['quickCommands','talkTargeting','ui','feedback']) if(present(s.ux,key)) result.enhanced[key]=clone(s.ux[key]);
  for(const name of ['promoted','enhanced']) for(const [key,value] of Object.entries(s.extensions?.[name]||{})) result[name][key]=clone(value);
  return result;
}
function physical(name) {
  if(typeof name==='number'&&Number.isInteger(name)&&name>0&&name<255) return name;
  if(typeof name!=='string') return null;
  if(/^\d+$/.test(name)) return +name;
  const x=name.trim().toUpperCase(), aliases={XBUTTON1:'MOUSE4',XBUTTON2:'MOUSE5',LBUTTON:'MOUSE1',RBUTTON:'MOUSE2',MBUTTON:'MOUSE3',RETURN:'ENTER'};
  const key=aliases[x]||x;
  if(/^F([1-9]|1\d|2[0-4])$/.test(key)) return 0x6f+Number(key.slice(1));
  if(/^[A-Z]$/.test(key)) return key.charCodeAt(0);
  if(/^(D?[0-9])$/.test(key)) return key.charCodeAt(key.length-1);
  const mouse={MOUSE1:1,MOUSE2:2,MOUSE3:4,MOUSE4:5,MOUSE5:6};
  if(has(mouse,key)) return mouse[key];
  const extra={INSERT:45,DELETE:46,HOME:36,END:35,PAGEUP:33,PAGEDOWN:34,UP:38,DOWN:40,LEFT:37,RIGHT:39,PAUSE:19,SCROLLLOCK:145,CAPSLOCK:20,BACK:8,ESCAPE:27,ENTER:13,TAB:9,SPACE:32};
  if(has(extra,key)) return extra[key];
  if(/^NUMPAD[0-9]$/.test(key)) return 96+Number(key.slice(-1));
  return null;
}
export function essentialBindings(text) {
  if(typeof text!=='string') return null;
  const result={};
  for(const line of text.split(/\r?\n/)) {
    const m=/^\s*(TalkKey|TextKey|MarkPedKey|MarkedPedTalkKey)\s*=\s*([^#;\s]+)\s*$/i.exec(line);
    if(m) result[(['TalkKey','TextKey','MarkPedKey','MarkedPedTalkKey'].find(x=>x.toLowerCase()===m[1].toLowerCase()))]=/^(none)$/i.test(m[2])?null:physical(m[2]);
  }
  return result;
}
function checkEnhanced(e,problems) {
  if(e.version!==1) problems.push(issue('ENHANCED_SCHEMA','version must be 1'));
  const allowed=['version','input','quickCommands','talkTargeting','ui','feedback'];
  for(const k of Object.keys(e)) if(!allowed.includes(k)) problems.push(issue('ENHANCED_SCHEMA','Unsupported root key '+k));
  const i=e.input||{},talk=e.talkTargeting||{},ui=e.ui||{},feedback=e.feedback||{};
  if(!object(i)||!object(talk)||!object(ui)||!object(feedback)) {problems.push(issue('ENHANCED_SCHEMA','sections must be objects'));return;}
  const keys=i.keys||{L4:'F6',R4:'F8',Menu:'F11'},used=new Set();
  if(!object(keys)||Object.keys(keys).length<1||Object.keys(keys).length>8) problems.push(issue('ENHANCED_SCHEMA','input.keys must contain 1–8 keys'));
  else for(const [logical,p] of Object.entries(keys)) {
    const vk=physical(p);
    if(!/^[a-z][a-z0-9]{0,15}$/i.test(logical)||vk===null||[115,118,123,27,13,9,32,1,2,4].includes(vk)) problems.push(issue('ENHANCED_SCHEMA','Invalid/reserved input.keys.'+logical));
    if(used.has(vk)) problems.push(issue('ROUTER_DUPLICATE','Duplicate physical router key '+p));
    used.add(vk);
  }
  const bool=(obj,k)=>{if(has(obj,k)&&typeof obj[k]!=='boolean') problems.push(issue('ENHANCED_SCHEMA',k+' must be boolean'));};
  bool(i,'enabled');bool(talk,'enabled');bool(talk,'indicator');bool(ui,'enabled');
  if(talk.enabled && !talk.key) problems.push(issue('ENHANCED_SCHEMA','talkTargeting.key is required'));
  if(talk.key && physical(talk.key)===null) problems.push(issue('ENHANCED_SCHEMA','Invalid talkTargeting.key'));
  if(!['notification','subtitle','off'].includes(feedback.hud||'notification')) problems.push(issue('ENHANCED_SCHEMA','Invalid feedback.hud'));
  if(talk.enabled && used.has(physical(talk.key))) problems.push(issue('UX4_ROUTER_COLLISION','UX4 talk key is also a router input key'));
  const timing=i.timing||{};if(!object(timing)) problems.push(issue('ENHANCED_SCHEMA','Invalid input.timing'));
  const ranges={talkHoldMs:[120,500],cycleWindowMs:[500,3000],selectionTimeoutMs:[2000,30000],radiusMeters:[3,30],maxCandidates:[1,16]};
  for(const [k,range] of Object.entries(ranges)) if(has(talk,k)&&(!Number.isFinite(talk[k])||talk[k]<range[0]||talk[k]>range[1])) problems.push(issue('ENHANCED_SCHEMA','talkTargeting.'+k+' out of range'));
  if(talk.retentionRadiusMeters!==undefined&&(talk.retentionRadiusMeters<(talk.radiusMeters||15)||talk.retentionRadiusMeters>50)) problems.push(issue('ENHANCED_SCHEMA','Invalid talkTargeting.retentionRadiusMeters'));
  for(const [k,range] of Object.entries({chordWindowMs:[40,250],holdMs:[300,3000],doubleTapMs:[100,500],relayPulseMs:[30,200],commandCooldownMs:[250,3000]})) if(has(timing,k)&&(!Number.isSafeInteger(timing[k])||timing[k]<range[0]||timing[k]>range[1])) problems.push(issue('ENHANCED_SCHEMA','input.timing.'+k+' out of range'));
  if((timing.holdMs||600)<(timing.chordWindowMs||120)+100) problems.push(issue('ENHANCED_SCHEMA','holdMs too short for chordWindowMs'));
  if(Array.isArray(i.bindings)) {
    const ids=new Set(),gestures=new Set();
    for(const b of i.bindings) {
      if(!object(b)||!['tap','chord','hold','chordHold','doubleTap'].includes(b.gesture)||!Array.isArray(b.keys)||b.keys.length!==(['chord','chordHold'].includes(b.gesture)?2:1)||b.keys.some(k=>!has(keys,k))) problems.push(issue('ENHANCED_SCHEMA','Invalid input.bindings entry'));
      else {
        if(ids.has(b.id)) problems.push(issue('ENHANCED_SCHEMA','Duplicate binding id '+b.id));
        ids.add(b.id);
        const sig=b.gesture+':'+[...b.keys].sort().join(',');
        if(gestures.has(sig)) problems.push(issue('ENHANCED_SCHEMA','Duplicate gesture '+sig));
        gestures.add(sig);
      }
    }
  } else if(has(i,'bindings')) problems.push(issue('ENHANCED_SCHEMA','input.bindings must be array'));
  if(Buffer.byteLength(JSON.stringify(e),'utf8')>16384) problems.push(issue('ENHANCED_SCHEMA','Enhanced settings exceed native 16 KiB limit'));
}
export function validateConfigs(raw,master,essentialText) {
  const problems=[],warnings=[];
  assertNoSecrets(master);
  try { normalizeConfig(raw.e1,{}); }catch(e) { problems.push(issue('E1_SCHEMA',e.message)); }
  checkEnhanced(raw.enhanced,problems);
  const p=raw.promoted,e=raw.e1,n=raw.enhanced;
  for(const k of ['enabled']) if(has(p,k)&&typeof p[k]!=='boolean') problems.push(issue('NATIVE_SCHEMA','promoted.'+k+' must be boolean'));
  if(p.editorPort!==undefined&&(!Number.isSafeInteger(p.editorPort)||p.editorPort<1024||p.editorPort>65535)) problems.push(issue('NATIVE_SCHEMA','Invalid editorPort'));
  for(const k of ['pipeName','identityPipeName']) if(has(p,k)&&(typeof p[k]!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(p[k]))) problems.push(issue('NATIVE_SCHEMA','Invalid '+k));
  if(p.enabled===true&&!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p.worldProfileId||'')) problems.push(issue('NATIVE_SCHEMA','Invalid/missing native worldProfileId'));
  for(const [group,sub] of [['intelligence',p.intelligence||{}],['activities',p.activities||{}],['reactions',p.reactions||{}]]) {
    if(!['off','shadow',...(group==='activities'||group==='reactions'?['on']:[])].includes(sub.mode||'off')) problems.push(issue('INVALID_MODE','native '+group+'.mode unsupported'));
  }
  if(!['off','shadow','experimental'].includes(p.intelligence?.directorMode||'off')) problems.push(issue('INVALID_MODE','native directorMode unsupported'));
  if(!['off','shadow','on'].includes(p.npcVoicePresence?.mode||'off')) problems.push(issue('INVALID_MODE','npcVoicePresence.mode unsupported'));
  for(const group of ['intelligence','activities','reactions']) {
    const a=e[group]||{},b=p[group]||{};
    if(a.pipeName&&b.pipeName&&a.pipeName!==b.pipeName) problems.push(issue('PIPE_MISMATCH',group+' pipe differs between E1/native'));
    if((a.mode||'off')!==(b.mode||'off')) problems.push(issue('FEATURE_MISMATCH',group+' mode differs between E1/native'));
  }
  if(e.promotedCharacters?.pipeName&&p.pipeName&&e.promotedCharacters.pipeName!==p.pipeName) problems.push(issue('PIPE_MISMATCH','promoted character pipe differs'));
  if(e.persistentIdentity?.pipeName&&p.identityPipeName&&e.persistentIdentity.pipeName!==p.identityPipeName) problems.push(issue('PIPE_MISMATCH','identity pipe differs'));
  if(e.persistentIdentity?.worldProfileId&&p.worldProfileId&&e.persistentIdentity.worldProfileId!==p.worldProfileId) problems.push(issue('WORLD_MISMATCH','worldProfileId differs'));
  if(e.promotedCharacters?.editorPort&&p.editorPort&&e.promotedCharacters.editorPort!==p.editorPort) problems.push(issue('EDITOR_MISMATCH','editorPort differs'));
  if(e.promotedCharacters?.enabled!==undefined&&p.enabled!==undefined&&e.promotedCharacters.enabled!==p.enabled) problems.push(issue('FEATURE_MISMATCH','promotedCharacters enabled differs'));
  if(e.spontaneousSpeech?.mode!=='off'&&e.spontaneousSpeech?.mode!==undefined&&p.intelligence?.directorMode!=='experimental') problems.push(issue('FEATURE_MISMATCH','Spontaneous speech requires native experimental director'));
  if((p.reactions?.mode||'off')!=='off'&&!p.enabled) problems.push(issue('FEATURE_DEPENDENCY','Native reactions require promoted host enabled'));
  if((p.activities?.mode||'off')!=='off'&&!p.enabled) problems.push(issue('FEATURE_DEPENDENCY','Native activities require promoted host enabled'));
  const capabilityModes=e.memoryK?.capabilities||{};
  for(const d of MEMORY_K_CAPABILITIES) {
    const mode=capabilityModes[d.id]||'off';
    if(mode!=='off'&&d.support==='absent') problems.push(issue('UNIMPLEMENTED_FEATURE',d.id+' has no production implementation'));
    if(mode==='on') for(const dep of d.dependencies) if(has(capabilityModes,dep)&&capabilityModes[dep]==='off') problems.push(issue('FEATURE_DEPENDENCY',d.id+' requires '+dep));
  }
  const essential=essentialBindings(essentialText);
  const talk=n.talkTargeting||{},input=n.input||{};
  if(input.enabled||talk.enabled) {
    if(!essential) problems.push(issue('ESSENTIAL_BINDINGS_UNAVAILABLE','Essential controls file required when input or UX4 is active'));
    else if(Object.values(essential).some(x=>x===undefined)) problems.push(issue('ESSENTIAL_BINDINGS_INCOMPLETE','Essential key bindings are incomplete'));
    if(essential) {
      for(const [name,key] of Object.entries(input.keys||{L4:'F6',R4:'F8',Menu:'F11'})) if(input.enabled) for(const [setting,vk] of Object.entries(essential)) if(vk!==null&&vk===physical(key)) problems.push(issue('ROUTER_ESSENTIAL_COLLISION',name+' '+key+' conflicts with Essential '+setting));
      if(talk.enabled) {
        const vk=physical(talk.key);
        for(const setting of ['TextKey','MarkPedKey','MarkedPedTalkKey']) if(vk!==null&&vk===essential[setting]) problems.push(issue('UX4_ESSENTIAL_COLLISION',talk.key+' conflicts with Essential '+setting));
        if(vk!==essential.TalkKey && master.approvals?.neutralTalkKey!==talk.key) problems.push(issue('UX4_NEUTRAL_BINDING_UNCONFIRMED','UX4 '+talk.key+' differs from Essential Talk '+(Object.keys(essential).find(x=>x==='TalkKey')||'Unknown')+'; approve neutral mode only after verifying Steam Input'));
      }
    }
  }
  if(raw.e1.speechProvider==='elevenlabs'&&!(raw.e1.elevenLabs?.voices&&Object.keys(raw.e1.elevenLabs.voices).length)) problems.push(issue('VOICE_DEPENDENCY','ElevenLabs selected without mapped voices'));
  for(const name of ['e1','promoted','enhanced']) if(JSON.stringify(raw[name]).length===0) problems.push(issue('EMPTY_CONFIG','Empty '+name));
  return {ok:problems.length===0,problems,warnings,restartRequired:['e1','promoted']};
}) assertSafeKeys(value);
  if (!object(value) && !Array.isArray(value)) return;
  for(const [key,item] of Object.entries(value)) {
    if (secretKey(key)) throw new Error('Secret field prohibited in master: '+path+'.'+key);
    assertNoSecrets(item,path+'.'+key);
  }
}
export function importSections(raw) {
  assertSafeKeys(raw);
  const e1=removeSecrets(raw.e1), promoted=removeSecrets(raw.promoted), enhanced=removeSecrets(raw.enhanced);
  const sections={ai:{},voice:{},memory:{native:{}},perception:{companion:{},native:{}},npcBehavior:{companion:{},native:{}},ux:{},controls:{},diagnostics:{},extensions:{e1:{},promoted:{},enhanced:{}}};
  const used=new Set();
  for(const [group,keys] of Object.entries(E1_GROUPS)) for(const key of keys) {
    if(!has(e1,key)) continue;
    if(group==='perception'||group==='npcBehavior') sections[group].companion[key]=clone(e1[key]);
    else sections[group][key]=clone(e1[key]);
    used.add(key);
  }
  for(const [key,value] of Object.entries(e1)) if(!used.has(key)) sections.extensions.e1[key]=clone(value);
  for(const key of ['enabled','worldProfileId','pipeName','identityPipeName','editorPort','memoryK']) {
    if(has(promoted,key)) {sections.memory.native[key]=clone(promoted[key]);}
  }
  for(const key of ['intelligence']) if(has(promoted,key)) sections.perception.native[key]=clone(promoted[key]);
  for(const key of ['activities','reactions','npcVoicePresence']) if(has(promoted,key)) sections.npcBehavior.native[key]=clone(promoted[key]);
  for(const key of ['version','input','quickCommands','talkTargeting','ui','feedback']) {
    if(!has(enhanced,key)) continue;
    const group=key==='input'?'controls':key==='version'?'extensions':key==='quickCommands'||key==='talkTargeting'||key==='ui'||key==='feedback'?'ux':null;
    if(group==='extensions') sections.extensions.enhanced[key]=clone(enhanced[key]);
    else sections[group][key]=clone(enhanced[key]);
  }
  for(const [key,value] of Object.entries(promoted)) if(!['enabled','worldProfileId','pipeName','identityPipeName','editorPort','memoryK','intelligence','activities','reactions','npcVoicePresence'].includes(key)) sections.extensions.promoted[key]=clone(value);
  for(const [key,value] of Object.entries(enhanced)) if(!['version','input','quickCommands','talkTargeting','ui','feedback'].includes(key)) sections.extensions.enhanced[key]=clone(value);
  return sections;
}
export function generate(master,original) {
  const s=master.sections;
  if(!object(s)) throw new Error('Missing master.sections');
  const result=clone(original);
  const present=(obj,key)=>obj&&has(obj,key);
  for(const [group,keys] of Object.entries(E1_GROUPS)) for(const key of keys) {
    const source=group==='perception'||group==='npcBehavior'?s[group]?.companion:s[group];
    if(present(source,key)) result.e1[key]=clone(source[key]);
  }
  for(const [key,value] of Object.entries(s.extensions?.e1||{})) result.e1[key]=clone(value);
  for(const key of ['enabled','worldProfileId','pipeName','identityPipeName','editorPort','memoryK']) if(present(s.memory?.native,key)) result.promoted[key]=clone(s.memory.native[key]);
  for(const key of ['intelligence']) if(present(s.perception?.native,key)) result.promoted[key]=clone(s.perception.native[key]);
  for(const key of ['activities','reactions','npcVoicePresence']) if(present(s.npcBehavior?.native,key)) result.promoted[key]=clone(s.npcBehavior.native[key]);
  for(const key of ['input']) if(present(s.controls,key)) result.enhanced[key]=clone(s.controls[key]);
  for(const key of ['quickCommands','talkTargeting','ui','feedback']) if(present(s.ux,key)) result.enhanced[key]=clone(s.ux[key]);
  for(const name of ['promoted','enhanced']) for(const [key,value] of Object.entries(s.extensions?.[name]||{})) result[name][key]=clone(value);
  return result;
}
function physical(name) {
  if(typeof name==='number'&&Number.isInteger(name)&&name>0&&name<255) return name;
  if(typeof name!=='string') return null;
  if(/^\d+$/.test(name)) return +name;
  const x=name.trim().toUpperCase(), aliases={XBUTTON1:'MOUSE4',XBUTTON2:'MOUSE5',LBUTTON:'MOUSE1',RBUTTON:'MOUSE2',MBUTTON:'MOUSE3',RETURN:'ENTER'};
  const key=aliases[x]||x;
  if(/^F([1-9]|1\d|2[0-4])$/.test(key)) return 0x6f+Number(key.slice(1));
  if(/^[A-Z]$/.test(key)) return key.charCodeAt(0);
  if(/^(D?[0-9])$/.test(key)) return key.charCodeAt(key.length-1);
  const mouse={MOUSE1:1,MOUSE2:2,MOUSE3:4,MOUSE4:5,MOUSE5:6};
  if(has(mouse,key)) return mouse[key];
  const extra={INSERT:45,DELETE:46,HOME:36,END:35,PAGEUP:33,PAGEDOWN:34,UP:38,DOWN:40,LEFT:37,RIGHT:39,PAUSE:19,SCROLLLOCK:145,CAPSLOCK:20,BACK:8,ESCAPE:27,ENTER:13,TAB:9,SPACE:32};
  if(has(extra,key)) return extra[key];
  if(/^NUMPAD[0-9]$/.test(key)) return 96+Number(key.slice(-1));
  return null;
}
export function essentialBindings(text) {
  if(typeof text!=='string') return null;
  const result={};
  for(const line of text.split(/\r?\n/)) {
    const m=/^\s*(TalkKey|TextKey|MarkPedKey|MarkedPedTalkKey)\s*=\s*([^#;\s]+)\s*$/i.exec(line);
    if(m) result[(['TalkKey','TextKey','MarkPedKey','MarkedPedTalkKey'].find(x=>x.toLowerCase()===m[1].toLowerCase()))]=/^(none)$/i.test(m[2])?null:physical(m[2]);
  }
  return result;
}
function checkEnhanced(e,problems) {
  if(e.version!==1) problems.push(issue('ENHANCED_SCHEMA','version must be 1'));
  const allowed=['version','input','quickCommands','talkTargeting','ui','feedback'];
  for(const k of Object.keys(e)) if(!allowed.includes(k)) problems.push(issue('ENHANCED_SCHEMA','Unsupported root key '+k));
  const i=e.input||{},talk=e.talkTargeting||{},ui=e.ui||{},feedback=e.feedback||{};
  if(!object(i)||!object(talk)||!object(ui)||!object(feedback)) {problems.push(issue('ENHANCED_SCHEMA','sections must be objects'));return;}
  const keys=i.keys||{L4:'F6',R4:'F8',Menu:'F11'},used=new Set();
  if(!object(keys)||Object.keys(keys).length<1||Object.keys(keys).length>8) problems.push(issue('ENHANCED_SCHEMA','input.keys must contain 1–8 keys'));
  else for(const [logical,p] of Object.entries(keys)) {
    const vk=physical(p);
    if(!/^[a-z][a-z0-9]{0,15}$/i.test(logical)||vk===null||[115,118,123,27,13,9,32,1,2,4].includes(vk)) problems.push(issue('ENHANCED_SCHEMA','Invalid/reserved input.keys.'+logical));
    if(used.has(vk)) problems.push(issue('ROUTER_DUPLICATE','Duplicate physical router key '+p));
    used.add(vk);
  }
  const bool=(obj,k)=>{if(has(obj,k)&&typeof obj[k]!=='boolean') problems.push(issue('ENHANCED_SCHEMA',k+' must be boolean'));};
  bool(i,'enabled');bool(talk,'enabled');bool(talk,'indicator');bool(ui,'enabled');
  if(talk.enabled && !talk.key) problems.push(issue('ENHANCED_SCHEMA','talkTargeting.key is required'));
  if(talk.key && physical(talk.key)===null) problems.push(issue('ENHANCED_SCHEMA','Invalid talkTargeting.key'));
  if(!['notification','subtitle','off'].includes(feedback.hud||'notification')) problems.push(issue('ENHANCED_SCHEMA','Invalid feedback.hud'));
  if(talk.enabled && used.has(physical(talk.key))) problems.push(issue('UX4_ROUTER_COLLISION','UX4 talk key is also a router input key'));
  const timing=i.timing||{};if(!object(timing)) problems.push(issue('ENHANCED_SCHEMA','Invalid input.timing'));
  const ranges={talkHoldMs:[120,500],cycleWindowMs:[500,3000],selectionTimeoutMs:[2000,30000],radiusMeters:[3,30],maxCandidates:[1,16]};
  for(const [k,range] of Object.entries(ranges)) if(has(talk,k)&&(!Number.isFinite(talk[k])||talk[k]<range[0]||talk[k]>range[1])) problems.push(issue('ENHANCED_SCHEMA','talkTargeting.'+k+' out of range'));
  if(talk.retentionRadiusMeters!==undefined&&(talk.retentionRadiusMeters<(talk.radiusMeters||15)||talk.retentionRadiusMeters>50)) problems.push(issue('ENHANCED_SCHEMA','Invalid talkTargeting.retentionRadiusMeters'));
  for(const [k,range] of Object.entries({chordWindowMs:[40,250],holdMs:[300,3000],doubleTapMs:[100,500],relayPulseMs:[30,200],commandCooldownMs:[250,3000]})) if(has(timing,k)&&(!Number.isSafeInteger(timing[k])||timing[k]<range[0]||timing[k]>range[1])) problems.push(issue('ENHANCED_SCHEMA','input.timing.'+k+' out of range'));
  if((timing.holdMs||600)<(timing.chordWindowMs||120)+100) problems.push(issue('ENHANCED_SCHEMA','holdMs too short for chordWindowMs'));
  if(Array.isArray(i.bindings)) {
    const ids=new Set(),gestures=new Set();
    for(const b of i.bindings) {
      if(!object(b)||!['tap','chord','hold','chordHold','doubleTap'].includes(b.gesture)||!Array.isArray(b.keys)||b.keys.length!==(['chord','chordHold'].includes(b.gesture)?2:1)||b.keys.some(k=>!has(keys,k))) problems.push(issue('ENHANCED_SCHEMA','Invalid input.bindings entry'));
      else {
        if(ids.has(b.id)) problems.push(issue('ENHANCED_SCHEMA','Duplicate binding id '+b.id));
        ids.add(b.id);
        const sig=b.gesture+':'+[...b.keys].sort().join(',');
        if(gestures.has(sig)) problems.push(issue('ENHANCED_SCHEMA','Duplicate gesture '+sig));
        gestures.add(sig);
      }
    }
  } else if(has(i,'bindings')) problems.push(issue('ENHANCED_SCHEMA','input.bindings must be array'));
  if(Buffer.byteLength(JSON.stringify(e),'utf8')>16384) problems.push(issue('ENHANCED_SCHEMA','Enhanced settings exceed native 16 KiB limit'));
}
export function validateConfigs(raw,master,essentialText) {
  const problems=[],warnings=[];
  assertNoSecrets(master);
  try { normalizeConfig(raw.e1,{}); }catch(e) { problems.push(issue('E1_SCHEMA',e.message)); }
  checkEnhanced(raw.enhanced,problems);
  const p=raw.promoted,e=raw.e1,n=raw.enhanced;
  for(const k of ['enabled']) if(has(p,k)&&typeof p[k]!=='boolean') problems.push(issue('NATIVE_SCHEMA','promoted.'+k+' must be boolean'));
  if(p.editorPort!==undefined&&(!Number.isSafeInteger(p.editorPort)||p.editorPort<1024||p.editorPort>65535)) problems.push(issue('NATIVE_SCHEMA','Invalid editorPort'));
  for(const k of ['pipeName','identityPipeName']) if(has(p,k)&&(typeof p[k]!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(p[k]))) problems.push(issue('NATIVE_SCHEMA','Invalid '+k));
  if(p.enabled===true&&!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p.worldProfileId||'')) problems.push(issue('NATIVE_SCHEMA','Invalid/missing native worldProfileId'));
  for(const [group,sub] of [['intelligence',p.intelligence||{}],['activities',p.activities||{}],['reactions',p.reactions||{}]]) {
    if(!['off','shadow',...(group==='activities'||group==='reactions'?['on']:[])].includes(sub.mode||'off')) problems.push(issue('INVALID_MODE','native '+group+'.mode unsupported'));
  }
  if(!['off','shadow','experimental'].includes(p.intelligence?.directorMode||'off')) problems.push(issue('INVALID_MODE','native directorMode unsupported'));
  if(!['off','shadow','on'].includes(p.npcVoicePresence?.mode||'off')) problems.push(issue('INVALID_MODE','npcVoicePresence.mode unsupported'));
  for(const group of ['intelligence','activities','reactions']) {
    const a=e[group]||{},b=p[group]||{};
    if(a.pipeName&&b.pipeName&&a.pipeName!==b.pipeName) problems.push(issue('PIPE_MISMATCH',group+' pipe differs between E1/native'));
    if((a.mode||'off')!==(b.mode||'off')) problems.push(issue('FEATURE_MISMATCH',group+' mode differs between E1/native'));
  }
  if(e.promotedCharacters?.pipeName&&p.pipeName&&e.promotedCharacters.pipeName!==p.pipeName) problems.push(issue('PIPE_MISMATCH','promoted character pipe differs'));
  if(e.persistentIdentity?.pipeName&&p.identityPipeName&&e.persistentIdentity.pipeName!==p.identityPipeName) problems.push(issue('PIPE_MISMATCH','identity pipe differs'));
  if(e.persistentIdentity?.worldProfileId&&p.worldProfileId&&e.persistentIdentity.worldProfileId!==p.worldProfileId) problems.push(issue('WORLD_MISMATCH','worldProfileId differs'));
  if(e.promotedCharacters?.editorPort&&p.editorPort&&e.promotedCharacters.editorPort!==p.editorPort) problems.push(issue('EDITOR_MISMATCH','editorPort differs'));
  if(e.promotedCharacters?.enabled!==undefined&&p.enabled!==undefined&&e.promotedCharacters.enabled!==p.enabled) problems.push(issue('FEATURE_MISMATCH','promotedCharacters enabled differs'));
  if(e.spontaneousSpeech?.mode!=='off'&&e.spontaneousSpeech?.mode!==undefined&&p.intelligence?.directorMode!=='experimental') problems.push(issue('FEATURE_MISMATCH','Spontaneous speech requires native experimental director'));
  if((p.reactions?.mode||'off')!=='off'&&!p.enabled) problems.push(issue('FEATURE_DEPENDENCY','Native reactions require promoted host enabled'));
  if((p.activities?.mode||'off')!=='off'&&!p.enabled) problems.push(issue('FEATURE_DEPENDENCY','Native activities require promoted host enabled'));
  const capabilityModes=e.memoryK?.capabilities||{};
  for(const d of MEMORY_K_CAPABILITIES) {
    const mode=capabilityModes[d.id]||'off';
    if(mode!=='off'&&d.support==='absent') problems.push(issue('UNIMPLEMENTED_FEATURE',d.id+' has no production implementation'));
    if(mode==='on') for(const dep of d.dependencies) if(has(capabilityModes,dep)&&capabilityModes[dep]==='off') problems.push(issue('FEATURE_DEPENDENCY',d.id+' requires '+dep));
  }
  const essential=essentialBindings(essentialText);
  const talk=n.talkTargeting||{},input=n.input||{};
  if(input.enabled||talk.enabled) {
    if(!essential) problems.push(issue('ESSENTIAL_BINDINGS_UNAVAILABLE','Essential controls file required when input or UX4 is active'));
    else if(Object.values(essential).some(x=>x===undefined)) problems.push(issue('ESSENTIAL_BINDINGS_INCOMPLETE','Essential key bindings are incomplete'));
    if(essential) {
      for(const [name,key] of Object.entries(input.keys||{L4:'F6',R4:'F8',Menu:'F11'})) if(input.enabled) for(const [setting,vk] of Object.entries(essential)) if(vk!==null&&vk===physical(key)) problems.push(issue('ROUTER_ESSENTIAL_COLLISION',name+' '+key+' conflicts with Essential '+setting));
      if(talk.enabled) {
        const vk=physical(talk.key);
        for(const setting of ['TextKey','MarkPedKey','MarkedPedTalkKey']) if(vk!==null&&vk===essential[setting]) problems.push(issue('UX4_ESSENTIAL_COLLISION',talk.key+' conflicts with Essential '+setting));
        if(vk!==essential.TalkKey && master.approvals?.neutralTalkKey!==talk.key) problems.push(issue('UX4_NEUTRAL_BINDING_UNCONFIRMED','UX4 '+talk.key+' differs from Essential Talk '+(Object.keys(essential).find(x=>x==='TalkKey')||'Unknown')+'; approve neutral mode only after verifying Steam Input'));
      }
    }
  }
  if(raw.e1.speechProvider==='elevenlabs'&&!(raw.e1.elevenLabs?.voices&&Object.keys(raw.e1.elevenLabs.voices).length)) problems.push(issue('VOICE_DEPENDENCY','ElevenLabs selected without mapped voices'));
  for(const name of ['e1','promoted','enhanced']) if(JSON.stringify(raw[name]).length===0) problems.push(issue('EMPTY_CONFIG','Empty '+name));
  return {ok:problems.length===0,problems,warnings,restartRequired:['e1','promoted']};
}) {
  if(!object(value)&&!Array.isArray(value)) return;
  for(const [k,v] of Object.entries(value)) {
    if(!safeKey(k)) throw new Error('Unsafe key '+path+'.'+k);
    assertSafeKeys(v,path+'.'+k);
  }
}
export function removeSecrets(x) {
  if (Array.isArray(x)) return x.map(removeSecrets);
  if (!object(x)) return x;
  return Object.fromEntries(Object.entries(x).filter(([k])=>!secretKey(k)).map(([k,v])=>[k,removeSecrets(v)]));
}
export function assertNoSecrets(value,path='$') {
  if (!object(value) && !Array.isArray(value)) return;
  for(const [key,item] of Object.entries(value)) {
    if (secretKey(key)) throw new Error('Secret field prohibited in master: '+path+'.'+key);
    assertNoSecrets(item,path+'.'+key);
  }
}
export function importSections(raw) {
  const e1=removeSecrets(raw.e1), promoted=removeSecrets(raw.promoted), enhanced=removeSecrets(raw.enhanced);
  const sections={ai:{},voice:{},memory:{native:{}},perception:{companion:{},native:{}},npcBehavior:{companion:{},native:{}},ux:{},controls:{},diagnostics:{},extensions:{e1:{},promoted:{},enhanced:{}}};
  const used=new Set();
  for(const [group,keys] of Object.entries(E1_GROUPS)) for(const key of keys) {
    if(!has(e1,key)) continue;
    if(group==='perception'||group==='npcBehavior') sections[group].companion[key]=clone(e1[key]);
    else sections[group][key]=clone(e1[key]);
    used.add(key);
  }
  for(const [key,value] of Object.entries(e1)) if(!used.has(key)) sections.extensions.e1[key]=clone(value);
  for(const key of ['enabled','worldProfileId','pipeName','identityPipeName','editorPort','memoryK']) {
    if(has(promoted,key)) {sections.memory.native[key]=clone(promoted[key]);}
  }
  for(const key of ['intelligence']) if(has(promoted,key)) sections.perception.native[key]=clone(promoted[key]);
  for(const key of ['activities','reactions','npcVoicePresence']) if(has(promoted,key)) sections.npcBehavior.native[key]=clone(promoted[key]);
  for(const key of ['version','input','quickCommands','talkTargeting','ui','feedback']) {
    if(!has(enhanced,key)) continue;
    const group=key==='input'?'controls':key==='version'?'extensions':key==='quickCommands'||key==='talkTargeting'||key==='ui'||key==='feedback'?'ux':null;
    if(group==='extensions') sections.extensions.enhanced[key]=clone(enhanced[key]);
    else sections[group][key]=clone(enhanced[key]);
  }
  for(const [key,value] of Object.entries(promoted)) if(!['enabled','worldProfileId','pipeName','identityPipeName','editorPort','memoryK','intelligence','activities','reactions','npcVoicePresence'].includes(key)) sections.extensions.promoted[key]=clone(value);
  for(const [key,value] of Object.entries(enhanced)) if(!['version','input','quickCommands','talkTargeting','ui','feedback'].includes(key)) sections.extensions.enhanced[key]=clone(value);
  return sections;
}
export function generate(master,original) {
  const s=master.sections;
  if(!object(s)) throw new Error('Missing master.sections');
  const result=clone(original);
  const present=(obj,key)=>obj&&has(obj,key);
  for(const [group,keys] of Object.entries(E1_GROUPS)) for(const key of keys) {
    const source=group==='perception'||group==='npcBehavior'?s[group]?.companion:s[group];
    if(present(source,key)) result.e1[key]=clone(source[key]);
  }
  for(const [key,value] of Object.entries(s.extensions?.e1||{})) result.e1[key]=clone(value);
  for(const key of ['enabled','worldProfileId','pipeName','identityPipeName','editorPort','memoryK']) if(present(s.memory?.native,key)) result.promoted[key]=clone(s.memory.native[key]);
  for(const key of ['intelligence']) if(present(s.perception?.native,key)) result.promoted[key]=clone(s.perception.native[key]);
  for(const key of ['activities','reactions','npcVoicePresence']) if(present(s.npcBehavior?.native,key)) result.promoted[key]=clone(s.npcBehavior.native[key]);
  for(const key of ['input']) if(present(s.controls,key)) result.enhanced[key]=clone(s.controls[key]);
  for(const key of ['quickCommands','talkTargeting','ui','feedback']) if(present(s.ux,key)) result.enhanced[key]=clone(s.ux[key]);
  for(const name of ['promoted','enhanced']) for(const [key,value] of Object.entries(s.extensions?.[name]||{})) result[name][key]=clone(value);
  return result;
}
function physical(name) {
  if(typeof name==='number'&&Number.isInteger(name)&&name>0&&name<255) return name;
  if(typeof name!=='string') return null;
  if(/^\d+$/.test(name)) return +name;
  const x=name.trim().toUpperCase(), aliases={XBUTTON1:'MOUSE4',XBUTTON2:'MOUSE5',LBUTTON:'MOUSE1',RBUTTON:'MOUSE2',MBUTTON:'MOUSE3',RETURN:'ENTER'};
  const key=aliases[x]||x;
  if(/^F([1-9]|1\d|2[0-4])$/.test(key)) return 0x6f+Number(key.slice(1));
  if(/^[A-Z]$/.test(key)) return key.charCodeAt(0);
  if(/^(D?[0-9])$/.test(key)) return key.charCodeAt(key.length-1);
  const mouse={MOUSE1:1,MOUSE2:2,MOUSE3:4,MOUSE4:5,MOUSE5:6};
  if(has(mouse,key)) return mouse[key];
  const extra={INSERT:45,DELETE:46,HOME:36,END:35,PAGEUP:33,PAGEDOWN:34,UP:38,DOWN:40,LEFT:37,RIGHT:39,PAUSE:19,SCROLLLOCK:145,CAPSLOCK:20,BACK:8,ESCAPE:27,ENTER:13,TAB:9,SPACE:32};
  if(has(extra,key)) return extra[key];
  if(/^NUMPAD[0-9]$/.test(key)) return 96+Number(key.slice(-1));
  return null;
}
export function essentialBindings(text) {
  if(typeof text!=='string') return null;
  const result={};
  for(const line of text.split(/\r?\n/)) {
    const m=/^\s*(TalkKey|TextKey|MarkPedKey|MarkedPedTalkKey)\s*=\s*([^#;\s]+)\s*$/i.exec(line);
    if(m) result[(['TalkKey','TextKey','MarkPedKey','MarkedPedTalkKey'].find(x=>x.toLowerCase()===m[1].toLowerCase()))]=/^(none)$/i.test(m[2])?null:physical(m[2]);
  }
  return result;
}
function checkEnhanced(e,problems) {
  if(e.version!==1) problems.push(issue('ENHANCED_SCHEMA','version must be 1'));
  const allowed=['version','input','quickCommands','talkTargeting','ui','feedback'];
  for(const k of Object.keys(e)) if(!allowed.includes(k)) problems.push(issue('ENHANCED_SCHEMA','Unsupported root key '+k));
  const i=e.input||{},talk=e.talkTargeting||{},ui=e.ui||{},feedback=e.feedback||{};
  if(!object(i)||!object(talk)||!object(ui)||!object(feedback)) {problems.push(issue('ENHANCED_SCHEMA','sections must be objects'));return;}
  const keys=i.keys||{L4:'F6',R4:'F8',Menu:'F11'},used=new Set();
  if(!object(keys)||Object.keys(keys).length<1||Object.keys(keys).length>8) problems.push(issue('ENHANCED_SCHEMA','input.keys must contain 1–8 keys'));
  else for(const [logical,p] of Object.entries(keys)) {
    const vk=physical(p);
    if(!/^[a-z][a-z0-9]{0,15}$/i.test(logical)||vk===null||[115,118,123,27,13,9,32,1,2,4].includes(vk)) problems.push(issue('ENHANCED_SCHEMA','Invalid/reserved input.keys.'+logical));
    if(used.has(vk)) problems.push(issue('ROUTER_DUPLICATE','Duplicate physical router key '+p));
    used.add(vk);
  }
  const bool=(obj,k)=>{if(has(obj,k)&&typeof obj[k]!=='boolean') problems.push(issue('ENHANCED_SCHEMA',k+' must be boolean'));};
  bool(i,'enabled');bool(talk,'enabled');bool(talk,'indicator');bool(ui,'enabled');
  if(talk.enabled && !talk.key) problems.push(issue('ENHANCED_SCHEMA','talkTargeting.key is required'));
  if(talk.key && physical(talk.key)===null) problems.push(issue('ENHANCED_SCHEMA','Invalid talkTargeting.key'));
  if(!['notification','subtitle','off'].includes(feedback.hud||'notification')) problems.push(issue('ENHANCED_SCHEMA','Invalid feedback.hud'));
  if(talk.enabled && used.has(physical(talk.key))) problems.push(issue('UX4_ROUTER_COLLISION','UX4 talk key is also a router input key'));
  const timing=i.timing||{};if(!object(timing)) problems.push(issue('ENHANCED_SCHEMA','Invalid input.timing'));
  const ranges={talkHoldMs:[120,500],cycleWindowMs:[500,3000],selectionTimeoutMs:[2000,30000],radiusMeters:[3,30],maxCandidates:[1,16]};
  for(const [k,range] of Object.entries(ranges)) if(has(talk,k)&&(!Number.isFinite(talk[k])||talk[k]<range[0]||talk[k]>range[1])) problems.push(issue('ENHANCED_SCHEMA','talkTargeting.'+k+' out of range'));
  if(talk.retentionRadiusMeters!==undefined&&(talk.retentionRadiusMeters<(talk.radiusMeters||15)||talk.retentionRadiusMeters>50)) problems.push(issue('ENHANCED_SCHEMA','Invalid talkTargeting.retentionRadiusMeters'));
  for(const [k,range] of Object.entries({chordWindowMs:[40,250],holdMs:[300,3000],doubleTapMs:[100,500],relayPulseMs:[30,200],commandCooldownMs:[250,3000]})) if(has(timing,k)&&(!Number.isSafeInteger(timing[k])||timing[k]<range[0]||timing[k]>range[1])) problems.push(issue('ENHANCED_SCHEMA','input.timing.'+k+' out of range'));
  if((timing.holdMs||600)<(timing.chordWindowMs||120)+100) problems.push(issue('ENHANCED_SCHEMA','holdMs too short for chordWindowMs'));
  if(Array.isArray(i.bindings)) {
    const ids=new Set(),gestures=new Set();
    for(const b of i.bindings) {
      if(!object(b)||!['tap','chord','hold','chordHold','doubleTap'].includes(b.gesture)||!Array.isArray(b.keys)||b.keys.length!==(['chord','chordHold'].includes(b.gesture)?2:1)||b.keys.some(k=>!has(keys,k))) problems.push(issue('ENHANCED_SCHEMA','Invalid input.bindings entry'));
      else {
        if(ids.has(b.id)) problems.push(issue('ENHANCED_SCHEMA','Duplicate binding id '+b.id));
        ids.add(b.id);
        const sig=b.gesture+':'+[...b.keys].sort().join(',');
        if(gestures.has(sig)) problems.push(issue('ENHANCED_SCHEMA','Duplicate gesture '+sig));
        gestures.add(sig);
      }
    }
  } else if(has(i,'bindings')) problems.push(issue('ENHANCED_SCHEMA','input.bindings must be array'));
  if(Buffer.byteLength(JSON.stringify(e),'utf8')>16384) problems.push(issue('ENHANCED_SCHEMA','Enhanced settings exceed native 16 KiB limit'));
}
export function validateConfigs(raw,master,essentialText) {
  const problems=[],warnings=[];
  assertNoSecrets(master);
  try { normalizeConfig(raw.e1,{}); }catch(e) { problems.push(issue('E1_SCHEMA',e.message)); }
  checkEnhanced(raw.enhanced,problems);
  const p=raw.promoted,e=raw.e1,n=raw.enhanced;
  for(const k of ['enabled']) if(has(p,k)&&typeof p[k]!=='boolean') problems.push(issue('NATIVE_SCHEMA','promoted.'+k+' must be boolean'));
  if(p.editorPort!==undefined&&(!Number.isSafeInteger(p.editorPort)||p.editorPort<1024||p.editorPort>65535)) problems.push(issue('NATIVE_SCHEMA','Invalid editorPort'));
  for(const k of ['pipeName','identityPipeName']) if(has(p,k)&&(typeof p[k]!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(p[k]))) problems.push(issue('NATIVE_SCHEMA','Invalid '+k));
  if(p.enabled===true&&!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p.worldProfileId||'')) problems.push(issue('NATIVE_SCHEMA','Invalid/missing native worldProfileId'));
  for(const [group,sub] of [['intelligence',p.intelligence||{}],['activities',p.activities||{}],['reactions',p.reactions||{}]]) {
    if(!['off','shadow',...(group==='activities'||group==='reactions'?['on']:[])].includes(sub.mode||'off')) problems.push(issue('INVALID_MODE','native '+group+'.mode unsupported'));
  }
  if(!['off','shadow','experimental'].includes(p.intelligence?.directorMode||'off')) problems.push(issue('INVALID_MODE','native directorMode unsupported'));
  if(!['off','shadow','on'].includes(p.npcVoicePresence?.mode||'off')) problems.push(issue('INVALID_MODE','npcVoicePresence.mode unsupported'));
  for(const group of ['intelligence','activities','reactions']) {
    const a=e[group]||{},b=p[group]||{};
    if(a.pipeName&&b.pipeName&&a.pipeName!==b.pipeName) problems.push(issue('PIPE_MISMATCH',group+' pipe differs between E1/native'));
    if((a.mode||'off')!==(b.mode||'off')) problems.push(issue('FEATURE_MISMATCH',group+' mode differs between E1/native'));
  }
  if(e.promotedCharacters?.pipeName&&p.pipeName&&e.promotedCharacters.pipeName!==p.pipeName) problems.push(issue('PIPE_MISMATCH','promoted character pipe differs'));
  if(e.persistentIdentity?.pipeName&&p.identityPipeName&&e.persistentIdentity.pipeName!==p.identityPipeName) problems.push(issue('PIPE_MISMATCH','identity pipe differs'));
  if(e.persistentIdentity?.worldProfileId&&p.worldProfileId&&e.persistentIdentity.worldProfileId!==p.worldProfileId) problems.push(issue('WORLD_MISMATCH','worldProfileId differs'));
  if(e.promotedCharacters?.editorPort&&p.editorPort&&e.promotedCharacters.editorPort!==p.editorPort) problems.push(issue('EDITOR_MISMATCH','editorPort differs'));
  if(e.promotedCharacters?.enabled!==undefined&&p.enabled!==undefined&&e.promotedCharacters.enabled!==p.enabled) problems.push(issue('FEATURE_MISMATCH','promotedCharacters enabled differs'));
  if(e.spontaneousSpeech?.mode!=='off'&&e.spontaneousSpeech?.mode!==undefined&&p.intelligence?.directorMode!=='experimental') problems.push(issue('FEATURE_MISMATCH','Spontaneous speech requires native experimental director'));
  if((p.reactions?.mode||'off')!=='off'&&!p.enabled) problems.push(issue('FEATURE_DEPENDENCY','Native reactions require promoted host enabled'));
  if((p.activities?.mode||'off')!=='off'&&!p.enabled) problems.push(issue('FEATURE_DEPENDENCY','Native activities require promoted host enabled'));
  const capabilityModes=e.memoryK?.capabilities||{};
  for(const d of MEMORY_K_CAPABILITIES) {
    const mode=capabilityModes[d.id]||'off';
    if(mode!=='off'&&d.support==='absent') problems.push(issue('UNIMPLEMENTED_FEATURE',d.id+' has no production implementation'));
    if(mode==='on') for(const dep of d.dependencies) if(has(capabilityModes,dep)&&capabilityModes[dep]==='off') problems.push(issue('FEATURE_DEPENDENCY',d.id+' requires '+dep));
  }
  const essential=essentialBindings(essentialText);
  const talk=n.talkTargeting||{},input=n.input||{};
  if(input.enabled||talk.enabled) {
    if(!essential) problems.push(issue('ESSENTIAL_BINDINGS_UNAVAILABLE','Essential controls file required when input or UX4 is active'));
    else if(Object.values(essential).some(x=>x===undefined)) problems.push(issue('ESSENTIAL_BINDINGS_INCOMPLETE','Essential key bindings are incomplete'));
    if(essential) {
      for(const [name,key] of Object.entries(input.keys||{L4:'F6',R4:'F8',Menu:'F11'})) if(input.enabled) for(const [setting,vk] of Object.entries(essential)) if(vk!==null&&vk===physical(key)) problems.push(issue('ROUTER_ESSENTIAL_COLLISION',name+' '+key+' conflicts with Essential '+setting));
      if(talk.enabled) {
        const vk=physical(talk.key);
        for(const setting of ['TextKey','MarkPedKey','MarkedPedTalkKey']) if(vk!==null&&vk===essential[setting]) problems.push(issue('UX4_ESSENTIAL_COLLISION',talk.key+' conflicts with Essential '+setting));
        if(vk!==essential.TalkKey && master.approvals?.neutralTalkKey!==talk.key) problems.push(issue('UX4_NEUTRAL_BINDING_UNCONFIRMED','UX4 '+talk.key+' differs from Essential Talk '+(Object.keys(essential).find(x=>x==='TalkKey')||'Unknown')+'; approve neutral mode only after verifying Steam Input'));
      }
    }
  }
  if(raw.e1.speechProvider==='elevenlabs'&&!(raw.e1.elevenLabs?.voices&&Object.keys(raw.e1.elevenLabs.voices).length)) problems.push(issue('VOICE_DEPENDENCY','ElevenLabs selected without mapped voices'));
  for(const name of ['e1','promoted','enhanced']) if(JSON.stringify(raw[name]).length===0) problems.push(issue('EMPTY_CONFIG','Empty '+name));
  return {ok:problems.length===0,problems,warnings,restartRequired:['e1','promoted']};
}