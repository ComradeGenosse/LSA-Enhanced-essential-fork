import { readFile, writeFile } from 'node:fs/promises';
import { buildRadioTrackCatalog } from '../src/perception/radioTrackCatalog.mjs';

export { buildRadioTrackCatalog };

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    console.error('Usage: node tools/buildRadioTrackCatalog.mjs <input.json> <output.json>');
    process.exitCode = 1;
    return;
  }
  const result = buildRadioTrackCatalog(JSON.parse(await readFile(inputPath, 'utf8')));
  if (!result.ok) {
    console.error(result.errors.join(','));
    process.exitCode = 1;
    return;
  }
  await writeFile(outputPath, result.json);
  console.log(JSON.stringify({ trackCount: result.trackCount, countsByStation: result.countsByStation, duplicates: result.duplicates, unknown: result.unknown }));
}

const invoked = process.argv[1] && process.argv[1].endsWith('buildRadioTrackCatalog.mjs');
if (invoked) await main();
