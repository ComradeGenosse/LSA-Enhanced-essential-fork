import { validateDecisionShape } from './essentialDecision.mjs';
import { captureReferenceMap, normalizeReferenceEntityId } from './turnSnapshot.mjs';

const vehicleActions = new Set(['startdriving', 'entertargetvehicle', 'enterbackoftargetvehicle', 'enterdriverseatoftargetvehicle', 'followtargetvehicle', 'stopfollowingtargetvehicle', 'pullovertargetvehicle']);
const weaponActions = new Set(['equipweapon', 'attacktargetwithweapon', 'takeshotontarget', 'intimidatetargetwithweapon']);

function frozenBindings(persons, vehicles) {
  return Object.freeze({ persons: Object.freeze({ ...persons }), vehicles: Object.freeze({ ...vehicles }) });
}
function rejectTarget(message, code) { return Object.assign(new TypeError(message), { code }); }

export function validateStockDecision(decision, { identity, actor, parseActions, allowedActionNames, resolvePerson, resolveVehicle, referenceSnapshot }) {
  const safe = validateDecisionShape(decision);
  const commands = safe.command.match(/\bDO\s*:?\s+[A-Za-z]/gi) || [];
  if (safe.command && commands.length !== 1) throw new TypeError('A turn may contain only one stock action.');
  const actions = safe.command ? parseActions(safe.command) : [];
  if (safe.command && actions.length !== 1) throw new TypeError('Essential did not recognize exactly one stock action.');
  if (actions.length > 1) throw new TypeError('A turn may contain only one stock action.');
  const originalReferences = referenceSnapshot || captureReferenceMap(actor);
  const boundPersons = Object.create(null);
  const boundVehicles = Object.create(null);
  if (actions.length) {
    const action = actions[0];
    if (!allowedActionNames.has(action.actionName)) throw new TypeError('The action is not currently available to this actor.');
    if (action.target && action.target !== 'A') {
      const key = String(action.target).trim().toUpperCase();
      const captured = originalReferences.persons?.[key];
      if (!/^P\d{3}$/.test(key) || !captured) throw rejectTarget('The action target was not present in the reasoning-time reference map.', 'target_missing');
      const currentResult = resolvePerson?.(key);
      const current = currentResult === true ? captured : normalizeReferenceEntityId(currentResult, 'person');
      if (!current) throw rejectTarget('The action target is no longer available in the current actor snapshot.', 'target_invalid');
      if (current !== captured) throw rejectTarget('The action target reference changed after reasoning; the action was rejected.', 'target_changed');
      boundPersons[key] = captured;
    }
    if (vehicleActions.has(action.actionName) || /^V\d{3}$/i.test(action.parameter)) {
      const key = String(action.parameter || '').trim().toUpperCase();
      const captured = originalReferences.vehicles?.[key];
      if (!/^V\d{3}$/.test(key) || !captured) throw rejectTarget('The vehicle reference was not present in the reasoning-time reference map.', 'target_missing');
      const currentResult = resolveVehicle?.(key);
      const current = currentResult === true ? captured : normalizeReferenceEntityId(currentResult, 'vehicle');
      if (!current) throw rejectTarget('The vehicle reference is no longer available in the current actor snapshot.', 'target_invalid');
      if (current !== captured) throw rejectTarget('The vehicle reference changed after reasoning; the action was rejected.', 'target_changed');
      boundVehicles[key] = captured;
    }
    if (weaponActions.has(action.actionName)) {
      const listedWeapons = Array.isArray(actor?.availableWeapons) ? actor.availableWeapons : [];
      const availableContext = String(actor?.availableWeaponsContext || '').trim();
      const weapon = String(action.parameter || '').trim().toLowerCase();
      if (!weapon) throw new TypeError('The stock weapon action requires a verified weapon name.');
      const listed = listedWeapons.map(item => String(item?.name || item?.weaponName || item).trim().toLowerCase()).filter(Boolean);
      if (listed.length && !listed.includes(weapon)) throw new TypeError('The requested weapon is not listed in the current actor snapshot.');
      if (!listed.length) {
        const descriptions = [availableContext, actor?.equippedWeaponDescription, actor?.weaponDescription]
          .map(value => String(value || '').trim().toLowerCase())
          .filter(value => value && !['unknown', 'none', 'unarmed'].includes(value));
        const availability = descriptions.join(' ');
        if (!availability || /(?:available weapons:\s*none|no available weapons)/.test(availability) || !descriptions.some(description => description.replace(/^available weapons:\s*/i, '').split(/[,;\n]/).map(value => value.trim()).includes(weapon))) {
          throw new TypeError('The requested weapon is not verified by the current actor snapshot.');
        }
      }
    }
  }
  return Object.freeze({
    identityValid: true,
    decision: safe,
    actionCount: actions.length,
    actionNames: actions.map(action => action.actionName),
    referenceBindings: frozenBindings(boundPersons, boundVehicles),
    internalTranscript: safe.command ? `${safe.command}|${safe.dialogue}` : safe.dialogue,
    validatedFor: Object.freeze({ ...identity }),
  });
}
