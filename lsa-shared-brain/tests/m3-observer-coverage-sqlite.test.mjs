// WS-5b / K-13: durable observer-coverage ledger semantics (OFFLINE TESTED, raw SQLite).
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {ensureM3CoverageSchema,upsertObserverCoverage,sealStaleObserverCoverage,
  readObserverCoverage,readM3Coverage} from '../src/events/m3CoverageSqlite.mjs';
import {createM3ObserverCoverageTracker} from '../src/events/m3ObserverCoverageTracker.mjs';

const world=randomUUID(),timeline=randomUUID();
const LEGACY_DDL=`
CREATE TABLE m3_coverage (
 world_profile_id TEXT NOT NULL,
 timeline_id TEXT NOT NULL REFERENCES timelines(timeline_id) ON DELETE CASCADE,
 character_id TEXT NOT NULL REFERENCES promoted_profiles(character_id) ON DELETE CASCADE,
 observation_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('did_not_witness','unknown','unavailable')),
 evidence_json TEXT NOT NULL, evidence_hash TEXT NOT NULL,
 PRIMARY KEY(world_profile_id,timeline_id,character_id,observation_id)
);
CREATE INDEX m3_coverage_scope ON m3_coverage(world_profile_id,character_id,timeline_id,status);`;
function db() {
  const d=new DatabaseSync(':memory:');
  d.exec('PRAGMA foreign_keys=ON');
  d.exec('CREATE TABLE timelines(timeline_id TEXT PRIMARY KEY)');
  d.exec('CREATE TABLE promoted_profiles(character_id TEXT PRIMARY KEY)');
  d.prepare('INSERT INTO timelines VALUES (?)').run(timeline);
  return d;
}
const iso=ms=>new Date(Date.UTC(2026,9,13,12)+ms).toISOString();

test('legacy m3_coverage with ON DELETE CASCADE to promoted_profiles is repaired, keeping its rows',()=>{
  const d=db();
  d.exec(LEGACY_DDL);
  const character=randomUUID();
  d.prepare('INSERT INTO promoted_profiles VALUES (?)').run(character);
  d.prepare("INSERT INTO m3_coverage VALUES (?,?,?,?,'unknown','{}','h')").run(world,timeline,character,randomUUID());
  ensureM3CoverageSchema(d);
  ensureM3CoverageSchema(d);                       // idempotent
  assert.equal(d.prepare('SELECT COUNT(*) n FROM m3_coverage').get().n,1,'rows survive the rebuild');
  const fk=d.prepare("PRAGMA foreign_key_list('m3_coverage')").all().map(f=>f.table);
  assert.deepEqual(fk,['timelines'],'no profile foreign key remains');
  // The bug: P2 rewrites profile rows on every edit (delete+insert of promoted_profiles).
  d.prepare('DELETE FROM promoted_profiles WHERE character_id=?').run(character);
  d.prepare('INSERT INTO promoted_profiles VALUES (?)').run(character);
  assert.equal(d.prepare('SELECT COUNT(*) n FROM m3_coverage').get().n,1,'a profile rewrite no longer wipes coverage');
});

test('a fresh database gets the same repaired shape',()=>{
  const d=db();ensureM3CoverageSchema(d);
  assert.deepEqual(d.prepare("PRAGMA foreign_key_list('m3_coverage')").all().map(f=>f.table),['timelines']);
  assert.deepEqual(d.prepare("PRAGMA foreign_key_list('m3_observer_coverage')").all().map(f=>f.table),['timelines']);
  assert.equal(readM3Coverage(d,{characterId:randomUUID(),worldProfileId:world,timelineId:timeline,
    observationId:randomUUID()}).status,'unknown','absence of data is unknown, never a negative');
});

// Run the real tracker and persist its ops through the real SQL functions.
function rig(processId=randomUUID(),d=null) {
  d??=db();ensureM3CoverageSchema(d);
  const clock={ms:50_000};let tick=clock.ms;
  const alias='promoted.'+randomUUID(),character={characterId:randomUUID(),promotion:{ownerAlias:alias}};
  const owner={ownerAlias:alias,observerCaptureRef:randomUUID(),incarnationId:randomUUID(),encounterId:randomUUID()};
  const ids={streamId:randomUUID(),adapterEpoch:randomUUID(),hostRunId:randomUUID()};
  let seq=0;
  const sent=[];
  const tracker=createM3ObserverCoverageTracker({worldProfileId:world,processId,
    resolveCharacter:a=>a===alias?character:null,activeTimeline:()=>timeline,
    monotonicNow:()=>clock.ms,utcNow:()=>iso(clock.ms),
    persist:async ops=>{
      d.exec('BEGIN');
      try{
        for(const op of ops){if(op.record)sent.push(op.record);}
        for(const op of ops)op.seal?sealStaleObserverCoverage(d,op.seal):upsertObserverCoverage(d,op.record);
        d.exec('COMMIT');
      }catch(e){d.exec('ROLLBACK');throw e;}
      return {staleIndexes:[]};
    }});
  const frames=n=>{for(let i=0;i<n;i++){clock.ms+=250;tick+=250;
    tracker.sample({...ids,worldEpoch:1,sequence:++seq,sampledGameTick:tick,owners:[owner]});}};
  const read=(from,to)=>readObserverCoverage(d,{characterId:character.characterId,worldProfileId:world,
    timelineId:timeline,fromUtc:iso(from),toUtc:iso(to)});
  return {d,tracker,frames,read,clock,character,sent,get tick(){return tick;}};
}

test('a window is certified only up to its persisted (settled) end; the rest is uncovered',async()=>{
  const r=rig();
  r.frames(60);                                   // 15 s
  await r.tracker.idle();
  const cov=r.read(50_000,r.clock.ms);
  assert.equal(cov.complete,false);
  assert.equal(cov.basis,'authenticated_owner_frames');
  assert.ok(cov.coveredMs>=10_000&&cov.coveredMs<=12_000,String(cov.coveredMs));
  const settled=r.read(50_250,r.clock.ms-3500);
  assert.equal(settled.complete,true,JSON.stringify(settled.gaps));
  const tail=cov.gaps.at(-1);
  assert.equal(tail.kind,'uncovered');
  assert.equal(tail.toUtc,iso(r.clock.ms));
});

test('a crashed process leaves an open window; the next process seals it at its last checkpoint',async()=>{
  const first=rig();
  first.frames(60);
  await first.tracker.idle();                     // "crash": no retire/close
  const checkpoint=first.read(50_000,first.clock.ms).windows[0];
  assert.equal(checkpoint.status,'open');
  const second=rig(randomUUID(),first.d);          // new process, same database
  second.frames(1);
  await second.tracker.idle();
  const sealed=readObserverCoverage(first.d,{characterId:first.character.characterId,worldProfileId:world,
    timelineId:timeline,fromUtc:iso(50_000),toUtc:iso(first.clock.ms)}).windows[0];
  assert.equal(sealed.status,'closed');
  assert.equal(sealed.closeReason,'process_restart');
  assert.equal(sealed.endUtc,checkpoint.endUtc,'nothing after the last durable checkpoint is claimed');
});

test('upsert is idempotent, closed is sticky, identity conflicts are rejected, the frontier never retreats',async()=>{
  const r=rig();
  r.frames(40);
  await r.tracker.idle();
  r.tracker.retire('host_disconnected');
  await r.tracker.idle();
  assert.equal(r.d.prepare("SELECT status FROM m3_observer_coverage WHERE kind='window'").get().status,
    'open','revoked source cannot write the closing status');
  r.frames(1); // fresh authenticated frame on the same currently selected timeline
  await r.tracker.idle();
  const row=r.d.prepare("SELECT * FROM m3_observer_coverage WHERE kind='window'").get();
  assert.equal(row.status,'closed');
  assert.equal(row.close_reason,'host_disconnected');
  const first=r.sent.find(x=>x.kind==='window');
  const base={...first,status:'open',closeReason:null,endTick:first.startTick,endUtc:first.startUtc,frames:1,
    lastSequence:first.firstSequence};
  const again=upsertObserverCoverage(r.d,{...base});
  assert.equal(again.duplicate||again.updated===false,true);
  const after=r.d.prepare("SELECT * FROM m3_observer_coverage WHERE coverage_id=?").get(row.coverage_id);
  assert.equal(after.status,'closed','closed is sticky');
  assert.equal(after.close_reason,'host_disconnected','first close reason wins');
  assert.equal(after.end_tick,row.end_tick,'the frontier never retreats');
  assert.throws(()=>upsertObserverCoverage(r.d,{...base,startTick:base.startTick+1}),/m3_observer_coverage_/);
});

test('coverage is per character and timeline; unknown scope reads as fully uncovered',()=>{
  const r=rig();
  const other=readObserverCoverage(r.d,{characterId:randomUUID(),worldProfileId:world,timelineId:timeline,
    fromUtc:iso(0),toUtc:iso(10_000)});
  assert.equal(other.complete,false);
  assert.equal(other.coveredMs,0);
  assert.equal(other.gaps.length,1);
  assert.equal(other.gaps[0].reason,'no_authenticated_coverage');
  assert.throws(()=>readObserverCoverage(r.d,{characterId:'x',worldProfileId:world,timelineId:timeline,
    fromUtc:iso(0),toUtc:iso(1)}),/m3_observer_coverage_invalid_scope/);
});
