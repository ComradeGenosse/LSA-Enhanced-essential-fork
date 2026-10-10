import { ActivityClient } from './activityClient.mjs';
import { ActivityEngine } from './activityEngine.mjs';
import {DialogueActionReceipts} from './dialogueActionReceipts.mjs';
import {validateDialogueActionReceipt} from './dialogueActionContract.mjs';
import {sameHostContext} from '../context/hostContext.mjs';

// Thin shell: the pipe stays transport, and the engine owns the plan.
export class ActivityRuntime {
  constructor(config, options = {}) {
    this.now=options.now??(()=>Date.now());this.dialogueReceipts=new DialogueActionReceipts();
    this.engine = new ActivityEngine({
      config, registry: options.registry, now: options.now, id: options.id, onEvent: options.onEvent || (() => {}),
      onCommand: frame => this.client?.send(frame),
    });
    this.client = new ActivityClient(config, { ...options, onFrame: frame => {this.#ingestDialogue(frame);this.engine.ingest(frame);options.onFrame?.(frame);}, onEvent: options.onEvent });
  }
  #ingestDialogue(frame){
    if(frame.type==='hello' || frame.type==='world_epoch'){this.dialogueReceipts.reset();return;}
    if(frame.type==='lease.changed' && frame.reason==='retired'){this.dialogueReceipts.retireEncounter(frame.encounterId);return;}
    if(frame.type!=='dialogue.action.receipt')return;
    const current=this.client.runtime;
    if(!validateDialogueActionReceipt(frame) || !current.ready || current.dialogueActionVersion!==1 || frame.nativeRun!==current.nativeRun || frame.adapterEpoch!==current.adapterEpoch || !sameHostContext(frame.binding.hostContext,current.hostContext))return;
    this.dialogueReceipts.callback({...frame,receivedAtMs:this.now()});
  }
  recordDialogueActionPublication(input){
    const current=this.client.runtime;
    if(!current.ready || current.dialogueActionVersion!==1 || !sameHostContext(input?.binding?.hostContext,current.hostContext))return null;
    const row=this.dialogueReceipts.publish(input);if(!row || row.state)return row;
    try{if(!this.client.sendDialogueAnnotation(row))this.dialogueReceipts.invalidateCallbacks('annotation_failed');}
    catch{this.dialogueReceipts.invalidateCallbacks('annotation_failed');}
    return row;
  }
  readDialogueActionReceipts(binding){return this.client.runtime.ready && this.client.runtime.dialogueActionVersion===1 && sameHostContext(binding?.hostContext,this.client.runtime.hostContext)?this.dialogueReceipts.read(binding):Object.freeze([]);}
  start() {
    this.client.start();
    if (!this.pulse) {
      this.pulse = setInterval(() => { try { this.engine.tick(); } catch {} }, 100);
      this.pulse.unref?.();
    }
  }
  stop() {
    clearInterval(this.pulse); this.pulse = null;
    this.dialogueReceipts.reset();
    try { this.engine.clockReset(); } catch {}
    this.client.stop();
  }
  factsForCharacter(binding) {return this.engine.factsForCharacter(binding);}
  status(characterId) { return this.engine.status(characterId); }
  pause(characterId) { return this.engine.pause(characterId); }
  resume(characterId) { return this.engine.resume(characterId); }
  cancel(characterId) { return this.engine.cancel(characterId); }
  assign(proposal, binding) { return this.engine.assign(proposal, binding); }
  history(characterId) { return this.engine.historyFor(characterId); }
}
