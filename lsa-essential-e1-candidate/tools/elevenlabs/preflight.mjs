#!/usr/bin/env node
// Non-synthesis preflight. GET-only account/voice/model lookup; no dialogue,
// audio, credits charged, sockets, or credential output.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultConfigPath, normalizeConfig } from '../../src/config/e1Config.mjs';
import { loadPrivateEnvironment } from '../../src/config/privateEnvironment.mjs';

export function parseArgs(argv) {
  const options={};
  for(let i=0;i<argv.length;i++){
    if(argv[i]==='--help'||argv[i]==='-h'){options.help=true;continue;}
    if(argv[i]==='--voice' && typeof argv[i+1]==='string' && /^[a-z][a-z0-9_-]{0,31}$/.test(argv[i+1])){
      options.voice=argv[++i];continue;
    }
    throw new Error('Use --voice <configured local alias> or --help.');
  }
  return options;
}
async function getJson(url, key, fetchImpl){
  const response=await fetchImpl(url,{
    method:'GET',redirect:'error',headers:{'xi-api-key':key,'Accept':'application/json'},
    signal:AbortSignal.timeout(15000),
  });
  if(!response?.ok) return {ok:false,status:Number.isInteger(response?.status)?response.status:null};
  const json=await response.json();
  return {ok:true,status:response.status,json};
}
export async function checkElevenLabs({config, voiceAlias, fetchImpl=globalThis.fetch}){
  if(!config || config.speechProvider!=='elevenlabs')throw new Error('Configure ElevenLabs before preflight.');
  const key=config.elevenLabs.apiKey;
  if(typeof key!=='string'||!key.trim())throw new Error('ELEVENLABS_API_KEY not loaded.');
  const alias=voiceAlias||config.ttsVoice, voiceId=config.elevenLabs.voices[alias];
  if(!voiceId||!config.speechVoices.includes(alias))throw new Error('Unknown local voice alias.');
  const model=await getJson('https://api.elevenlabs.io/v1/models',key,fetchImpl);
  const voices=await getJson('https://api.elevenlabs.io/v1/voices/'+encodeURIComponent(voiceId),key,fetchImpl);
  const listed=model.ok && Array.isArray(model.json)
    ? model.json.find(item=>item?.model_id===config.elevenLabs.modelId):undefined;
  // Do not print vendor-controlled voice descriptions, user IDs, keys,
  // full JSON responses or voice IDs. A model listing is not proof of actual
  // TTD/PCM entitlement, voice suitability or TTS API-key permissions.
  return {
    modelLookupHttp:model.status,
    modelListed:Boolean(listed),
    modelRequiresAlphaAccess:listed?.requires_alpha_access===true,
    voiceLookupHttp:voices.status,
    voiceAccessible:voices.ok,
    readyToAttemptSpeech:Boolean(listed && voices.ok),
    caveat:'GET results cannot confirm TTS permission, v4 entitlement, PCM_24000 access or billed synthesis.',
  };
}
export async function main(argv=process.argv.slice(2)){
  const options=parseArgs(argv);
  if(options.help){
    process.stdout.write('No-billing GET-only preflight (does NOT synthesize speech):\n'+
      'node tools/elevenlabs/preflight.mjs --voice nathan\n'+
      'Requires local e1.config.json and ignored .env ELEVENLABS_API_KEY.\n');
    return;
  }
  const env=await loadPrivateEnvironment();
  const raw=JSON.parse(await readFile(defaultConfigPath,'utf8'));
  const config=normalizeConfig({...raw,speechProvider:'elevenlabs'},env);
  process.stdout.write(JSON.stringify(await checkElevenLabs({config,voiceAlias:options.voice}),null,2)+'\n');
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{process.stderr.write(
    'ElevenLabs GET preflight failed: '+(String(error.message||'network_error')
    .match(/^(Unknown local voice alias\.|ELEVENLABS_API_KEY not loaded\.|Configure ElevenLabs before preflight\.)$/)
    ? error.message : 'network_or_local_config_error')+'\n');process.exitCode=1;});
