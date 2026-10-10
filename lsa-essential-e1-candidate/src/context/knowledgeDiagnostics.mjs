// Bounded numeric-only observability for a single frozen PS4 turn.
// Never persist claim contents, actor IDs, capture references or salience keys.
export function summarizeKnowledgeSelection(inputs,frame) {
  const pairs=Array.isArray(inputs?.pairs)?inputs.pairs.slice(0,128):[];
  const counts={
    captureAnchorStatus:inputs?.anchorStatus??'unknown',
    captureEventFiring:0,captureEventDeath:0,captureEventImpact:0,
    captureEventInjury:0,captureEventOther:0,
    captureContextOmit:0,captureContextCandidate:0,
    captureContextMustInclude:0,captureResponseEligible:0,
    captureResponseUrgent:0,
    perceivedUnsupportedClaims:0,perceivedRevisionMismatch:0,
    perceivedUnmatchedSalience:0,perceivedBudgetExcluded:0,
    perceivedSafetyOverflow:0,
  };
  for(const pair of pairs) {
    const event=pair?.observation?.eventType;
    const group=event==='firing_burst'?'captureEventFiring':
      ['death_seen','body_found'].includes(event)?'captureEventDeath':
      event==='vehicle_impact'?'captureEventImpact':
      event==='injury'?'captureEventInjury':'captureEventOther';
    counts[group]++;
    const context=pair?.decision?.context;
    if(context==='omit')counts.captureContextOmit++;
    else if(context==='candidate')counts.captureContextCandidate++;
    else if(context==='must_include')counts.captureContextMustInclude++;
    if(pair?.decision?.response==='eligible')counts.captureResponseEligible++;
    else if(pair?.decision?.response==='urgent')counts.captureResponseUrgent++;
  }
  const o=frame?.diagnostics?.omissions || {};
  const safe=value=>Number.isSafeInteger(value)&&value>=0?Math.min(value,2147483647):0;
  counts.perceivedUnsupportedClaims=safe(o.unsupported_claim_detail);
  counts.perceivedRevisionMismatch=safe(o.revision_mismatch);
  counts.perceivedUnmatchedSalience=safe(o.no_matching_salience);
  counts.perceivedBudgetExcluded=safe(o.budget_excluded);
  counts.perceivedSafetyOverflow=safe(o.safety_overflow);
  return Object.freeze(counts);
}
