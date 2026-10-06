import { readFile } from 'node:fs/promises';
import { verifyRadioTrackCatalogText } from '../src/perception/radioTrackCatalog.mjs';

export { verifyRadioTrackCatalogText };

async function main() {
  const [inputPath] = process.argv.slice(2);
  if (!inputPath) {
    console.error('Usage: node tools/verifyRadioTrackCatalog.mjs <catalog.json>');
    process.exitCode = 1;
    return;
  }
  const result = verifyRadioTrackCatalogText(await readFile(inputPath, 'utf8'));
  if (!result.ok) {
    console.error(result.errors.join(','));
    process.exitCode = 1;
    return;
  }
  console.log('radio_catalog_ok');
}

const invoked = process.argv[1] && process.argv[1].endsWith('verifyRadioTrackCatalog.mjs');
if (invoked) await main();
