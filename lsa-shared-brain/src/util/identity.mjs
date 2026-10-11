export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const isUuid = value => typeof value === 'string' && UUID.test(value);
export const exactObject = (value, keys) => !!value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const cloneJsonValue = value => {
  if (value instanceof Map) return Object.fromEntries([...value.entries()].map(([key, item]) => [String(key), cloneJsonValue(item)]));
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]));
  return value;
};
const freezeTree = value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) freezeTree(item);
  return Object.freeze(value);
};
export function immutableSnapshot(value) { return value == null ? null : freezeTree(cloneJsonValue(value)); }
