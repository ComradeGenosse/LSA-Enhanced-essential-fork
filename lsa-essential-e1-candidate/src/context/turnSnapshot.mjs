const UNKNOWN_WORLD = Object.freeze({
  gameTime: 'unknown', weather: 'unknown', streetName: 'unknown',
  crossingStreetName: 'unknown', zoneCode: 'unknown',
});

function cloneJsonValue(value) {
  if (value instanceof Map) return Object.fromEntries([...value.entries()].map(([key, item]) => [String(key), cloneJsonValue(item)]));
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = cloneJsonValue(item);
    return result;
  }
  return value;
}

function freezeTree(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) freezeTree(item);
  return Object.freeze(value);
}

export function immutableSnapshot(value) {
  return value == null ? null : freezeTree(cloneJsonValue(value));
}

export function normalizeReferenceEntityId(value, kind) {
  const id = value && typeof value === 'object'
    ? value[kind === 'person' ? 'pedId' : 'vehicleId'] || value.id
    : value;
  const normalized = String(id ?? '').trim();
  return /^[0-9a-f]+$/i.test(normalized) ? normalized.toLowerCase() : '';
}

export function captureReferenceMap(actor) {
  const persons = {};
  const vehicles = {};
  const personEntries = actor?.nearbyPersonReferences instanceof Map
    ? [...actor.nearbyPersonReferences.entries()]
    : Object.entries(actor?.nearbyPersonReferences && typeof actor.nearbyPersonReferences === 'object' ? actor.nearbyPersonReferences : {});
  const vehicleEntries = actor?.nearbyVehicleReferences instanceof Map
    ? [...actor.nearbyVehicleReferences.entries()]
    : Object.entries(actor?.nearbyVehicleReferences && typeof actor.nearbyVehicleReferences === 'object' ? actor.nearbyVehicleReferences : {});
  for (const [reference, value] of personEntries) {
    const key = String(reference).trim().toUpperCase();
    const id = normalizeReferenceEntityId(value, 'person');
    if (/^P\d{3}$/.test(key) && id) persons[key] = id;
  }
  for (const [reference, value] of vehicleEntries) {
    const key = String(reference).trim().toUpperCase();
    const id = normalizeReferenceEntityId(value, 'vehicle');
    if (/^V\d{3}$/.test(key) && id) vehicles[key] = id;
  }
  return freezeTree({ persons, vehicles });
}

export function unknownWorld() { return immutableSnapshot(UNKNOWN_WORLD); }
