// M1 fail-closed timeline gate; never guesses the correct GTA save lineage.
import { isUuid } from '../identity/identityContract.mjs';
const freeze = value => Object.freeze(value);
export class TimelineGuard {
  #selected=null; #pendingReason='selection_required';
  constructor({timelineId=null}={}){
    if(timelineId!==null&&!isUuid(timelineId))throw new TypeError('invalid_timeline');
    if(timelineId){this.#selected=timelineId;this.#pendingReason=null;}
  }
  get activeTimelineId(){return this.#selected;}
  get writable(){return !!this.#selected&&!this.#pendingReason;}
  get pendingReason(){return this.#pendingReason;}
  onBoundary({reason}={}){
    if(reason==='clock_regression'||reason==='timeline_change')this.#pendingReason=reason;
    else if(reason!=='host_reload')throw new TypeError('invalid_timeline_boundary');
    return freeze({writable:this.writable,pendingReason:this.#pendingReason,activeTimelineId:this.#selected});
  }
  selectTimeline(timelineId){
    if(!isUuid(timelineId))throw new TypeError('invalid_timeline');
    this.#selected=timelineId;this.#pendingReason=null;
    return this.#selected;
  }
  assertWrite(timelineId){
    if(!this.writable||timelineId!==this.#selected)throw new Error('timeline_write_suspended');
  }
}

const knownProtagonists=new Set(['franklin','michael','trevor']);
export function durableSubjectRef({kind,key,sceneId=null}={}){
  if(kind==='self')return freeze({kind:'self',key:'self'});
  if(kind==='protagonist'&&knownProtagonists.has(key))return freeze({kind,key});
  if(kind==='character'&&isUuid(key))return freeze({kind,key});
  // Anonymous subjects are scene-local labels, not enduring identities.
  if(['stranger','vehicle','unresolved_player'].includes(kind)&&isUuid(sceneId)&&
    typeof key==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(key))return freeze({kind,key,sceneId});
  return null;
}
