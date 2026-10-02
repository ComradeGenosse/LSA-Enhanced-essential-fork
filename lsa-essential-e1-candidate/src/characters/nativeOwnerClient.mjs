import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { isUuid, exactObject } from '../identity/identityContract.mjs';
export const OWNER_OPERATIONS = new Set(['capture','register','inspect','spawn','follow','wait','dismiss','despawn','release','roster']);
export class NativeOwnerClient {
  constructor({ pipeName,worldProfileId,timeoutMs = 3000 }) { this.pipeName = pipeName; this.worldProfileId = worldProfileId; this.timeoutMs = timeoutMs; }
  request(operation,args = {}) {
    if (!OWNER_OPERATIONS.has(operation)) return Promise.reject(new Error('invalid_owner_operation'));
    if (Buffer.byteLength(JSON.stringify(args)) > 16384) return Promise.reject(new Error('owner_request_limit'));
    return new Promise((resolve,reject) => {
      const requestId = randomUUID(); let buffer = Buffer.alloc(0),sent = false,settled = false;
      const socket = net.createConnection(`\\\\.\\pipe\\${this.pipeName}`);
      const finish = (error,result) => { if (settled) return; settled = true; clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(result); };
      const timer = setTimeout(() => finish(new Error('owner_unavailable')),this.timeoutMs);
      socket.on('error',() => finish(new Error('owner_unavailable')));
      socket.on('close',() => { if (!settled) finish(new Error('owner_unavailable')); });
      socket.on('data',chunk => {
        buffer = Buffer.concat([buffer,chunk]);
        if (buffer.length > 32768) return finish(new Error('invalid_owner_response'));
        let boundary;
        while ((boundary = buffer.indexOf(10)) >= 0) {
          const line = buffer.subarray(0,boundary).toString('utf8'); buffer = buffer.subarray(boundary + 1);
          let value; try { value = JSON.parse(line); } catch { return finish(new Error('invalid_owner_response')); }
          if (!sent) {
            if (!exactObject(value,['version','type','worldProfileId','ownerEpoch']) || value.version !== 1 || value.type !== 'hello' || value.worldProfileId !== this.worldProfileId || !isUuid(value.ownerEpoch)) return finish(new Error('invalid_owner_response'));
            sent = true;
            const frame = JSON.stringify({ version:1,requestId,worldProfileId:this.worldProfileId,ownerEpoch:value.ownerEpoch,operation,args,expiresAtUtc:Date.now() + this.timeoutMs - 100 });
            if (Buffer.byteLength(frame) > 16384) return finish(new Error('owner_request_limit'));
            socket.write(frame + '\n');
          } else {
            if (!exactObject(value,['version','requestId','status','result','reason']) || value.version !== 1 || value.requestId !== requestId || !['ok','failed'].includes(value.status)) return finish(new Error('invalid_owner_response'));
            if (value.status !== 'ok') return finish(new Error(/^[a-z][a-z0-9_]{0,63}$/.test(value.reason) ? value.reason : 'owner_unavailable'));
            finish(null,value.result);
          }
        }
      });
    });
  }
}
