# Local Windows handoff — map streaming unresolved

User ended live testing and requested full rollback, P2 release and GitHub publication for cloud work. All three are completed by this evidence update. PR stays draft and unmerged.

## Acceptance

| Requirement | Result |
|---|---|
| Custom map successfully loaded | FAIL — not established in either audited pack |
| Both fences recognized as real map objects | FAIL — source objects missing from audits |
| Native RPG fracture, A / B | NOT RUN / NOT RUN |
| Correct selected sections | NOT RUN |
| Physical traversal | NOT RUN |
| Independent post-fracture restoration and cleanup | NOT RUN |
| Filesystem rollback and P2 release | PASS |

No preparation, hide, script-spawned substitute, RPG, selector override or synthetic explosion was requested. Ten exact P2 requests are preserved; only survey, enable, register and audit commands appear. These failures concern map streaming, not a measured failure of the destruction system. #308 remains separate and untested. No X9.

## Actual toolchain and surveyed site

GTA Enhanced 2.0.1158.16; installed SHVDN API 3.9.0; CodeWalker30_dev48; Onigiri and existing NVE map stack. Host GPU power cap check passed at 460/575 W, no setting changes. Use Python 3.11+ (3.12.14 used here) for P2 seven-digit .NET timestamps. Default Python 3.10 rejected the timestamp before publishing any request; no controller change was made.

P2 survey `d03d058cba4347aa96fa7c99f3c7265b` measured 30 solid ground samples around LSIA center (-1240,-3350), all Z=12.945 and surface normal Z=1. Both future pivots were included. The nearest logged props were outside the immediate lanes. This establishes ground samples, **not complete environmental qualification**: the fences never appeared for collision/approach or traversal tests.

`site.json` uses pivots A=(-1255,-3350,13.049618), B=(-1225,-3350,13.049618), headings 0/90, exactly 30 m apart. Pivot Z places the exported original drawable's -0.104618 lower bound at the measured surface. That choice and native heading still require validation against actual streamed objects. The site is surveyed, not accepted as a complete laboratory.

Optional `build_runtime.py` adds only a P2 `labsurvey` dispatch/method over the unchanged generated X8 source. Candidate, installed and loaded source hash agreed: `5ad91373ad99fbd6b1d0b7757951c1e05a7ae20c50ea03729818145248815803`. Full installed-SHVDN compilation succeeded (warnings retained in compile.txt); startup logs independently confirm compilation. No inherited physics, selector or X8 runtime changes.

## Packaging attempts — keep these distinct

All packages contain authored metadata and stock archetype references, **no extracted Rockstar model assets**. `packs/` preserves each exact package, XML and receipts. Generator XML and placements are in `generated/`.

| Local revision | DLC SHA256 | Actual result |
|---|---|---|
| v1 | `6d1b7b05a7d42fcef50d6af752928a18326327fd66b1d6d560679e00a92894e3` | A and B audits ERROR: `x8_audit_source_ambiguous_or_missing`; no nearby props reported at A. |
| v2 | `8307d945ff26ae99b603cbad4ac3c1b045deab35a9fddcdbe9c2772ea61a1564` | Adds `_manifest.ymf` map-to-`v_fences` dependency. A remains missing; B not retested. Thus missing YMF is **not established as the complete root cause**. |
| v3 | `9010cc5f599d2168992d7ff5d5401d0fa9d94cac9f1b51c6c6866876888d0927` | Matches installed NVE's shallow x64 archive layout and enabled/nonpersistent RPF registration. Installed and Steam launch requested; **no fresh runtime or fence audit captured before user stop**. Not a load success. |

v1 was already a local packaging revision (map archive registration and streaming group adjustments), not an untouched test of the original cloud packer. Initial cloud head was `4d47cd46e8267ace9202e89e3029f32251644363`, stacked on X8 `b5ac532a` and validated X7.3 `c232de1c`.

The current packer removes the explicit standalone MAP_DATA registration, adds the dependency YMF, and uses the installed NVE map DLC registration pattern. It now checks two entities' model hashes/positions/quaternions/scales after direct YMAP reload, reloads the map from its nested RPF, and validates the packed YMF hashes. All final v3 binary checks passed. These checks establish serialization and archive contents; **they do not establish Enhanced mounting/streaming**.

Working installed reference was `NVE_props_addon/dlc.rpf`: map RPF entries, `CONTENTS_DLC_MAP_DATA`, `GROUP_UPDATE_STREAMING`, `isLevelPack=true`, and `_manifest.ymf` dependency arrays. No reference NVE archive content was copied into the lab.

## Verification and limits

- Nine existing generator tests passed, including deterministic output, fixture gate, finite geometry and inverted quaternion.
- Actual X8 cleanup regression passed on the host: surviving root/debris, unknown native state and verified deletion cases.
- Existing X8 integration and X7.3 selector source guards passed.
- Full optional survey driver compiled against the installed SHVDN DLL; warnings are recorded.
- Final packer syntax and actual CodeWalker direct/nested map/YMF reload passed. CI now also builds the optional survey wrapper and verifies unchanged inherited generated driver.
- Initial cleanup test hit sandbox temp-directory denial, then passed on host. No automatic approval rejection remains.

Read-only failed audit requests: v1 A `4d44deecd3fb47ab99f10b6555b12a91`; v1 B `e2b794b3c5a24bab90d147e265fd7baa`; v2 A `4767c4155fd648388af8e2c5b38aa23d`. All have correlated immutable ERROR receipts, not timeouts or pending requests. Raw rows and request/runtime identities are under `live-evidence/`; collection SHA inventory is included.

## Shutdown, rollback, custody

After the user stopped Computer Use with Escape, no further Computer Use input was sent. On the explicit rollback request, host process enumeration independently found GTA/RPH absent. Restored v3 map files first, then the original driver installation. `filesystem-restoration.json` verifies the original SHVDN config, original DLC list, removed X7 pack/driver/allowlist and both DLSS addons by SHA256 or expected absence. The separate lab DLC is also absent. `rollback/` retains each map revision's restoration journal, plus the driver journal. No backup bytes or extracted game assets are published.

P2 owner `codex-lab`, session `lab-survey-20261022`, pending=null. Evidence collected, restoration handoff written, then same-owner `release` archived ownership. `controller.json`, `request.txt`, `command.txt` absent; GTA stopped. Lock/fence/history files remain normal protocol artifacts. `final-state.txt` and `handoff.json` record closure.

## Next cloud action

Diagnose why this valid authored YMAP does not become streamed map objects on the installed Enhanced/Onigiri stack. Inspect the packer, generated XML, exact v1/v2 failed audits and v3 archive metadata; distinguish a serialization/mounting/archetype-registration issue from an ordinary site-selection issue. Do not present v3 as tested, convert fixtures into surveyed coordinates, script-spawn stand-ins, change X8 physics/selector, claim #308 fixed, or start X9. A later Windows session must reinstall under stopped-game/hash/P2 gates, establish both real map objects and full environment qualification, then perform at most one real RPG per qualified fence.

The operator scripts in `operator/` are exact session-specific execution records, with original workspace layout assumptions; reusable tools are in the parent lab directory. No further live session is authorized by this handoff after the user's stop request.
