import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { readFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

// UX phase 1 handshake for native clients (the RAGE loader's console commands).
// The loopback editor token is already readable by any same-user process from
// GET /; this per-user file only replaces scraping it out of the HTML. It never
// widens the bind address, and it is removed when the server closes or exits.
export const CONTROL_ENDPOINT_VERSION = 1;
export const CONTROL_ENDPOINT_FILE = 'control-endpoint.v1.json';
const LOOPBACK_URL = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/;

export function defaultControlEndpointPath({ env = process.env, platform = process.platform } = {}) {
  const root = env?.LOCALAPPDATA;
  if (platform !== 'win32' || typeof root !== 'string' || !path.win32.isAbsolute(root)) return null;
  return path.win32.join(root, 'LSA Enhanced', CONTROL_ENDPOINT_FILE);
}

export function controlEndpointDocument({ url, token, pid = process.pid, startedAtUtc = new Date().toISOString() } = {}) {
  const port = Number(LOOPBACK_URL.exec(typeof url === 'string' ? url : '')?.[1]);
  if (!(port >= 1 && port <= 65535)) throw new Error('invalid_control_endpoint');
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new Error('invalid_control_endpoint');
  if (!Number.isSafeInteger(pid) || pid <= 0 || typeof startedAtUtc !== 'string' || Number.isNaN(Date.parse(startedAtUtc))) throw new Error('invalid_control_endpoint');
  return { version: CONTROL_ENDPOINT_VERSION, url, token, pid, startedAtUtc };
}

// Writes atomically (temporary file, then rename) and returns a handle whose
// close() removes the file only while it still belongs to this server, so a
// newer companion's endpoint is never deleted by an older one shutting down.
export async function publishControlEndpoint(filePath, endpoint) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('invalid_control_endpoint_path');
  const document = controlEndpointDocument(endpoint);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(document) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temporary, filePath);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  const ours = text => { try { const value = JSON.parse(text); return value?.token === document.token && value?.pid === document.pid; } catch { return false; } };
  let removed = false;
  const removeOnExit = () => {
    if (removed) return; removed = true;
    try { if (ours(readFileSync(filePath, 'utf8'))) rmSync(filePath, { force: true }); } catch {}
  };
  process.once('exit', removeOnExit);
  return {
    filePath,
    async close() {
      if (removed) return; removed = true;
      process.removeListener('exit', removeOnExit);
      try { if (ours(await readFile(filePath, 'utf8'))) await rm(filePath, { force: true }); } catch {}
    },
  };
}
