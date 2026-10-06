import { readFile } from 'node:fs/promises';
import { verifyRadioTrackTextCatalogText } from '../src/perception/radioTrackCatalog.mjs';

const [catalogPath] = process.argv.slice(2);
if (!catalogPath) {
  console.error('Usage: node tools/verifyRadioTrackTextCatalog.mjs <catalog.json>');
  process.exitCode = 1;
} else {
  const result = verifyRadioTrackTextCatalogText(await readFile(catalogPath,'utf8'));
  if (!result.ok) {
    console.error(result.errors.join(','));
    process.exitCode = 1;
  } else console.log('ok');
}
