# Repository import — October 1, 2026

Imported the current E1.1 hardened + Observability candidate from the project workspace identified in the previous implementation chat. The source candidate and active GTA installation were not changed.

Included the candidate source, all offline tests, pinned stock DLL/server inputs, native metadata, build tools and vendored parser, existing documentation, deployment source/reference scripts, mission/native analysis, and original/revised E2/E3 plans.

Only repository documentation, ignore rules, a blank environment example, and attributes were added or adjusted. Generated dist files, credential files, runtime logs/audio, local SDK caches, stock installer runtime packages, rollback backups, and machine-generated deployment plans/receipts are excluded. Stock installation runtime packages remain prerequisites for deployment, not for offline tests/build. Existing upstream/vendor provenance and notices are retained.

The imported source/reference file hashes are recorded in import-file-manifest.json. The pinned native DLL, bundle, and metadata keep their exact bytes; .gitattributes disables automatic newline conversion throughout this snapshot.

## Fresh verification

- Node tools/runTests.mjs: 106 passed, 0 failed, 0 cancelled, 0 skipped.
- Node tools/buildCandidate.mjs: passed, including source/native pins; 25 AST edits.
- Build manifest hash: 0443800cf148f10baa58558f106baa1e97e6edc2d227c0d48cf8fef15c457ed9.
- Known local API credential values and common live-token/private-key patterns: no matches in the prepared checkout.
- E2/E3 plan module syntax: verified in the original review; plan stages form an acyclic dependency graph.
- Live provider requests, GTA launch, and deployment: not run as part of this import.

E2/E3 is planned work, not implemented behavior. The prior plan review's source-unavailability statement describes the earlier review context; source was subsequently found and imported through the previous chat.
