# ElevenLabs Emotional Acting — Consolidated Integration

**Scope: ElevenLabs v4 provider stack plus EA0–EA9 emotional acting, NOT separate Memory K closure.**

## Single review branch

Branch: `integration/elevenlabs-emotional-acting-consolidated-20261012`.
Protected base: EA final PR #96 `b1a9b01b72c406706bb640daacbe30a56efd6d4e`, already incorporating all EA0–EA9 original implementation and A–D final fixes. Open consolidated draft PR against `feature/elevenlabs-v4-tts-provider-20261011` (upstream ElevenLabs provider #54). Therefore a single EA review diff includes EA planning/EA0–EA9 and all EA final fixes; it deliberately does **not** duplicate the provider PR's stacked upstream Qwen work.

This tree reconciles exact sources:
- EA G SQLite v4 and audit repair #106 + #108: `f37193845859b94afb960f7e5ebd04b6b721d236`.
- EA H single-person emotional continuity/native capability and audit repair #107 + #109: `56c92b27fabf62af321e2b96ccf0dad8683a11e6`.
- EA9 isolated deploy/verify/rollback #112: `485a4103829a22317379db92e3d7f4839b8d8349`.
- Original EA0–EA9 from #96, including #68/#54 ancestry.

Only overlapping source was `lsa-essential-e1-candidate/tests/ea-final-b-timeline.test.mjs`. Kept G #108's populated-v4 reopen/no-downgrade contract and fixed Windows WAL teardown. EA9 #112's overlapping teardown is equivalent, but its obsolete v2-only assertion was intentionally **not** imported. All other additions from the three final source heads are represented.

**Do not import PR #114 or any independent Memory K branches.** G's imported v4 SQLite storage library is an EA6 compatibility requirement, not approval of unfinished original Memory K runtime producers. The user controls Franklin/Michael/Trevor as ONE human for EA emotions; native model detection is only authenticated source evidence, never separate human identity.

## Acceptance gates

- Full EA0–EA9 offline matrix in `.github/workflows/ea-integration.yml`, exact HEAD plus native build and ABI, Node 22/24 Windows/Linux, full Essential/Python.
- New `.github/workflows/ea-consolidated-acceptance.yml`: focused G v4, H native/emotion, EA9 rollback, and combined-phase inventory on one SHA.
- Existing dedicated G, H and EA9 test workflows remain retained for future targeted debugging; branch-specific previous green runs are **not proof** the consolidated tree is green.
- No live ElevenLabs v4 Turbo successful PCM/A-B audible evidence, and no game-side native handshake/latency/GTA source receipts. All GTA deployment, production and billing remain **NOT RUN / NO GO**.
- Do not add `ELEVENLABS_API_KEY` to CI, do not deploy a package or touch save files.

## Reviewer focus

1. G/H C-13 native authority and confirmed P2 SQLite timeline become eligible together; user-avatar switches do not partition emotional mood.
2. Provider applies exact authorized v4 Turbo tags, tracks real native completed audio and original history acceptance, with off/shadow parity.
3. Original accepted evidence remains source-qualified; importing memory-v4 SQLite foundation is not approving M production work.
4. EA9 isolated target path rules, package seal / rollback and user-safe no-default-enable behavior.
5. Close obsolete EA-only PRs only **after** this new combined-head CI passes; retain old commits/handoffs and leave separate M and #54 provider alone.

Status: DRAFT / no GTA deployment until exact combined-head CI and later physical+vendor acceptance.
