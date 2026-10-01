# Pinned E0 inputs

These two files are offline reference inputs copied from the supplied stock Essential payload. The E1 builder reads them and rejects any hash mismatch. They are retained here so the candidate rebuild does not depend on the user's GTA folders or on a separate stock extraction path.

| Input | SHA-256 |
|---|---|
| `server.bundle.mjs` | `5d81de4217bd103316a1083e482ded1bddc791314abf671d686036175c0475f2` |
| `LosSantosAlive.dll` | `9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653` |

Origin: the archived installer-dependencies payload for Essential. The builder does not write to these inputs.
