// M6 committed-journal cursor reader. P2 owns ALL SQLite writes and cursors.
// A page is a source-verified, append-ordered P2 projection, not a PS3/model feed.
import {createHash} from 'node:crypto';
import {isUuid,scopeOf} from './evidence.mjs';

const fail=code=>{throw new Error(code);};
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/i.test(v);
const cursor=v=>v===null||typeof v==='string'&&v.length>0&&v.length<=160;
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const M6_CURSOR_CONTRACT_VERSION=1;

/**
 * Required P2 cursor interface (single SQLite owner, same serialized gate):
 * readM6Checkpoint({scope}) ->
 *   {version:1,cursor:string|null,activeHourCount:number,hourBucket?:string}
 * readM6JournalPage({scope,afterCursor,limit}) ->
 *   {rows:[{cursor:string,sourceHash:sha256(JSON.stringify(evidence)),
 *            evidence:committedJournalEnvelope}],hasMore:boolean}
 * ackM6Checkpoint({scope,expectedCursor,nextCursor,sourceHashes,
 *   savedProposalIds,rejected,cutoffUtc,hourBucket,cloudQueueEnabled}) ->
 *   {committed:true,cursor:nextCursor}
 *
 * P2 must compare-and-swap the cursor under its checked timeline transaction,
 * confirm every saved proposal and (if enabled) queue job before advancing,
 * persist source hashes and rejection diagnostics, and carry the next
 * active-hour admission count. This module never writes a separate checkpoint.
 * Cursor is an opaque, monotonically append-ordered SQLite sequence token;
 * source timestamps NEVER serve as a cursor.
 */
export function requireM6CursorStore(store){
  for(const name of ['readM6Checkpoint','readM6JournalPage','ackM6Checkpoint']){
    if(typeof store?.[name]!=='function')throw new TypeError('m6_durable_cursor_required_'+name);
  }
  return store;
}
export function createM6CursorConsumer({store,pageSize=250,maxRows=8192,maxPages=64}={}){
  requireM6CursorStore(store);
  if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>1000||
     !Number.isSafeInteger(maxRows)||maxRows<pageSize||maxRows>65536||
     !Number.isSafeInteger(maxPages)||maxPages<1||maxPages>512)
    throw new TypeError('m6_invalid_cursor_limits');
  async function readBatch({scope,cutoffUtc}={}){
    scopeOf(scope);
    if(typeof cutoffUtc!=='string'||!Number.isFinite(Date.parse(cutoffUtc)))
      fail('m6_invalid_cutoff');
    const cp=await store.readM6Checkpoint({scope});
    if(cp?.version!==1||!cursor(cp.cursor)||
       !Number.isSafeInteger(cp.activeHourCount)||cp.activeHourCount<0)
      fail('m6_invalid_p2_checkpoint');
    const rows=[],rejected=[],sourceHashes=[],seen=new Map();
    let after=cp.cursor,pagesRead=0,hasMore=false,blockedByQuiet=false;
    let priorSourceTime=cp.lastSourceUtc?Date.parse(cp.lastSourceUtc):null;
    if(cp.lastCutoffUtc&&Date.parse(cutoffUtc)<Date.parse(cp.lastCutoffUtc))
      fail('m6_source_clock_regression');
    do{
      // A bounded scan is a checkpointable PREFIX, not an overflowed latest-N snapshot.
      // The next invocation resumes after the durable CAS, preserving all backlog.
      if(pagesRead>=maxPages||rows.length>=maxRows){hasMore=true;break;}
      const requestedLimit=Math.min(pageSize,maxRows-rows.length);
      const page=await store.readM6JournalPage({scope,afterCursor:after,
        limit:requestedLimit});
      pagesRead++;
      if(!page||!Array.isArray(page.rows)||page.rows.length>requestedLimit||
         typeof page.hasMore!=='boolean'||(page.hasMore&&page.rows.length===0))
        fail('m6_invalid_p2_page');
      hasMore=page.hasMore;
      for(const entry of page.rows){
        if(!cursor(entry?.cursor)||entry.cursor===null||!hex(entry.sourceHash)||
           !entry.evidence||!isUuid(entry.evidence.recordId)||
           entry.evidence.characterId!==scope.characterId||
           entry.evidence.worldProfileId!==scope.worldProfileId||
           entry.evidence.timelineId!==scope.timelineId)
          fail('m6_untrusted_cursor_row');
        if(digest(entry.evidence)!==entry.sourceHash)
          fail('m6_cursor_source_hash_mismatch');
        const previous=seen.get(entry.cursor);
        if(previous!==undefined)fail('m6_cursor_duplicate_sequence');
        seen.set(entry.cursor,entry.sourceHash);
        const evidence=entry.evidence;
        const stamp=evidence.kind==='journal_event'?evidence.receivedAtUtc:
          evidence.kind==='dialogue_line'?evidence.committedAtUtc:null;
        // No timestamp means unqualified evidence, not a justified scene.
        // P2 stores its audited rejection when the cursor commits.
        if(typeof stamp==='string'&&Number.isFinite(Date.parse(stamp))&&
           Date.parse(stamp)>Date.parse(cutoffUtc)){
          blockedByQuiet=true;hasMore=true;break;
        }
        if(typeof stamp==='string'&&Number.isFinite(Date.parse(stamp))){
          const sourceTime=Date.parse(stamp);
          if(priorSourceTime!==null&&sourceTime<priorSourceTime)
            fail('m6_source_clock_regression');
          priorSourceTime=sourceTime;
        }
        rows.push(evidence);
        sourceHashes.push(Object.freeze({cursor:entry.cursor,sourceHash:entry.sourceHash,
          recordId:evidence.recordId}));
        after=entry.cursor;
        // maxRows is enforced by the requested page limit, never by discard.
      }
      if(blockedByQuiet)break;
      // A full page is not proof that the archive ends. Respect hasMore.
    }while(hasMore);
    return Object.freeze({checkpoint:cp,fromCursor:cp.cursor,toCursor:after,
      rows:Object.freeze(rows),rejected:Object.freeze(rejected),
      lastSourceUtc:priorSourceTime===null?cp.lastSourceUtc??null:new Date(priorSourceTime).toISOString(),
      sourceHashes:Object.freeze(sourceHashes),
      atEnd:!hasMore,blockedByQuiet,pagesRead});
  }
  return Object.freeze({readBatch});
}
