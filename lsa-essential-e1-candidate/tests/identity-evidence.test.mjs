import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { OwnerEvidence } from '../src/identity/ownerEvidence.mjs';
import { normalizeIdentityConfig } from '../src/identity/identityContract.mjs';
import { claim, worldProfileId } from './identity-fixtures.mjs';

function peer({ greeting = null, respond } = {}) {
  const proof = claim(), messages = [];
  let socket;
  const config = normalizeIdentityConfig({ enabled:true,worldProfileId,prepareTimeoutMs:100 });
  const connect = () => {
    socket = new EventEmitter(); socket.destroyed = false; socket.unref = () => {};
    socket.destroy = () => { if (!socket.destroyed) { socket.destroyed = true; socket.emit('close'); } };
    socket.deliver = message => socket.emit('data',Buffer.from(JSON.stringify(message)+'\n'));
    socket.write = line => {
      const request = JSON.parse(line); messages.push(request);
      queueMicrotask(() => respond ? respond(request,socket,proof) : socket.deliver({ schemaVersion:1,type:'proof',adapterEpoch:proof.adapterEpoch,
        requestId:request.requestId,pedId:request.pedId,status:'active',claim:{...proof,observationSequence:2} }));
    };
    queueMicrotask(() => socket.deliver(greeting || { schemaVersion:1,type:'hello',adapterEpoch:proof.adapterEpoch,sourceNamespace:'comrade.authored' }));
    return socket;
  };
  const evidence = new OwnerEvidence(config,{platform:'win32',connect});
  return { evidence,proof,messages,get socket() { return socket; } };
}

test('owner proof is request-correlated over the configured fact channel; JSON block alone never authenticates', async t => {
  const p = peer(); t.after(() => p.evidence.close());
  const result = await p.evidence.verify('17',p.proof,new AbortController().signal);
  assert.equal(result.kind,'verified'); assert.equal(p.evidence.isCurrent(result.claim),true);
  assert.deepEqual(Object.keys(p.messages[0]).sort(),['pedId','requestId','schemaVersion','type']);
  assert.equal(p.messages[0].type,'verify');
});

test('old epoch/incarnation/revision revocations cannot invalidate fresh owner proof', async t => {
  const p = peer(), facts = []; t.after(() => p.evidence.close()); p.evidence.subscribe(fact => facts.push(fact));
  const result = await p.evidence.verify('17',p.proof,new AbortController().signal);
  p.socket.deliver({ schemaVersion:1,type:'revoke',adapterEpoch:claim().incarnationId,pedId:'17',incarnationId:p.proof.incarnationId,claimRevision:1 });
  p.socket.deliver({ schemaVersion:1,type:'revoke',adapterEpoch:p.proof.adapterEpoch,pedId:'17',incarnationId:claim().incarnationId,claimRevision:1 });
  p.socket.deliver({ schemaVersion:1,type:'revoke',adapterEpoch:p.proof.adapterEpoch,pedId:'17',incarnationId:p.proof.incarnationId,claimRevision:2 });
  assert.equal(p.evidence.isCurrent(result.claim),true);
  assert.equal(facts.some(fact => fact.type === 'lost'),false);
  p.socket.deliver({ schemaVersion:1,type:'revoke',adapterEpoch:p.proof.adapterEpoch,pedId:'17',incarnationId:p.proof.incarnationId,claimRevision:1 });
  assert.equal(p.evidence.isCurrent(result.claim),false);
});

test('wrong request/ped response cannot publish; disconnect invalidates the captured owner epoch', async t => {
  const p = peer({ respond(request,socket,proof) {
    socket.deliver({ schemaVersion:1,type:'proof',adapterEpoch:proof.adapterEpoch,requestId:claim().incarnationId,pedId:request.pedId,status:'active',claim:proof });
    socket.deliver({ schemaVersion:1,type:'proof',adapterEpoch:proof.adapterEpoch,requestId:request.requestId,pedId:'92',status:'active',claim:proof });
  } }); t.after(() => p.evidence.close());
  const result = await p.evidence.verify('17',p.proof,new AbortController().signal);
  assert.equal(result.kind,'unavailable'); assert.equal(p.evidence.isCurrent(p.proof),false);
});

test('unsupported owner namespace/version fails ordinary evidence closed', async t => {
  for (const fields of [{sourceNamespace:'pr.records'},{schemaVersion:2}]) {
    const p = peer({greeting:{schemaVersion:1,type:'hello',adapterEpoch:claim().adapterEpoch,sourceNamespace:'comrade.authored',...fields}});
    t.after(() => p.evidence.close());
    assert.equal((await p.evidence.verify('17',p.proof,new AbortController().signal)).kind,'unavailable');
  }
});

test('oversized/unknown fact frames close evidence without invoking gameplay authority', async t => {
  for (const malformed of ['x'.repeat(4097)+'\n',JSON.stringify({schemaVersion:1,type:'action',adapterEpoch:claim().adapterEpoch,command:'DO Attack'})+'\n']) {
    const p = peer(); t.after(() => p.evidence.close()); await p.evidence.verify('17',p.proof,new AbortController().signal);
    p.socket.emit('data',Buffer.from(malformed));
    assert.equal(p.evidence.isCurrent(p.proof),false);
  }
});

test('aborted or non-Windows evidence verification stays ephemeral without connecting', async () => {
  let connections = 0;
  const evidence = new OwnerEvidence(normalizeIdentityConfig({enabled:true,worldProfileId}),{platform:'linux',connect:() => { connections++; throw new Error(); }});
  const abort = new AbortController(); abort.abort();
  assert.equal((await evidence.verify('17',claim(),abort.signal)).kind,'unavailable');
  assert.equal(connections,0); evidence.close();
});

test('a silent owner loses its lease; a heartbeat from an old epoch cannot renew it', async t => {
  const p = peer(), facts = []; t.after(() => p.evidence.close());
  p.evidence.subscribe(fact => facts.push(fact));
  const result = await p.evidence.verify('17',p.proof,new AbortController().signal);
  await new Promise(resolve => setTimeout(resolve,900));
  p.socket.deliver({schemaVersion:1,type:'heartbeat',adapterEpoch:claim().incarnationId});
  await new Promise(resolve => setTimeout(resolve,750));
  assert.equal(p.evidence.isCurrent(result.claim),false);
  assert.equal(p.socket.destroyed,true);
  assert.deepEqual(facts.filter(fact => fact.type === 'lost'),[{type:'lost',adapterEpoch:p.proof.adapterEpoch}]);
});
