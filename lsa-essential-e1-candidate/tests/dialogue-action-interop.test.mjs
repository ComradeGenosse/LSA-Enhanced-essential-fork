import test from 'node:test';
import assert from 'node:assert/strict';
import {testDialogueActionsInterop} from '../tools/testDialogueActionsInterop.mjs';
test('real Windows C05 pipe preserves ordinary/owned handler evidence and resets on reconnect',{skip:process.platform!=='win32'},async()=>{
 const result=await testDialogueActionsInterop();assert.equal(result.passed,66);assert.equal(result.peerRejections,5);assert.equal(result.orderingFaults,2);assert.equal(result.physicalAcceptance,false);assert.equal(result.dispatched,false);assert.equal(result.gameAssembliesExecuted,false);
});
