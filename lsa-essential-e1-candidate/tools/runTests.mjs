// Offline suite: providers must use explicit test doubles.
globalThis.fetch = async () => { throw new Error('Network access is disabled in E1 tests.'); };
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../tests');
const files = (await readdir(testsDirectory)).filter(name => name.endsWith('.test.mjs')).sort();
for (const file of files) await import(pathToFileURL(path.join(testsDirectory, file)).href);
