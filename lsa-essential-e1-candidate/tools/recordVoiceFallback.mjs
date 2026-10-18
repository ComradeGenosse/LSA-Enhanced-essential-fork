// Explicit, operator-run generation utility. Never records during gameplay.
// Example: ELEVENLABS_API_KEY=... node tools/recordVoiceFallback.mjs /path/to/e1.config.json ./VoiceFallback/recording-plan.json
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig} from '../src/config/e1Config.mjs';
import {createElevenLabsSpeechProvider} from '../src/providers/elevenlabs/speechProvider.mjs';
import {pcmToWav} from '../src/voice/pcmWav.mjs';
import {decodeFallbackWav} from '../src/voice/localFallback.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../VoiceFallback');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const CATEGORIES=new Set(['misheard','lost_thought','speech_lost','action_unconfirmed','action_succeeded','action_failed']);
const [configPath,planPath]=process.argv.slice(2);
if(!configPath||!planPath)throw new Error('Usage: node tools/recordVoiceFallback.mjs <config.json> <recording-plan.json>');
const config=await loadConfig({configPath:path.resolve(configPath)});
if(config.speechProvider!=='elevenlabs'||!config.elevenLabs.apiKey)
  throw new Error('Recording requires a configured ElevenLabs voice and ELEVENLABS_API_KEY in the process environment');
if(typeof globalThis.WebSocket!=='function')throw new Error('Run recording on Node 22+ with native WebSocket support');
const plan=JSON.parse(await readFile(path.resolve(planPath),'utf8'));
if(!Array.isArray(plan.characters)||plan.characters.length<1||plan.characters.length>128)
  throw new Error('Invalid recording plan character list');
const provider=createElevenLabsSpeechProvider({config});
const output={version:1,characters:[]};
for(const pack of plan.characters){
  const characterId=pack.characterId;
  if(!UUID.test(characterId)||!SAFE.test(pack.voice)||!config.elevenLabs.voices[pack.voice]||
     !Array.isArray(pack.clips)||pack.clips.length<1||pack.clips.length>64)
    throw new Error('Invalid character or configured voice in recording plan');
  const clips=[],seen=new Set();
  for(const clip of pack.clips){
    if(!SAFE.test(clip.id)||seen.has(clip.id)||!CATEGORIES.has(clip.category)||
       typeof clip.text!=='string'||!clip.text.trim()||clip.text.length>240)
      throw new Error('Invalid or duplicate recording in plan');
    seen.add(clip.id);
    clips.push({...clip,asset:clip.id+'.wav'});
  }
  output.characters.push({characterId,voice:pack.voice,clips});
}
// No files written until the full plan validates. Each failed render leaves
// its manifest unpublished, so the runtime never selects a phantom clip.
for(const pack of output.characters){
  await mkdir(path.join(ROOT,pack.characterId),{recursive:true});
  for(const clip of pack.clips){
    const chunks=[];
    const result=await provider.synthesize({
      identity:{pedId:'offline-recording',turnId:clip.id,generationId:0,sessionNonce:1},
      dialogue:clip.text,signal:new AbortController().signal,
      speechProfile:{provider:'elevenlabs',voice:pack.voice},
      timeoutMs:45000,onPcm:async chunk=>chunks.push(Buffer.from(chunk)),
    });
    if(!result?.bytes||result.bytes!==chunks.reduce((s,c)=>s+c.length,0))
      throw new Error('Incomplete prerecorded audio: '+clip.id);
    const wav=pcmToWav(chunks);
    decodeFallbackWav(wav); // Reject clips too long or incompatible with native local playback.
    await writeFile(path.join(ROOT,pack.characterId,clip.asset),wav);
    console.log('Recorded '+pack.characterId+' / '+clip.id);
  }
}
await writeFile(path.join(ROOT,'manifest.json'),JSON.stringify(output,null,2)+'\n');
console.log('Recorded assets ready for packaging; never commit credentials.');
