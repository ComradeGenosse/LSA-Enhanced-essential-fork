#!/usr/bin/env node
// A single real, billed Eleven v4 Turbo voice preview. Does not invoke Luna,
// touch GTA or modify character profiles. Never writes a credential or text transcript.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defaultConfigPath, normalizeConfig } from '../../src/config/e1Config.mjs';
import { loadPrivateEnvironment } from '../../src/config/privateEnvironment.mjs';
import { createElevenLabsSpeechProvider } from '../../src/providers/elevenlabs/speechProvider.mjs';
import { pcmToWav } from '../qwen/lsa_turn_smoke.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LINE = 'Hey, it is Nathan. I am ready to get moving whenever you are.';
export function parseArgs(argv) {
  const options={};
  for(let i=0;i<argv.length;i++){
    const flag=argv[i];
    if(flag==='--help'||flag==='-h'){options.help=true;continue;}
    if(flag==='--allow-billing'){options.allowBilling=true;continue;}
    if(!['--voice','--out'].includes(flag))throw new Error('Unknown argument: '+flag);
    if(!argv[i+1])throw new Error('Missing value for '+flag);
    options[flag.slice(2)]=argv[++i];
  }
  if(options.voice && !/^[a-z][a-z0-9_-]{0,31}$/.test(options.voice))
    throw new Error('Invalid voice alias.');
  return options;
}
export async function main(argv=process.argv.slice(2)){
  const options=parseArgs(argv);
  if(options.help){
    process.stdout.write('One short paid ElevenLabs v4 Turbo test, no GTA or Luna.\n'+
      'node tools/elevenlabs/voice_smoke.mjs --voice nathan --allow-billing [--out local-preview.wav]\n'+
      'Reads e1.config.json elevenLabs.voices and ignored .env ELEVENLABS_API_KEY.\n');
    return;
  }
  if(!options.allowBilling)throw new Error('Live ElevenLabs call requires --allow-billing.');
  const env=await loadPrivateEnvironment();
  const raw=JSON.parse(await readFile(defaultConfigPath,'utf8'));
  const config=normalizeConfig({...raw,speechProvider:'elevenlabs'},env);
  const voice=options.voice || config.ttsVoice;
  if(!config.elevenLabs.voices[voice])throw new Error('Selected ElevenLabs voice alias is missing.');
  const pcm=[], t0=performance.now();
  let firstPcmMs=null;
  const speech=createElevenLabsSpeechProvider({config});
  const result=await speech.synthesize({
    identity:{pedId:'offline-nathan-preview',turnId:'offline-preview',generationId:1,sessionNonce:1},
    dialogue:LINE,speechProfile:{provider:'elevenlabs',voice},
    onPcm:async data=>{
      if(firstPcmMs===null)firstPcmMs=performance.now()-t0;
      pcm.push(Buffer.from(data));
    },
  });
  const totalMs=performance.now()-t0;
  const destination=path.resolve(options.out || path.join(ROOT,'outputs','elevenlabs-smoke','nathan.wav'));
  await mkdir(path.dirname(destination),{recursive:true});
  await writeFile(destination,pcmToWav(pcm));
  process.stdout.write(JSON.stringify({
    provider:'elevenlabs',modelId:config.elevenLabs.modelId,voiceAlias:voice,
    firstPcmMs:Math.round(firstPcmMs),totalMs:Math.round(totalMs),
    audioMs:Math.round(result.bytes/48),pcmBytes:result.bytes,
    wav:destination,
  },null,2)+'\n');
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{process.stderr.write('ElevenLabs smoke failed: '+String(e.code||e.message||'unknown_failure')+'\n');process.exitCode=1;});
