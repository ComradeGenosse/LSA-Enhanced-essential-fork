import { mkdir, open, readdir, stat, lstat, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const OWNED_FILE = /^e1-run-\d{8}T\d{6}Z-[a-f0-9-]{36}(?:-\d+)?\.jsonl$/;

export async function createFileSink({ directory = path.resolve(process.cwd(), 'logs'), maxFileBytes = 10 * 1024 * 1024, maxTotalBytes = 100 * 1024 * 1024, maxFiles = 5, maxQueue = 1024, maxQueueBytes = 1024 * 1024, now = () => new Date(), onFailure = () => {} } = {}) {
  for (const [value, name] of [[maxFileBytes,'maxFileBytes'],[maxTotalBytes,'maxTotalBytes'],[maxFiles,'maxFiles'],[maxQueue,'maxQueue'],[maxQueueBytes,'maxQueueBytes']]) if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer.`);
  const root = path.resolve(directory);
  await mkdir(root, { recursive: true });
  const actual = await stat(root);
  if (!actual.isDirectory()) throw new Error('Telemetry path is not a directory.');
  if (await realpath(root) !== root) throw new Error('Telemetry directory must not resolve through a link.');
  let runId = randomUUID();
  const stamp = now().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  let fileNumber = 0;
  let handle;
  let activeFile;
  let activeBytes = 0;
  let pending = 0;
  let pendingBytes = 0;
  let dropped = 0;
  let disabled = false;
  let chain = Promise.resolve();
  let sequence = 0;

  async function rotate() {
    await handle?.sync().catch(() => {});
    await handle?.close().catch(() => {});
    fileNumber++;
    activeFile = path.join(root, `e1-run-${stamp}-${runId}${fileNumber > 1 ? `-${fileNumber}` : ''}.jsonl`);
    handle = await open(activeFile, 'wx');
    activeBytes = 0;
    await enforceRetention();
  }
  async function enforceRetention() {
    const owned = [];
    for (const name of await readdir(root)) {
      if (!OWNED_FILE.test(name)) continue;
      const file = path.join(root, name);
      const info = await lstat(file).catch(() => null);
      if (info?.isFile() && !info.isSymbolicLink()) owned.push({ file, size: info.size, mtime: info.mtimeMs, active: file === activeFile });
    }
    owned.sort((a,b) => b.mtime-a.mtime);
    let total = owned.reduce((n, item) => n + item.size, 0);
    let kept = 0;
    for (const item of owned) {
      if (item.active) { kept++; continue; }
      if (kept >= maxFiles - 1 || total <= maxTotalBytes) { await unlink(item.file).catch(() => {}); total -= item.size; continue; }
      kept++;
    }
  }
  await rotate();

  const sink = {
    runId,
    get droppedCount() { return dropped; },
    emit(record) {
      const reserved = record.event === 'turn_terminal_summary' || record.event === 'run_shutdown';
      if (disabled || (pending >= maxQueue && (!reserved || pending >= maxQueue + 32))) { dropped++; return false; }
      let line;
      try { line = `${JSON.stringify({ ...record, sequence: ++sequence, runId })}\n`; }
      catch { dropped++; return false; }
      const bytes = Buffer.byteLength(line);
      if (bytes > 64 * 1024 || (pendingBytes + bytes > maxQueueBytes && (!reserved || pending >= maxQueue + 32))) { dropped++; return false; }
      pending++;
      pendingBytes += bytes;
      chain = chain.then(async () => {
        if (disabled) return;
        if (activeBytes + bytes > maxFileBytes) await rotate();
        await handle.write(line);
        activeBytes += bytes;
        if (record.event === 'turn_terminal_summary' || record.event === 'run_shutdown') await handle.sync();
      }).catch(error => {
        disabled = true;
        onFailure({ code: /^[A-Za-z0-9_.-]{1,64}$/.test(error?.code || '') ? error.code : 'write_failed' });
      }).finally(() => { pending--; pendingBytes -= bytes; });
      return true;
    },
    async flush() { await chain; if (!disabled) await handle.sync().catch(error => { disabled = true; onFailure({ code: error?.code || 'flush_failed' }); }); },
    async close() { await sink.flush(); await handle?.close().catch(() => {}); },
    get filePath() { return activeFile; },
  };
  return sink;
}
