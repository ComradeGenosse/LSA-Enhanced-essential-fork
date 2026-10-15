# PR #138 live-deployment recovery checkpoint

This repair branch deliberately starts at the deployed H1/H2 MVP source `2eb5231abc53731a21a0f125fdfb0bd09280519e`. It does not import later integration features or merge `main`. The original PR #138 remains draft. This checkpoint preserves troubleshooting work, not release acceptance.

## Corrections captured in source

- Preserve RAGE's exact hexadecimal pool-handle spelling through native owner intake, original-turn recording and speech receipts. Keep legacy decimal fixture compatibility without numeric identity conversion.
- Accept Core's nonempty exact keyboard text on its existing `testPrompt` wire route as well as `playerText`; retain original current-turn, registered-connection, P1 and D02 checks. Greeting substitution and unknown prompt routes remain denied.
- Keep fresh D02 proof across an unchanged native roster refresh. Individual-frame knowledge notifications must not cancel an otherwise valid history-backed model request. Maintenance cannot refresh the sample TTL or resurrect revoked leases.
- Preserve the confirmed save only across a temporary source interruption within the exact same authenticated host run/world epoch. New startup, epoch changes and ambiguous boundaries still need confirmation. No automatic last-save resume was implemented.
- Carry previously validated identity hints only into a fresh independent P1 verification; never make cached hints authority. Prevent a captured authored character from silently falling back to a generated identity.
- Bound new memory-dependent turn admission while its exact native owner/source returns; fail closed on timeout rather than claim history was provided.
- Expose authenticated read-only memory status and precise admission failures in existing telemetry/editor paths.
- Keep a summoned registered native Ped canonical when Core supplies an equivalent RPH wrapper. Reuse requires native entity equality, exact handle/address, current original anchor and exact live P1 registration. PS enrichment preserves that canonical owned anchor. Death, revocation and physical replacement still invalidate it.
- Include the production RPH radio string-return overload correction and its game stubs, plus the original-turn test synchronization already used by the local production build.

## Evidence and limitations

The keyboard/roster reproduction initially failed to persist native keyboard input. After correcting only that classification, its history-backed request still cancelled when the real per-frame knowledge subscription was enabled. Both cases pass after the two corrections. The registered-wrapper lifecycle regression failed before the native correction and passes afterwards.

Local Windows/Node 24 focused runs recorded 67/67 passing receipt/D02/latency tests and 82 passing history/native-owner/NPC-journal tests with one existing skip (overlapping suites). Native harnesses recorded 204 P2 lifecycle assertions, 319 owner-sampling assertions across 30 scenarios, 165 intelligence integration assertions, and 142 independent-producer assertions. The pinned-SDK production native build succeeded. These counts are scoped evidence, not a full repository or live GTA pass.

The native correction was installed with GTA closed. The most recent full conversational repair has **not** passed a fresh live soda-recall acceptance check. Stored profile/journal/identity data and database main/WAL bytes were verified unchanged across the overlay; no data or secrets belong in this branch.

## Source reconciliation boundaries

At inspection, GitHub's `integration/memory-k-production-20261012` was `6eb50775fe2302157f1bc510d7e93c5d6a511331`, 17 commits ahead of this baseline, including independently activated commands, the inspector/pause feature and later H1 diagnostics/privacy changes. Shared-file overlap includes bootstrap, editor, runtime glue and the P2 store. Review a future integration on a separate candidate, preserving the newer privacy/command fences and adding combined regression coverage. Do not force-push the integration branch or merge it into the troubleshooting baseline merely to remove divergence.

`main` has a separate ElevenLabs/emotional-delivery history and substantial divergence; it is not a safe blanket pull for this deployment. The installed ElevenLabs compatibility restoration is a **separate deployment-only overlay**, with transitive modules absent from this source baseline. Its code-only snapshot was preserved locally during reconciliation. It is intentionally not silently copied into this repair branch or represented as a reproducible voice-enabled release. Port/review it separately before building a replacement companion for the live installation. Do not deploy this branch wholesale expecting it to reproduce that voice overlay.

Publishing this branch or opening its draft PR does not change installed modules, running processes, save selection or character data. Preserve the installed payload/rollback copies while troubleshooting continues; integration and deployment require separate validation.
