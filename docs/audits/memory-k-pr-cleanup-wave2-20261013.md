# Memory K PR cleanup — Round 2 diverged-head review (2026-10-13)

**Read-only assessment.** No PRs were closed, merged, retargeted or deleted in this round. Comparison target: [umbrella #138](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/138), pinned exact HEAD `2a164120926c1d743cbd382044639edff07d97d9`. Source PR heads below were captured while open.

## Method and limitations

For each of the 28 diverged PRs, compare its GitHub PR changed-files API `filename`, `status`, and resulting Git blob `sha` with the Git tree at the pinned umbrella head. A matching blob SHA proves identical complete file bytes; a same-path/different-SHA file requires semantic review; a missing path is not contained under that original filename (it might have been renamed/replaced). Git ancestry alone can miss cherry-picks and semantic inclusion. This is **not** production acceptance, tests or confirmation that a revised file retains every feature. Do not merge #138 to main or close ambiguous PRs on these counts alone.

## File inventory

| PR | Exact head SHA | Changed files | Identical blobs | Present but changed | Missing original paths | Disposition |
|---|---|---:|---:|---:|---:|---|
| [#55](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/55) | `32ed2aeee7b688a397c1a1938cffe3c355327182` | 8 | 2 | 6 | 0 | AUDIT: revised blobs |
| [#56](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/56) | `de10ca83bbba1f2e99ec5787edeb5ac5b20f183d` | 9 | 2 | 7 | 0 | AUDIT: revised blobs |
| [#57](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/57) | `6fadd184bc49cff2c34b017cba9e5894b744272e` | 5 | 2 | 3 | 0 | AUDIT: revised blobs |
| [#59](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/59) | `39c8e16414dd9e26d993961015ecba9500de6733` | 6 | 3 | 3 | 0 | AUDIT: revised blobs |
| [#77](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/77) | `d8480438bf212215d487bf7a697c9c19c4a5fca6` | 12 | 0 | 0 | 12 | HOLD: missing files |
| [#97](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/97) | `d6bd5f3f36881513c17e1add1a6fcf1c96944e01` | 4 | 0 | 0 | 4 | HOLD: missing files |
| [#98](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/98) | `2ea777e527f75f367fe307ce710932d3ba929699` | 4 | 4 | 0 | 0 | CLOSE CANDIDATE: exact blobs |
| [#99](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/99) | `997e61fb727b691caa5bfd1ddb091d734b0fbaf5` | 6 | 5 | 1 | 0 | AUDIT: revised blobs |
| [#100](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/100) | `1e5d5c1b2e2db23458b0c84151e06e31e9c54849` | 8 | 6 | 2 | 0 | AUDIT: revised blobs |
| [#101](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/101) | `16dee6aae75f061869374f8e18d4a56596a7973f` | 7 | 6 | 1 | 0 | AUDIT: revised blobs |
| [#102](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/102) | `96bac7ba583ad4d8e84b9cb6812db566ecdc885f` | 10 | 8 | 2 | 0 | AUDIT: revised blobs |
| [#103](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/103) | `daa8759389cc79b155769c3338697b9332f8840e` | 8 | 6 | 2 | 0 | AUDIT: revised blobs |
| [#104](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/104) | `bd65a307ac6a543998f7a5d9f373695bb324acde` | 5 | 3 | 2 | 0 | AUDIT: revised blobs |
| [#105](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/105) | `733d8f682d586757cdf8372fab6d5c54f815c3f8` | 11 | 9 | 2 | 0 | AUDIT: revised blobs |
| [#110](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/110) | `7431a310f8878233807110d649891d2aaab3df01` | 4 | 0 | 0 | 4 | HOLD: missing files |
| [#111](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/111) | `00aaa4e3a9a16dc7ac9a97a90155d047e7775baa` | 6 | 1 | 5 | 0 | AUDIT: revised blobs |
| [#113](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/113) | `45cae96bcd2ece646fa62a904651cb9346849548` | 4 | 0 | 0 | 4 | HOLD: missing files |
| [#114](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/114) | `6eb288f5f1d6f02f9db7d2cb959c3a985adc4613` | 9 | 0 | 6 | 3 | HOLD: missing files |
| [#115](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/115) | `073094a8c13d323cb9e1b0f8054aba86b03a09d1` | 27 | 8 | 19 | 0 | AUDIT: revised blobs |
| [#116](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/116) | `7e255d339b4dcdde0c48d8b9a6c0e1e19f0dc1a9` | 6 | 4 | 2 | 0 | AUDIT: revised blobs |
| [#117](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/117) | `b091df6f42b34ad41aa3393298a585c21076d0e1` | 8 | 5 | 3 | 0 | AUDIT: revised blobs |
| [#119](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/119) | `e8121b3ce2ff39075bfb50ae091619846bbd57cc` | 16 | 15 | 1 | 0 | AUDIT: revised blobs |
| [#120](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/120) | `623b64daab2633dd29a3e6114638ddbb06e99aa4` | 7 | 7 | 0 | 0 | CLOSE CANDIDATE: exact blobs |
| [#121](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/121) | `8f13933d8573aaa8bb5c09dc692c4191261c960a` | 9 | 7 | 2 | 0 | AUDIT: revised blobs |
| [#122](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/122) | `ce54322105bbce4e762a12def1b3cdd2b79704d4` | 5 | 5 | 0 | 0 | CLOSE CANDIDATE: exact blobs |
| [#123](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/123) | `76a31cc133b5424741b79963f00215ef35f1e388` | 9 | 7 | 2 | 0 | AUDIT: revised blobs |
| [#129](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/129) | `da6670222cee1a74950bedaad30d3072f0989931` | 5 | 4 | 1 | 0 | AUDIT: revised blobs |
| [#130](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/130) | `2acd8fc6bb0226d0f535c462aa41967e3ab526ce` | 13 | 9 | 4 | 0 | AUDIT: revised blobs |

## Directly identified gaps

- **#77:** 12 historical planning documents/agent prompts absent from umbrella tree; documentation-only source PR. Superseded operationally but preserve as archive if closing.
- **#97:** four original planning/lint/manifest/validator files absent. #138 contains newer Memory K independent-audit/production-plan documents, but not these exact originals; preserve/reconcile useful planning and validators before closing.
- **#110:** four native pinned Core IL research tool/report/workflow files absent. This is research tooling, not a production source change; preserve as research reference if closing.
- **#113:** four dual-source/W09 closeout planning/validator files absent. New #138 production plan may replace parts; confirm no unresolved requirement disappears.
- **#114:** EA-derived alternative cross-avatar solution, missing unique EA workflow, handoff and test; all six overlapping production-source files differ from #138. **Do not close without reconciling** with Memory K #115/#121–123 and separate EA umbrella #118.

## Priorities

1. **Exact source-file candidates:** #98 (4/4), #120 (7/7), #122 (5/5) are strong candidates for administrative superseded closure; retain branches.
2. **Near-complete-source candidates:** #99–105, #119, #121, #123, #129 and #130: filenames all present and most exact. Audit diffs in the remainder, specifically the later revisions in #138.
3. **Other revised-code candidates:** #55–57, #59, #111, #115–117: every changed path exists but a higher share is modified; compare behavior/tests before closure.
4. **Keep/resolve uniquely absent artifacts:** #77, #97, #110, #113, #114.
5. **Not part of this round:** #138 and #139–143 remain open. The latter are new repairs not yet integrated. No EA or standalone PRs touched.

Wave 1 audit: [2026-10-13 wave 1](memory-k-pr-cleanup-wave1-20261013.md).
