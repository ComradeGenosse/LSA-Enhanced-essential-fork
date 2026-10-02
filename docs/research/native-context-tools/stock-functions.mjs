// Read-only source index. Avoid grepping the minified bundle's multi-MB lines.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const acorn = require('../../../lsa-essential-e1-candidate/tools/vendor/acorn');
const source = await readFile(new URL('../../../lsa-essential-e1-candidate/dist/plugins/LosSantosAliveServer/server.bundle.mjs', import.meta.url), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const requested = process.argv.slice(2);
for (const node of ast.body) {
  if (node.type !== 'FunctionDeclaration') continue;
  const text = source.slice(node.start, node.end);
  if (requested.includes(node.id.name) || (requested[0] === '--contains' && requested.slice(1).some(term => text.includes(term))) || (!requested.length && text.includes('sessionNoncesByPedId'))) {
    console.log(`${node.id.name}: ${text}`);
  }
}
