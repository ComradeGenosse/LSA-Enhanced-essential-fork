import { createHash, randomUUID } from 'node:crypto';
import { validateAcceptedTranscript, validateCaptureReceipt } from './speechContract.mjs';

const MAX_TRANSCRIPTS = 64, MAX_TEXT_BYTES = 4096, MAX_TEXT_TOTAL = 256 * 1024, DEDUPE_LIMIT = 1024, DEDUPE_TTL_MS = 10 * 60 * 1000;

export class SharedTranscriptStore {
  constructor({ now = () => Math.floor(performance.now()), current = () => false, activeRun = null, knownNamesByObserver = () => [] } = {}) {
    this.now = now; this.current = current; this.activeRun = activeRun; this.knownNamesByObserver=knownNamesByObserver; this.entries = new Map(); this.suppression = new Map(); this.seenUtterances=new Map();this.conversations=new Map();this.watermarks = new Map(); this.bytes = 0;
    this.diagnostics = { unsupported: 0, invalid: 0, replayed: 0, conflicts: 0, expired: 0, overflow: 0, unknownObservers: 0, didNotHear: 0 };
  }
  setActiveRun(run) {
    if (run === this.activeRun) return;
    this.clear(); this.activeRun = run;
  }
  accept({ capability = false, receipt, text }) {
    const now = this.now(); this.expire();
    if (capability !== true || !this.activeRun || receipt?.nativeRun !== this.activeRun) { this.bump('unsupported'); return { accepted: false, reason: 'unsupported_capture_receipt' }; }
    if (!validateCaptureReceipt(receipt) || typeof text !== 'string' || !text.trim() || Buffer.byteLength(text,'utf8')>MAX_TEXT_BYTES || !this.current(receipt.source.captureRef)) { this.bump('invalid'); return { accepted: false, reason: 'invalid_speech_input' }; }
    if(receipt.endMonotonicMs>now||now-receipt.endMonotonicMs>30000) {this.bump('invalid');return {accepted:false,reason:'stale_capture_receipt'};}
    const key = `${receipt.nativeRun}:${receipt.utteranceId}`;
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.transcript.text !== text) { this.bump('conflicts'); return { accepted: false, reason: 'conflicting_accepted_text' }; }
      this.bump('replayed'); return { accepted: true, duplicate: true, transcriptRef: existing.transcript.transcriptRef, perceptions: existing.perceptions };
    }
    const seen=this.seenUtterances.get(key);
    if(seen) {if(seen.digest!==fingerprint(text)) {this.bump('conflicts');return {accepted:false,reason:'conflicting_accepted_text'};}this.bump('replayed');return {accepted:true,duplicate:true,transcriptRef:null,perceptions:[]};}
    const watermarkKey = `${receipt.nativeRun}:${receipt.producerId}`;
    const watermark = this.watermarks.get(watermarkKey) || 0;
    if (receipt.producerSequence <= watermark) { this.bump('replayed'); return { accepted: false, reason: 'stale_producer_sequence' }; }
    const conversationKey=receipt.conversationRef?`${receipt.nativeRun}:${receipt.source.captureRef}:${receipt.conversationRef}`:null;
    const priorConversation=conversationKey&&this.conversations.get(conversationKey);
    const newObserverKeys=receipt.observers.filter(w=>w.hearing==='heard'&&this.current(w.observer.captureRef)&&!this.suppression.has(`${receipt.nativeRun}:${receipt.utteranceId}:${w.observer.captureRef}`)).length;
    if(this.suppression.size+newObserverKeys>DEDUPE_LIMIT) { this.bump('overflow'); return { accepted:false,reason:'speech_capacity' }; }
    if(this.seenUtterances.size>=DEDUPE_LIMIT || conversationKey&& !priorConversation && this.conversations.size>=MAX_TRANSCRIPTS) {this.bump('overflow');return {accepted:false,reason:'speech_capacity'};}
    const transcript = Object.freeze({ nativeRun: receipt.nativeRun, utteranceId: receipt.utteranceId, transcriptRef: randomUUID(), revision: 1, origin: 'player_stt', text, acceptedAtMonotonicMs: now, expiresAtMonotonicMs: Math.min(now + 30000, receipt.endMonotonicMs + 30000) });
    if (!validateAcceptedTranscript(transcript,{activeNativeRun:this.activeRun,now})) { this.bump('invalid'); return { accepted: false, reason: 'invalid_accepted_transcript' }; }
    const bytes = Buffer.byteLength(text,'utf8');
    if (this.entries.size>=MAX_TRANSCRIPTS || bytes>MAX_TEXT_BYTES || this.bytes+bytes>MAX_TEXT_TOTAL) { this.bump('overflow'); return { accepted: false, reason: 'speech_capacity' }; }
    const silenceGap=priorConversation?receipt.startMonotonicMs-priorConversation.lastEnd:-1;
    const episodeId=priorConversation&&priorConversation.expires>now&&silenceGap>=0&&silenceGap<=5000?priorConversation.episodeId:randomUUID();
    const perceptions = [];
    for (const witness of receipt.observers) {
      const observerRef=witness.observer.captureRef, suppressionKey=`${receipt.nativeRun}:${receipt.utteranceId}:${observerRef}`;
      if (witness.hearing!=='heard') { if(witness.hearing==='unknown') this.bump('unknownObservers');else this.bump('didNotHear'); continue; }
      if (!this.current(observerRef) || this.suppression.has(suppressionKey)) continue;
      const full=covers(witness.audibleIntervalsMs,receipt.durationMs);
      const addressEvidence=full?addressHints(text,this.knownNamesByObserver(observerRef)||[]):undefined;
      const perception=Object.freeze({eventType:'speech_heard',observationId:randomUUID(),episodeId,revision:1,nativeRun:receipt.nativeRun,utteranceId:receipt.utteranceId,observer:{captureRef:observerRef,kind:'ped'},witnessReceiptRef:receipt.captureReceiptRef,hearing:'heard',evidence:{channel:'auditory',basis:'audibility_model',sampledGameTick:witness.sampledGameTick},coverage:full?'full':'partial',...(full?{authorizedTextRef:transcript.transcriptRef}:{}),...(addressEvidence?{addressEvidence}:{})});
      perceptions.push(perception);
      this.suppression.set(suppressionKey,{expires:now+DEDUPE_TTL_MS,sequence:receipt.producerSequence});
    }
    this.entries.set(key,{transcript,perceptions,receiptRef:receipt.captureReceiptRef,bytes}); this.bytes+=bytes; this.watermarks.set(watermarkKey,receipt.producerSequence);this.seenUtterances.set(key,{digest:fingerprint(text),expires:now+DEDUPE_TTL_MS});
    if(conversationKey) this.conversations.set(conversationKey,{episodeId,lastEnd:receipt.endMonotonicMs,expires:Math.min(now+30000,receipt.endMonotonicMs+30000)});
    return {accepted:true,duplicate:false,transcriptRef:transcript.transcriptRef,perceptions};
  }
  resolveForObserver(transcriptRef,observerRef) { this.expire(); for(const e of this.entries.values()) if(e.transcript.transcriptRef===transcriptRef&&e.perceptions.some(p=>p.observer.captureRef===observerRef&&p.coverage==='full'&&p.authorizedTextRef===transcriptRef)) return e.transcript; return null; }
  expire() {
    const now=this.now();
    for(const [key,e] of this.entries) if(e.transcript.expiresAtMonotonicMs<=now) {this.entries.delete(key);this.bytes-=e.bytes;this.bump('expired');}
    for(const [key,e] of this.suppression) if(e.expires<=now) this.suppression.delete(key);
    for(const [key,e] of this.seenUtterances) if(e.expires<=now) this.seenUtterances.delete(key);
    for(const [key,e] of this.conversations) if(e.expires<=now) this.conversations.delete(key);
  }
  bump(name) { this.diagnostics[name]=Math.min(2147483647,this.diagnostics[name]+1); }
  clear() { this.entries.clear();this.suppression.clear();this.seenUtterances.clear();this.conversations.clear();this.watermarks.clear();this.bytes=0; }
}

function covers(intervals,duration) {
  let covered=0;
  for(const i of [...intervals].sort((a,b)=>a.start-b.start)) { if(i.start>covered) return false; covered=Math.max(covered,i.end); if(covered>=duration) return true; }
  return false;
}
function fingerprint(text) { return createHash('sha256').update(text,'utf8').digest('hex'); }

function addressHints(text, knownNames) {
  const group=/\byou\s+(?:guys|all|both)\b/i.exec(text);
  const nameSpans=[];
  for(const name of knownNames.slice(0,16)) {
    if(typeof name!=='string'||name.length<2||name.length>64) continue;
    const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const match=new RegExp(`\\b${escaped}\\b`,'ig').exec(text);
    if(match&&nameSpans.length<4) nameSpans.push({start:match.index,end:match.index+match[0].length});
  }
  if(group) return {nameSpans,hint:'group_candidate',basisCodes:['explicit_group_wording'],groupSpan:{start:group.index,end:group.index+group[0].length}};
  if(nameSpans.length) return {nameSpans,hint:'unresolved',basisCodes:['explicit_name_span']};
  return null;
}

export const SPEECH_STORE_BOUNDS = Object.freeze({ transcripts: MAX_TRANSCRIPTS, transcriptBytes: MAX_TEXT_BYTES, totalBytes: MAX_TEXT_TOTAL, suppression: DEDUPE_LIMIT, suppressionTtlMs: DEDUPE_TTL_MS });
