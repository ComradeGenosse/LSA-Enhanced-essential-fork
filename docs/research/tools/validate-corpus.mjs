import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const corpusPath = path.join(root, 'docs/research/CORPUS.json');
const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));
const errors = [];

const exists = async relative => {
  try { await access(path.join(root, relative)); return true; }
  catch { return false; }
};

const ids = new Set();
const paths = new Set();
for (const doc of corpus.documents || []) {
  if (!doc.id || typeof doc.id !== 'string') errors.push('document missing id');
  else if (ids.has(doc.id)) errors.push(`duplicate document id: ${doc.id}`);
  else ids.add(doc.id);

  if (!doc.path || typeof doc.path !== 'string') errors.push(`document ${doc.id || '<unknown>'} missing path`);
  else {
    if (paths.has(doc.path)) errors.push(`duplicate document path: ${doc.path}`);
    paths.add(doc.path);
    if (!await exists(doc.path)) errors.push(`missing document path: ${doc.path}`);
  }

  if (doc.status === 'superseded' && (!Array.isArray(doc.supersededBy) || doc.supersededBy.length === 0)) {
    errors.push(`superseded document lacks supersededBy: ${doc.id}`);
  }
}

for (const [name, relative] of Object.entries(corpus.canonical || {})) {
  if (!await exists(relative)) errors.push(`canonical path missing (${name}): ${relative}`);
}
for (const [name, relative] of Object.entries(corpus.domains || {})) {
  if (!await exists(relative)) errors.push(`domain map missing (${name}): ${relative}`);
}

const contractIds = new Set(Object.keys(corpus.contracts || {}));
const decisionIds = new Set(Object.keys(corpus.decisions || {}));
const validRef = value => ids.has(value) || contractIds.has(value) || decisionIds.has(value);
for (const doc of corpus.documents || []) {
  for (const field of ['supersededBy', 'incorporatedInto']) {
    for (const value of doc[field] || []) if (!validRef(value)) {
      errors.push(`${doc.id} has unresolved ${field} reference: ${value}`);
    }
  }
}

const linkDocs = [
  corpus.canonical?.entrypoint,
  corpus.canonical?.currentArchitecture,
  corpus.canonical?.decisions,
  corpus.canonical?.openQuestions,
  ...Object.values(corpus.domains || {}),
].filter(Boolean);

const markdownLink = /\[[^\]]+\]\(([^)]+)\)/g;
for (const relative of linkDocs) {
  if (!await exists(relative)) continue;
  const text = await readFile(path.join(root, relative), 'utf8');
  for (const match of text.matchAll(markdownLink)) {
    const raw = match[1].trim();
    if (!raw || raw.startsWith('#') || /^[a-z]+:/i.test(raw)) continue;
    const targetPart = raw.split('#')[0].split('?')[0];
    if (!targetPart) continue;
    const target = path.normalize(path.join(path.dirname(relative), targetPart));
    if (!await exists(target)) errors.push(`broken local link in ${relative}: ${raw} -> ${target}`);
  }
}

if (errors.length) {
  console.error(`Research corpus validation failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Research corpus OK: ${ids.size} documents, ${decisionIds.size} decisions, ${contractIds.size} contracts, ${linkDocs.length} entry/domain docs checked.`);
}
