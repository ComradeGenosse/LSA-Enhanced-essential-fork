// NPC speech delivery ledger (WS-5a / K-03(c)).
//
// What it is: the E1 runtime's own, per-turn record of what happened to an NPC
// reply on its way to the player's ears. It is written ONLY by
// runSequentialTurn, at the points where the runner actually performs the
// action, and by the native playback events the patched original bridge
// delivers for that exact turn tuple. It is read ONLY by D03 (the sole P2
// dialogue writer) through the verifier below.
//
// What it replaces: the old services.admitM2SpeechSegment({audioBytes,
// forwardedBytes}) hook, where the CALLER asserted both byte counts (equal by
// construction) and nothing independent existed to check them. Here the ledger
// counts every PCM chunk the runner really forwarded (after host.emit
// succeeded), compares that to what the TTS provider says it produced, and
// records the native acknowledgements itself. Nothing a model, a decision, a
// caller flag or a service argument says can add to, upgrade or fabricate an
// entry. The recorder capability is handed privately to OpenAIConnection (like
// the D01 issuer) and never reaches runtime/services/bridge/config.
//
// Outcome classification is computed here, from the evidence only:
//   completed    every segment provider-complete and fully forwarded, stream
//                finalised, native playback_ended(completed, started, audio,
//                not interrupted) AND the runner's RAM-history acceptance.
//   interrupted  audible start evidence (native playback_started, or a native
//                terminal that itself reports playbackStarted+hadAudio) and at
//                least one segment whose PCM reached native, but not completed.
//                The text is exactly what was handed to native playback.
//                "Possibly not heard": never proof the player heard it all.
//   failed       a reply was planned or synthesis started, but nothing ever
//                became audible. Never presented as said.
// Anything else yields no outcome (nothing to record).
import {createHash} from 'node:crypto';

import {isNativeActorId} from '../identity/nativeActorId.mjs';
const KEYS=Object.freeze(['pedId','turnId','generationId','sessionNonce']);
const PLAYER_SOURCES=new Set(['player_text','player_mic']);
const MAX_SEGMENTS=128;
const MAX_TEXT=12_000; // journal content bound (validateDialogueLine)
const TERMINAL_NATIVE=new Set(['playback_ended','audio_turn_rejected','interrupt','cancel','fail']);
const RUNNER_TERMINALS=new Set(['completed','cancelled','superseded','disconnected','provider_timeout',
  'stt_error','model_error','model_refusal','invalid_decision','tts_error','native_auth_rejected',
  'playback_error','playback_interrupted','playback_ack_timeout']);
const validIdentity=i=>!!i&&typeof i==='object'&&
  typeof i.pedId==='string'&&isNativeActorId(i.pedId)&&
  typeof i.turnId==='string'&&i.turnId.length>0&&i.turnId.length<=128&&
  i.turnId.trim()===i.turnId&&
  Number.isSafeInteger(i.generationId)&&i.generationId>=0&&
  Number.isSafeInteger(i.sessionNonce)&&i.sessionNonce>=1;
const keyOf=i=>KEYS.map(k=>String(i[k])).join('\u0000');
const sessionKeyOf=i=>String(i.pedId)+'\u0000'+String(i.sessionNonce);
const same=(a,b)=>!!a&&!!b&&KEYS.every(k=>a[k]===b[k]);
const pick=i=>Object.freeze(Object.fromEntries(KEYS.map(k=>[k,i[k]])));
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const posInt=n=>Number.isSafeInteger(n)&&n>0;
const validText=t=>typeof t==='string'&&t.length>=1&&t.length<=MAX_TEXT&&t.trim()!==''&&
  Buffer.from(t,'utf8').toString('utf8')===t;

export function createNpcSpeechDeliverySource({now=()=>new Date(),maxTurns=64}={}){
  if(typeof now!=='function'||!Number.isSafeInteger(maxTurns)||maxTurns<1||maxTurns>1024)
    throw new TypeError('npc_speech_ledger_ports_required');
  const entries=new Map();
  const stamp=()=>{
    const d=now();
    return d instanceof Date&&Number.isFinite(d.getTime())?d.toISOString():null;
  };

  function openTurn({identity,source,connection,signal}={}){
    if(!validIdentity(identity)||!PLAYER_SOURCES.has(source)||
       !connection||typeof connection!=='object'||
       !signal||typeof signal.aborted!=='boolean')return null;
    const exact=pick(identity),key=keyOf(exact);
    if(entries.has(key))return null; // one ledger per turn tuple, ever
    const e={identity:exact,sessionKey:sessionKeyOf(exact),
      segments:[],poisoned:false,streamEnded:false,historyAccepted:false,
      planned:null,runnerTerminal:null,terminalAt:null,
      native:{accepted:false,started:false,terminal:null},closed:false};
    entries.set(key,e);
    while(entries.size>maxTurns)entries.delete(entries.keys().next().value);
    const live=()=>!e.closed&&entries.get(key)===e;
    const poison=()=>{e.poisoned=true;};
    const mark=()=>{e.terminalAt??=stamp();};

    return Object.freeze({
      // Called when the runner starts synthesising one segment (early streaming)
      // or the whole reply (buffered). Sequential and gap-free by construction.
      beginSegment({sequence,text}={}){
        if(!live()||e.poisoned)return null;
        const previous=e.segments[e.segments.length-1];
        if(!Number.isSafeInteger(sequence)||sequence!==e.segments.length||
           sequence>=MAX_SEGMENTS||!validText(text)||
           (previous&&previous.state==='open')){poison();return null;}
        const total=e.segments.reduce((n,s)=>n+s.text.length,0)+text.length;
        if(total>MAX_TEXT){poison();return null;}
        const segment={sequence,text,state:'open',forwardedBytes:0,providerBytes:0};
        e.segments.push(segment);
        return Object.freeze({
          // Called by the runner AFTER host.emit accepted this PCM chunk.
          forwarded(byteLength){
            if(!live()||segment.state!=='open'||!posInt(byteLength)){poison();return false;}
            segment.forwardedBytes+=byteLength;return true;
          },
          // The TTS provider's own total. A segment is proven only if it equals
          // the bytes the runner itself counted as forwarded to native.
          completed(providerBytes){
            if(!live()||segment.state!=='open'||!posInt(providerBytes)){poison();return false;}
            segment.providerBytes=providerBytes;
            segment.state='completed';
            if(providerBytes!==segment.forwardedBytes){segment.state='mismatch';poison();return false;}
            return true;
          },
          failed(){if(live()&&segment.state==='open')segment.state='failed';},
        });
      },
      // Every native event the bridge delivered for THIS tuple (already filtered
      // by sameIdentity in observeNative). Events carry no free text.
      native(event){
        if(!live()||!event||typeof event!=='object'||!same(event,exact))return false;
        if(event.type==='audio_turn_accepted')e.native.accepted=true;
        else if(event.type==='playback_started')e.native.started=true;
        if(TERMINAL_NATIVE.has(event.type)&&!e.native.terminal){
          e.native.terminal=Object.freeze({type:event.type,
            reason:String(event.reason??'').slice(0,80),
            wasInterrupted:event.wasInterrupted===true,
            hadAudio:event.hadAudio===true,
            playbackStarted:event.playbackStarted===true});
          mark();
        }
        return true;
      },
      // turn_complete was accepted by native: every PCM chunk has been handed over.
      finalized(){
        if(!live()||e.poisoned||e.segments.length===0||
           !e.segments.every(s=>s.state==='completed')){poison();return false;}
        e.streamEnded=true;return true;
      },
      // The host-validated reply text (used only for a `failed` line).
      planned(text){
        if(live()&&e.planned===null&&validText(text))e.planned=text;
      },
      // The runner's own RAM-history decision (DialogueHistory.acceptPlaybackResult
      // returned true) for exactly this native terminal.
      historyAccepted(result){
        const t=e.native.terminal;
        if(!live()||!t||!same(result,exact)||result.type!==t.type||
           result.reason!==t.reason||(result.wasInterrupted===true)!==t.wasInterrupted||
           (result.hadAudio===true)!==t.hadAudio||
           (result.playbackStarted===true)!==t.playbackStarted)return false;
        e.historyAccepted=true;return true;
      },
      terminal(reason){
        if(!live()||e.runnerTerminal!==null||!RUNNER_TERMINALS.has(reason))return false;
        e.runnerTerminal=reason;mark();return true;
      },
      release(){e.closed=true;entries.delete(key);},
    });
  }

  function evaluate(identity){
    if(!validIdentity(identity))return null;
    const e=entries.get(keyOf(identity));
    if(!e||e.closed||!same(e.identity,identity))return null;
    const segs=e.segments;
    const t=e.native.terminal;
    const proven=!e.poisoned&&segs.length>0&&
      segs.every(s=>s.state==='completed'&&s.forwardedBytes===s.providerBytes&&s.forwardedBytes>0);
    const playedOut=!!t&&t.type==='playback_ended'&&t.reason==='completed'&&
      t.wasInterrupted===false&&t.hadAudio===true&&t.playbackStarted===true;
    const audible=e.native.started||(!!t&&t.type==='playback_ended'&&
      t.playbackStarted===true&&t.hadAudio===true);
    // PCM that really reached native, in order, from the first segment on.
    const handed=[];
    for(const s of segs){if(s.forwardedBytes>0)handed.push(s);else break;}
    let delivery=null,text=null,used=[];
    if(proven&&e.streamEnded&&playedOut&&e.historyAccepted){
      delivery='completed';used=segs;text=segs.map(s=>s.text).join('');
    }else if(audible&&handed.length>0){
      delivery='interrupted';used=handed;text=handed.map(s=>s.text).join('');
    }else if(!audible&&(e.planned!==null||segs.length>0)&&e.runnerTerminal!==null&&
             e.runnerTerminal!=='completed'){
      delivery='failed';used=[];text=e.planned??segs.map(s=>s.text).join('');
    }
    if(delivery===null||!validText(text)||text.length>MAX_TEXT)return null;
    // An in-flight turn (no terminal yet) has no outcome to record.
    if(delivery!=='completed'&&e.runnerTerminal===null&&!t)return null;
    const observedAtUtc=e.terminalAt;
    if(!observedAtUtc)return null;
    const body={kind:'NpcSpeechDeliveryEvidenceV1',identity:e.identity,delivery,
      segments:used.map(s=>({sequence:s.sequence,textSha256:sha(s.text),
        textUtf8Bytes:Buffer.byteLength(s.text,'utf8'),
        providerBytes:s.providerBytes,forwardedBytes:s.forwardedBytes})),
      plannedTextSha256:e.planned===null?null:sha(e.planned),
      nativeTerminal:t,audibleStart:audible,nativeAccepted:e.native.accepted,
      streamEnded:e.streamEnded,historyAccepted:e.historyAccepted,
      runnerTerminal:e.runnerTerminal,observedAtUtc};
    return Object.freeze({...body,text,evidenceSha256:sha(JSON.stringify(body))});
  }

  return Object.freeze({
    // Private to OpenAIConnection (never on runtime/services/bridge).
    recorder:Object.freeze({
      openTurn,
      retireSession({pedId,sessionNonce}={}){
        if(typeof pedId!=='string'||!pedId||!Number.isSafeInteger(sessionNonce))return false;
        const k=sessionKeyOf({pedId,sessionNonce});
        for(const [key,e] of entries)if(e.sessionKey===k){e.closed=true;entries.delete(key);}
        return true;
      },
      clear(){for(const e of entries.values())e.closed=true;entries.clear();},
    }),
    // Read-only, for D03's synchronous read-through inside the P2 transaction.
    verifier:Object.freeze({evaluate,get size(){return entries.size;}}),
  });
}
