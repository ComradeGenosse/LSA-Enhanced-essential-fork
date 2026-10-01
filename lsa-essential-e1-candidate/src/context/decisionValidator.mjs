import { validateDecisionShape } from './essentialDecision.mjs';

const vehicleActions = new Set(['startdriving', 'entertargetvehicle', 'enterbackoftargetvehicle', 'enterdriverseatoftargetvehicle', 'followtargetvehicle', 'stopfollowingtargetvehicle', 'pullovertargetvehicle']);
const weaponActions = new Set(['equipweapon', 'attacktargetwithweapon', 'takeshotontarget', 'intimidatetargetwithweapon']);

export function validateStockDecision(decision, { identity, actor, parseActions, allowedActionNames, resolvePerson, resolveVehicle }) {
  const safe = validateDecisionShape(decision);
  const commands = safe.command.match(/\bDO\s*:?\s+[A-Za-z]/gi) || [];
  if (safe.command && commands.length !== 1) throw new TypeError('A turn may contain only one stock action.');
  const actions = safe.command ? parseActions(safe.command) : [];
  if (safe.command && actions.length !== 1) throw new TypeError('Essential did not recognize exactly one stock action.');
  if (actions.length > 1) throw new TypeError('A turn may contain only one stock action.');
  if (actions.length) {
    const action = actions[0];
    if (!allowedActionNames.has(action.actionName)) throw new TypeError('The action is not currently available to this actor.');
    if (action.target && action.target !== 'A' && !resolvePerson(action.target)) throw new TypeError('The action target is not in the current actor snapshot.');
    if ((vehicleActions.has(action.actionName) || /^V\d{3}$/i.test(action.parameter)) && (!/^V\d{3}$/i.test(action.parameter) || !resolveVehicle(action.parameter))) throw new TypeError('The vehicle reference is not in the current actor snapshot.');
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
    internalTranscript: safe.command ? `${safe.command}|${safe.dialogue}` : safe.dialogue,
    validatedFor: Object.freeze({ ...identity }),
  });
}
