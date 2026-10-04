import { isUuid } from '../identity/identityContract.mjs';

// UX phase 3: names for the native menu's Current NPC page (legacy /api action
// "current_describe" until ControlService v1). Read-only: it never creates a
// session profile, capture ticket, ownership or native request, and it returns
// display fields only, never biography, notes, memories or appearance.
const OWNER_ALIAS = /^promoted\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const text = (value,max) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value : undefined;
function bounded({ kind,name,characterId,relationship,status,voice,facts }) {
  const result = { kind };
  const fields = { name:text(name,80),characterId:isUuid(characterId) ? characterId : undefined,relationship:text(relationship,16),status:text(status,16),voice:text(voice,40) };
  for (const [key,value] of Object.entries(fields)) if (value !== undefined) result[key] = value;
  result.facts = Array.isArray(facts) ? facts.map(fact => text(fact,120)).filter(Boolean).slice(0,3) : [];
  return result;
}
export function describeCurrent(service,{ encounterId = null,ownerAlias = null } = {}) {
  if ((encounterId !== null && !isUuid(encounterId)) || (ownerAlias !== null && (typeof ownerAlias !== 'string' || !OWNER_ALIAS.test(ownerAlias)))) throw new Error('invalid_editor_request');
  if (ownerAlias !== null && service.ready && service.store?.available) {
    const profile = service.store.list().find(item => item.promotion.ownerAlias === ownerAlias);
    if (profile) return bounded({ kind:'promoted',name:profile.name,characterId:profile.characterId,relationship:profile.relationship?.state,status:profile.status,voice:profile.voiceReference?.voice,facts:[] });
  }
  if (encounterId !== null) {
    const session = service.sessions?.peek(encounterId);
    if (session) return bounded({ kind:'encounter',name:session.name,voice:session.speechProfile?.voice,facts:session.facts });
  }
  return { kind:'unknown',facts:[] };
}
