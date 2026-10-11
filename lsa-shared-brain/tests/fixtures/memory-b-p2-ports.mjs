// Agent B typed mock contract for F/G/H/K adapter development.
// THIS IS NOT durable SQLite, native authority, or proof of witnessing.
// Runtime code must use createP2MemoryStorage and its real P2 ports.
export const P2_MEMORY_PORT_V1=Object.freeze({
  scope:Object.freeze(['worldProfileId','characterId','timelineId','protagonistKey']),
  pageRequest:Object.freeze(['scope','cursor','limit']),
  pageResponse:Object.freeze(['version','scope','cursor','fromCursor','lastSequence',
    'scannedCount','items','rejected','skipped','hasMore','status']),
  pageItem:Object.freeze(['kind','sequence','recordId','envelope']),
  eventExtra:Object.freeze(['sourceEvidence']),
  checkpointRequest:Object.freeze(['scope','consumerId','cursor','expectedCursor']),
  privacyPorts:Object.freeze(['ready','inspect','exportArchive','trash','trashScope',
    'restore','purgeExpired','verifyPrivacy','bindCommands'])
});

/** Small synchronous-in-memory *mock*, not production storage.
 * F/G/H can feed scripted envelopes and rejection/skip fixtures without
 * guessing SQL access or editing Agent B files. The cursor is opaque.
 */
export function createMockP2ReplayPort({scope,pages=[]}={}){
  if(!scope || !Array.isArray(pages))throw new TypeError('invalid_p2_replay_fixture');
  const deep=value=>JSON.parse(JSON.stringify(value));
  const clone=deep(scope);
  let acknowledged=0;
  const check=s=>{
    if(!s||P2_MEMORY_PORT_V1.scope.some(key=>s[key]!==clone[key]))
      throw new Error('p2_replay_invalid_scope');
  };
  const token=index=>'mock-replay-token-'+index;
  const decode=opaque=>{
    if(opaque===null||opaque===undefined)return 0;
    const n=Number(opaque.slice('mock-replay-token-'.length));
    if(opaque!==token(n)||!Number.isSafeInteger(n)||n<0||n>pages.length)
      throw new Error('p2_replay_invalid_cursor');
    return n;
  };
  return Object.freeze({
    worldProfileId:scope.worldProfileId,
    activeTimelineId:scope.timelineId,
    timelineWritable:true,
    get:characterId=>characterId===scope.characterId?{characterId}:null,
    async readCommittedEvidenceCursor({scope:s,consumerId}){
      check(s);
      if(typeof consumerId!=='string'||!consumerId)throw new Error('p2_replay_invalid_consumer');
      return {cursor:token(acknowledged),lastSequence:acknowledged,consumerId};
    },
    async readCommittedEvidencePage({scope:s,cursor=null,limit=256}){
      check(s);const n=decode(cursor);
      if(!Number.isSafeInteger(limit)||limit<1||limit>512)throw new Error('p2_replay_invalid_limit');
      const fixture=pages[n]??{items:[],rejected:[],skipped:[],hasMore:false};
      const items=deep(fixture.items??[]),rejected=deep(fixture.rejected??[]),
        skipped=deep(fixture.skipped??[]);
      if(items.length+rejected.length+skipped.length>limit)throw new Error('p2_replay_fixture_page_overflow');
      return {version:1,scope:deep(scope),cursor:token(Math.min(n+1,pages.length)),
        fromCursor:token(n),lastSequence:n+1,scannedCount:items.length+rejected.length+skipped.length,
        items,rejected,skipped,hasMore:fixture.hasMore??n+1<pages.length,
        status:rejected.length?'incomplete_evidence':'complete'};
    },
    async ackCommittedEvidenceCursor({scope:s,consumerId,cursor,expectedCursor=null}){
      check(s);
      if(typeof consumerId!=='string'||!consumerId)throw new Error('p2_replay_invalid_consumer');
      const request=decode(cursor),expected=decode(expectedCursor);
      if(request===acknowledged)return {committed:true,idempotent:true,cursor:token(acknowledged)};
      if(expected!==acknowledged||request>pages.length||request!==acknowledged+1)
        throw new Error('p2_replay_cursor_conflict');
      acknowledged=request;
      return {committed:true,idempotent:false,cursor:token(acknowledged)};
    }
  });
}
