import {createHash} from 'node:crypto';

// Stable, non-reversible 40-bit correlation code shared by the companion JSONL
// telemetry and the native RAGE log (IntelligenceIntegration.TraceCode uses the
// identical algorithm). The input is a random per-event signal ID or a random
// per-attempt Director ticket ID: neither the raw ID nor any actor, ped,
// capture reference, transcript or model content is ever persisted.
export const TRACE_CODE_PATTERN=/^[0-9a-f]{10}$/;
export function traceCode(id) {
  if(typeof id!=='string' || id.length<1 || id.length>128) return null;
  return createHash('sha256').update('lsa-trace-v1:'+id,'utf8').digest('hex').slice(0,10);
}
