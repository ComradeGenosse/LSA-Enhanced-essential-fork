# Existing-key gestures

The optional UX router now supports Essential's existing MarkPedKey and TextKey.
For this installation L4 is F9, R4 is Mouse5, and Menu is F11. Steam's original
upper rear paddles already emit F9 and Mouse5; its lower pair remains F10/Mouse4.
The names L4/R4 in the settings are logical inputs, not controller device IDs.

The pinned Essential DLL's InputController bool(int) polling helper (metadata
token 100663647) calls GetAsyncKeyState and tests its high bit. An optional
Harmony prefix inside Essential's AppDomain overrides only the two configured
mark/text keys. Core SHA256 and the exact method signature are checked before
patching. The installed 0Harmony library is reused, never packaged or replaced.
Neither the Core DLL nor Essential's key config is rewritten.

The loader continues polling the physical keys. Before deciding a gesture it
renews a 500 ms lease, suppressing Essential's immediate mark/text actions. A
single action queues one virtual down sample for the stock helper. A chord
dispatches current.follow and a chord hold opens the current-NPC menu. Shared
keys never use SendInput, preventing feedback into the router. Unshared relay
keys retain the original relay. Both push-to-talk keys are never intercepted;
if a mark/text key is also a talk key, the router suspends with a conflict.

Focus loss, input gates, settings changes, gesture pause and shutdown
release the lease, cancel virtual pulses and suppress previously intercepted
held keys until release. Expiry does the same if the loader stalls. The patch
then passes stock input through, and an expired pulse cannot be revived by
renewal. A missing hook suspends shared-key gestures and leaves stock input
available. The prefix stays inert after release until the domain unloads.

Shared mark/text keys stay leased in the UX menu so physical gestures cannot
open stock text input over the menu. Explicit menu mark/text actions still use
virtual polls. Both talk keys retain their stock behavior while menus are open.

The Controls page shows physical keys beside gesture names. Logs include hook
installation, physical-key masks and recognized gesture IDs (never typed text).

RPH shadow-copies Core into a temporary directory. Resolve installed Harmony
from AppDomain.BaseDirectory, not from Core.Location. Core.Location remains the
source for the Core fingerprint check. On failure, logs include the loading
stage and missing filename. A standalone shadow-copy AppDomain probe reproduces
the old FileNotFoundException and verifies the corrected path and poll hook.

An independent main-menu recognizer retains F11 when interception is unavailable
or a paddle-key conflict suspends shared gestures. It still observes focus and
game/input gates, requests native snapshots and permits only non-conflicting
main-menu keys. Shared gestures remain disabled until the hook succeeds. Tests
cover opening/closing F11 across failed-hook retries without shared-key relays.

Offline verification includes shared-key taps, chords in either order, holds,
PTT passthrough, focus-loss recovery, lease expiry, pending-pulse cancellation
and rebinding. A standalone probe checks the installed Harmony API. Physical
controller acceptance still requires GTA: tap each upper paddle, tap both,
hold both, then check PTT and focus/menu recovery. The input source observes
keyboard/mouse state; it cannot distinguish a paddle from a real keyboard key.
