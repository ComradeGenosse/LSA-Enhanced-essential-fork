import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ACTIVITY_CONTRACT_VERSION, ADAPTERS, CAPABILITY_IDS, EXECUTION_PATHS, INTENTS, ITEMS, PRECONDITIONS, PRIORITIES, REASON_CODES, SCENARIOS, SOURCES, STEP_KINDS,
} from './contracts.mjs';

export const ACTIVITY_CAPABILITIES_SHA256 = '31ed6e6d47a7222929b3645401d6e046676ed7f21a65f5643a68e002a3ee6486';
const contractUrl = new URL('../../../contracts/activity-capabilities.v1.json', import.meta.url);
const same = (left, right) => left.length === right.length && left.every((item, index) => item === right[index]);
const text = value => typeof value === 'string';
const integer = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const list = (value, allowed, max) => Array.isArray(value) && value.length <= max && value.every(item => allowed.includes(item));
const closed = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const SCENARIO_MAP = Object.freeze({ smoke: 'WORLD_HUMAN_SMOKING', drink_coffee: 'WORLD_HUMAN_AA_COFFEE', phone: 'WORLD_HUMAN_STAND_MOBILE', lean: 'WORLD_HUMAN_LEANING', stand_idle: 'WORLD_HUMAN_HANG_OUT_STREET', sit_bench: 'PROP_HUMAN_SEAT_BENCH', clipboard: 'WORLD_HUMAN_CLIPBOARD', binoculars: 'WORLD_HUMAN_BINOCULARS' });
const ITEM_MAP = Object.freeze({ canned_goods: 'CannedGoods', donut: 'Donut', breakfast_snack: 'BreakfastSnack', snack: 'Snack', soda: 'Soda', beer: 'Beer', coffee: 'Coffee', liquor: 'Liquor', energy_drink: 'EnergyDrink', water: 'Water' });
const EXPOSURES = ['model_visible', 'parser_only', 'registry_only', 'queue_special', 'wrapper_only', 'vestigial', 'missing', 'excluded'];
const WORK = ['none', 'register_extension', 'new_behavior'];
const EVIDENCE = ['PROVEN', 'STRONGLY_SUPPORTED', 'INFERRED', 'UNKNOWN'];
const PHASES = ['ACT2', 'ACT3', 'ACT6', 'ACT7', 'never'];
const ARG_KEYS = ['target', 'vehicle', 'seat', 'place', 'scenario', 'radius', 'item'];
const ROW_KEYS = ['id', 'kind', 'args', 'preconditions', 'execution', 'cancel', 'adapter', 'failureSignals', 'timeouts', 'conflictRisk', 'allowedSources', 'allowedPriority', 'ownedOnly', 'exposure', 'registrationWork', 'evidence', 'probes', 'phase'];
// N9 executor command names paired with the canonical registry name. Q2 still has to pin callback counts.
export const OBSERVED_NAMES = Object.freeze({
  waithere: ['WaitHere'], followtarget: ['FollowTarget'], resumeactivity: ['ResumeActivity'], sitonground: ['SitOnGround'],
  stopandfacetarget: ['StopAndFaceTarget'], approachperson: ['ApproachTarget'], takecover: ['TakeCover'], walkawayfromtarget: ['WalkAwayFromTarget'],
  startdriving: ['StartDriving'], exitvehicle: ['ExitVehicle'],
});

function names(value) {
  if (value == null) return [];
  return String(value).split(/[|+]/).map(item => item.trim()).filter(Boolean);
}
function rowValid(row) {
  if (!closed(row, ROW_KEYS) || !CAPABILITY_IDS.includes(row.id) || !STEP_KINDS.includes(row.kind) || !closed(row.args, Object.keys(row.args)) || Object.entries(row.args).some(([key, need]) => !ARG_KEYS.includes(key) || !['required', 'optional'].includes(need))) return false;
  if (!list(row.preconditions, PRECONDITIONS, 32) || !closed(row.execution, ['path', 'essentialName', 'vehiclePolicy', 'exactTarget']) || !EXECUTION_PATHS.includes(row.execution.path) || typeof row.execution.exactTarget !== 'boolean') return false;
  if (![null, 0, 1, 2, 3].includes(row.execution.vehiclePolicy)) return false;
  const essential = row.execution.essentialName;
  if (row.execution.path === 'none' ? essential !== null : !text(essential) || essential.length < 1 || essential.length > 120) return false;
  if (!closed(row.cancel, ['path', 'essentialName', 'onlyIfCurrent']) || !['stop_api', 'supersede', 'none'].includes(row.cancel.path) || row.cancel.onlyIfCurrent !== true) return false;
  if (row.cancel.essentialName !== null && (!text(row.cancel.essentialName) || row.cancel.essentialName.length > 120)) return false;
  if (!ADAPTERS.includes(row.adapter) || !list(row.failureSignals, REASON_CODES, 16) || !closed(row.timeouts, ['acceptMs', 'establishMaxMs', 'completeMaxMs', 'holdMaxMs'])) return false;
  if (!integer(row.timeouts.acceptMs, 3_600_000) || [row.timeouts.establishMaxMs, row.timeouts.completeMaxMs, row.timeouts.holdMaxMs].some(item => item !== null && !integer(item, 3_600_000))) return false;
  if (!['low', 'medium', 'high'].includes(row.conflictRisk) || !list(row.allowedSources, SOURCES, SOURCES.length) || !list(row.allowedPriority, PRIORITIES, PRIORITIES.length) || row.ownedOnly !== true) return false;
  if (!EXPOSURES.includes(row.exposure) || !WORK.includes(row.registrationWork) || !EVIDENCE.includes(row.evidence) || !PHASES.includes(row.phase)) return false;
  if (!Array.isArray(row.probes) || row.probes.length > 12 || row.probes.some(item => !text(item) || !/^[A-Z][A-Z0-9]{0,8}$/.test(item))) return false;
  return true;
}
export function validateCapabilityDocument(document) {
  if (!closed(document, ['schema', 'schemaVersion', 'status', 'generated', 'repositoryHead', 'promotedFrom', 'pins', 'enums', 'capabilities', 'excluded'])) return null;
  if (document.schema !== 'lsa.activity-capabilities' || document.schemaVersion !== ACTIVITY_CONTRACT_VERSION || document.status !== 'runtime contract' || document.generated !== '2026-10-04') return null;
  if (!/^[0-9a-f]{40}$/.test(document.repositoryHead) || !text(document.promotedFrom) || document.promotedFrom.length > 160) return null;
  if (!closed(document.pins, ['essentialDll', 'stockBundle']) || !/^[a-f0-9]{64}$/.test(document.pins.essentialDll) || !/^[a-f0-9]{64}$/.test(document.pins.stockBundle)) return null;
  const enums = document.enums;
  if (!closed(enums, ['kind', 'path', 'exposure', 'registrationWork', 'evidence', 'adapter', 'preconditions', 'vehiclePolicy', 'scenarioMap', 'itemMap'])) return null;
  if (!same(enums.kind, STEP_KINDS) || !same(enums.path, EXECUTION_PATHS) || !same(enums.exposure, EXPOSURES) || !same(enums.registrationWork, WORK) || !same(enums.evidence, EVIDENCE) || !same(enums.adapter, ADAPTERS) || !same(enums.preconditions, PRECONDITIONS)) return null;
  if (!closed(enums.vehiclePolicy, ['0', '1', '2', '3', 'null']) || Object.values(enums.vehiclePolicy).some(item => !text(item) || item.length > 80)) return null;
  if (!closed(enums.scenarioMap, SCENARIOS) || !closed(enums.itemMap, ITEMS) || SCENARIOS.some(key => enums.scenarioMap[key] !== SCENARIO_MAP[key]) || ITEMS.some(key => enums.itemMap[key] !== ITEM_MAP[key])) return null;
  if (!Array.isArray(document.capabilities) || document.capabilities.length !== CAPABILITY_IDS.length || document.capabilities.some(row => !rowValid(row)) || !same(document.capabilities.map(row => row.id), CAPABILITY_IDS)) return null;
  if (!Array.isArray(document.excluded) || document.excluded.length !== 18 || document.excluded.some(item => !closed(item, ['id', 'reason']) || !/^[a-z][a-z0-9_]{2,63}$/.test(item.id) || item.reason !== 'excluded_family')) return null;
  if (new Set(document.excluded.map(item => item.id)).size !== document.excluded.length || document.excluded.some(item => CAPABILITY_IDS.includes(item.id) || INTENTS.includes(item.id))) return null;
  return document;
}
export function loadCapabilityRegistry(bytes = readFileSync(contractUrl)) {
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== ACTIVITY_CAPABILITIES_SHA256) throw new Error('activity_contract_mismatch');
  const document = validateCapabilityDocument(JSON.parse(Buffer.from(bytes).toString('utf8')));
  if (!document) throw new Error('activity_contract_invalid');
  return new CapabilityRegistry(document);
}
export class CapabilityRegistry {
  constructor(document) {
    this.document = document;
    this.rows = new Map(document.capabilities.map(row => [row.id, row]));
    this.excluded = new Set(document.excluded.map(item => item.id));
  }
  get(id) { return this.rows.get(id) || null; }
  namesFor(id) {
    const row = this.get(id);
    if (!row || row.execution.essentialName == null) return [];
    const canonical = names(row.execution.essentialName).filter(item => !item.includes('.'));
    return [...new Set(canonical.flatMap(item => [item, ...(OBSERVED_NAMES[item] || [])]))];
  }
  enabled(id, config = {}) {
    const row = this.get(id);
    if (!row || row.phase === 'never' || row.exposure === 'excluded' || this.excluded.has(id)) return false;
    if (row.allowedSources.length === 0 || row.allowedPriority.length === 0 || row.execution.path === 'none') return false;
    if (config.mode !== 'on' || !config.hello || config.hello[id] !== true || !Array.isArray(config.requested) || !config.requested.includes(id)) return false;
    const passed = new Set(config.passedProbes || []);
    if (row.probes.some(probe => !passed.has(probe))) return false;
    if (config.source && !row.allowedSources.includes(config.source)) return false;
    if (config.priority && !row.allowedPriority.includes(config.priority)) return false;
    return true;
  }
}
export function capabilityByEssentialName(registry, name) {
  if (typeof name !== 'string' || name.length === 0) return null;
  for (const id of CAPABILITY_IDS) if (registry.namesFor(id).includes(name)) return registry.get(id);
  return null;
}
