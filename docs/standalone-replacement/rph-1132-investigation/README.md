# RPH 1.132 / PR #50 investigation (Opus 5.5)

This folder holds an offline, read-only investigation. It covers how RAGE Plugin Hook `1.132.1428.17748` provides
its managed API, and whether the LSA standalone host in PR #50 (`9933290b`) binds to it.

**Start with [REPORT.md](REPORT.md).** It covers sections A–H, and every finding is labelled PROVEN, STRONGLY
SUPPORTED or UNKNOWN.

It supersedes the local branch `analysis/rph-1132-investigation`, part of which was produced on a different model.
Nothing from that branch is relied on here.

## Contents

| Path | What it is |
|---|---|
| `REPORT.md` | The report, rendered from `REPORT.template.md` by `scripts/render_report.py` |
| `evidence/inventory.json`, `inventory-table.md`, `archive-hashes.txt` | PE/CLR inventory and SHA-256 of every analysed binary and archive (§A) |
| `evidence/pc-hash-check.txt` | End-of-analysis comparison of your PC against the analysed copies: 18 match, 4 replaced on your PC (§A) |
| `evidence/launcher-structure.txt` | Structural metadata of the 1.131 and 1.132 launchers: identity, row counts, resources (§B, §C) |
| `evidence/audit/*` | Dual-matcher audits and repo-auditor output for the `b5cd53f`, `5884d8b` and HEAD hosts (§D, §E) |
| `evidence/control/*` | The same audits for LSPDFR and your installed plugins (the control group) |
| `evidence/head-imports-vs-sdk.tsv`, `head-member-evidence.md` | Every HEAD import and its evidence (§D.2) |
| `evidence/jit-order-*.txt` | `Main`'s own-body imports and its callees in IL order, with unresolvable imports marked (§E) |
| `evidence/log-summary.json`, `runtime-proven.json` | Log facts, and the RPH members proven by execution on your 1.132 (§D.2) |
| `scripts/` | `pe_clr_inventory.py`, `scan_rph_logs.py`, `jit_order.py`, `runtime_proven.py`, `member_table.py`, `pc_hash_check.py`, `render_report.py`, `verify.sh`, `snapshot.sh` |
| `tools/RphMeta/` | The read-only metadata analyzer (dnlib 4.4.0): `info`, `types`, `api`, `refs`, `audit`, `methods`, `tables`, `genparams`. It has no IL-dump capability. |

Three items are left out of the repository and kept only in the download bundle, for size or because they are
derived from third-party binaries:

- `evidence/log-scan.json`, the full log scan (34 MB).
- `evidence/methods/*.jsonl`, the per-method dumps.
- `evidence/sdk124-api.tsv`, the public API of the official SDK.

## Reproducing

`scripts/verify.sh` regenerates every PROVEN number from the raw inputs (45 checks; the last run passed 45/45).

- It needs the inputs staged from your PC, the .NET SDK, and the built `RphMeta` and repo `RphSignatureAudit`.
- Its paths are those of the analysis environment.
- It rebuilds the HEAD host against the official SDK in CI order. It never touches the GTA installation.

The core result can be reproduced from a clean checkout of the PR head with the three commands in the report's
appendix.

## Scope kept

- No production source changed. Nothing deployed, GTA not launched, no PR merged, and your installation untouched.
- No RPH, LSPDFR, GTA or plugin binary is included in any output.
- The RPH launcher's protected payload was not unpacked, and Essential was not de-obfuscated.
