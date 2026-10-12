# T1 native accepted-turn source audit — investigation only

Source: draft T1 PR #103 @ `daa8759389cc79b155769c3338697b9332f8840e`.
Target: T1 feature branch `feature/memory-k-t1-native-c01-20261011`.
Provenance: exact pinned `lsa-essential-e1-candidate/upstream/LosSantosAlive.dll`, SHA-256 `9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653`.

## Actual limitation
The original Core presently exports input *entry* methods such as `InputController.SendTextPrompt`, `InputController.SendMicStop`, and `TextInputService.StartTextInputMode`. The existing Harmony `EssentialPlayerPriorityMonitor` observes these method **entries** to invalidate quiet grants, not final accepted input. Neither an input entry nor an NPC `NpcPlaybackCoordinator.TryAuthorizeTurn` nor `TryDirectorOriginalTurnBinding` provides an ordinary final accepted player typed/STT `pedId/turnId/generationId/sessionNonce` source. No meaningful C-01 positive receipt can be emitted until an actually post-acceptance original source is identified.

## New read-only research instrument
`native/intelligence/memory-c01-audit/Program.cs` hashes and inspects the pinned Core PE without executing it. It inventories private and public methods, records method-to-method IL calls with offsets, and outputs an auditable method graph covering InputController, TextInputService, ConversationHydrationCoordinator, input/turn generation and acceptance-related names. CI builds it on Windows .NET10 and uploads the JSON evidence artifact. This is useful for locating a precisely pinned IL acceptance point that can be *independently source-audited*, including methods not covered in the repository's public native metadata snapshots.

The audit has a deliberately fixed `nativeAcceptedTurnReceiptVerified:false` and `A01_BLOCKED_PENDING_SEMANTIC_ORIGINAL_ACCEPTANCE_SOURCE`. Its successful build, JSON output, a substring match, or a candidate native method is **not evidence** that the original callback accepted an ordinary turn. Passing an audit workflow never flips production authority.

## If a real source is found
1. Check exact original IL and control flow showing a **successful final accepted turn**, with all four tuple identities and the actual native owner/controlled player. Input submit, mic release, method entry, model generation and stock Director entitlement are insufficient.
2. Add a **post-acceptance** Harmony observation against that pinned method/token/signature only, or a supported original Core event subscription, with strict SHA/hash and execution-context gates. Avoid changing stock input behavior.
3. On existing native owner fiber, correlate a bounded original Core event with P2 current native owner/protagonist and emit the T1 proposed v2 proof only upon valid original semantic acceptance, preserving v1 `acceptedTurns=[]`.
4. K registers exact version negotiation and authenticated intake. Only after original Node24/CLR tests and source evidence can `PinnedSourceExposed` and the A01 gate be reconsidered.

If no original post-acceptance native signal exists, do not fake an IL hook: either extend a new **approved, separately versioned** original backend acceptance + native corroboration contract, or keep M2 C-01 disabled. A changed trust model must be reviewed explicitly against PR #97; it cannot be silently represented as a native-original callback.

**No product code or GTA binaries are mutated by this investigation; A01 and controlled-GTA remain NO-GO.**
