import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForMemorySource} from '../../src/memory/waitForMemorySource.mjs';
test('waits for fresh evidence, consumes the existing deadline and grants nothing after cancellation',async()=>{
  let clock=0,checks=0;
  const options={now:()=>clock,sleep:async ms=>{clock+=ms;},isCurrent:()=>true,deadlineAt:200,maxWaitMs:5000,pollMs:25};
  assert.equal(await waitForMemorySource({...options,ready:()=>++checks===4}),true);
  assert.equal(clock,75);
  clock=0;
  assert.equal(await waitForMemorySource({...options,ready:()=>false}),false);
  assert.equal(clock,200);
  const abort=new AbortController();abort.abort();
  assert.equal(await waitForMemorySource({...options,signal:abort.signal,ready:()=>{throw Error('must not check after abort');}}),false);
  assert.equal(await waitForMemorySource({...options,isCurrent:()=>false,ready:()=>true}),false);
});
