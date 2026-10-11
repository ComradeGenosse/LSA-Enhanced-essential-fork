// M1 diagnostic: read-only preflight. Requires game/companion to be stopped.
// Example: node tools/inspectM1Sqlite.mjs --db "characters/profiles.v2.sqlite" --world-profile-id <UUID>
// Does not attempt to unlock, downgrade, restore or create databases.
import { inspectP2Sqlite } from '../../lsa-shared-brain/src/characters/sqliteFoundation.mjs';

export function parseInspectArgs(argv) {
  if (!Array.isArray(argv) || argv.length!==4 || argv[0]!=='--db' ||
      argv[2]!=='--world-profile-id' || !argv[1] || !argv[3])
    throw new Error('usage: --db <sqlite-path> --world-profile-id <UUID>');
  return {filePath:argv[1],worldProfileId:argv[3]};
}

if (process.argv[1] && import.meta.url===new URL('file://' + process.argv[1].replaceAll('\\','/')).href) {
  try {
    const result=await inspectP2Sqlite(parseInspectArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result,null,2));
  } catch(error) {
    console.error('M1 inspection failed:',String(error?.message||'unknown'));
    process.exitCode=1;
  }
}
