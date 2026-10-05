# Existing-key input interception

Updated October 5, 2026.

The optional UX layer can reuse Essential's existing physical keys without rewriting `LosSantosAlive.config` or injecting duplicate OS input.

For the gesture router, shared **MarkPedKey** and **TextKey** use one lease owner. UX4 optionally uses a separate **TalkKey** lease owner. `MarkedPedTalkKey` is never intercepted.

The pinned Essential DLL's `InputController bool(int)` polling helper (metadata token `100663647`) calls `GetAsyncKeyState` and tests its high bit. An optional Harmony prefix inside Essential's AppDomain overrides only keys that currently have an active LSA lease. Core SHA-256 and the exact method signature are checked before patching. The installed 0Harmony library is reused, never packaged or replaced. Neither the Core DLL nor Essential's key config is rewritten.

## Router lease — Mark/Text

The loader continues polling the real physical keys. While a shared Mark/Text gesture is active, the router renews a 500 ms lease that suppresses Essential's immediate physical poll. A single Mark/Text action queues one virtual down sample for the stock helper; chords consume the physical gesture without generating the individual stock actions. Shared keys never use `SendInput`, avoiding feedback into the router. Unshared relay keys retain the older relay path.

## UX4 Talk lease

When `talkTargeting.key` equals Essential's configured `TalkKey`, UX4 acquires an **independent Talk lease**. UX4 still reads the real physical key through its loader-side key source while the Harmony prefix reports that same physical Talk key as released to Essential. That prevents Essential's generic Talk handler from firing a second time.

The two owners are independent:

- router lease: Mark/Text pulses and chords;
- UX4 lease: suppression-only Talk ownership.

Renewing or releasing the router lease cannot drop UX4 Talk interception, and releasing UX4 cannot erase pending Mark/Text pulses.

UX4 then applies its own tap/hold semantics:

- normal hold → direct Talk to the best current candidate, no selector bracket;
- tap → explicit selector;
- repeated tap → cycle;
- hold with an explicit target → exact-Ped PTT.

`MarkedPedTalkKey` continues through Essential unchanged.

## Release and failure behavior

Focus loss, input gates, settings changes, gesture pause and shutdown release the relevant owner lease. A released or expired key that is still physically held is drained until the real key comes up, preventing a synthetic half-press from suddenly reaching Essential. Expired pulses cannot be revived by lease renewal.

If the Harmony hook cannot be installed, shared gestures fail closed. UX4 shared-Talk mode also fails closed rather than allowing both UX4 and stock generic Talk to fire. Once interception is released and the physical key has come up, stock Essential behavior resumes.

Shared Mark/Text keys stay leased while the LSA menu owns input so physical gestures cannot open stock text input over the menu. Explicit menu Mark/Text actions still use virtual polls. UX4 Talk is stopped/released when its gates close; Marked Talk remains independent.

## Diagnostics and verification

The Controls page shows physical keys beside gesture names. Logs include hook installation, physical-key masks, recognized gesture IDs and UX4 shared/neutral Talk mode; they never log typed text.

RPH shadow-copies Core into a temporary directory. Harmony is resolved from `AppDomain.BaseDirectory`, while `Core.Location` remains the fingerprint source. On failure the log includes the stage and missing filename.

Offline coverage includes:

- shared Mark/Text taps and chords in either order;
- router lease expiry/rebinding/pulse cancellation;
- independent router-vs-Talk lease renewal/release;
- Talk release draining a held key before stock input returns;
- shared UX4 Talk fail-closed behavior;
- focus-loss recovery and failed-hook behavior.

Physical controller acceptance still requires GTA. The October 5 shared-Mouse4 run proved three UX4 microphone turns without a duplicate stock generic Talk turn. The later direct-Talk/explicit-selector refinement on `main@d7d8311` still needs a fresh exact-main GTA pass.
