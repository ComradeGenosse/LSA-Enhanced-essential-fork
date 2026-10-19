# E0.0–E0.12 operator acceptance checklist

The experiment requirements are from ASTRA-001 document 04 and the authority, measurement and cleanup rules from document 03. **No GTA run has been completed. No positive physics conclusion is claimed.** Every item starts NOT_TESTED; OFFLINE_READY requires actual Windows SDK compilation and tests.

| Probe | GTA evidence required | Initial status |
| --- | --- | --- |
| E0.0 | Genuine SDK / runtime/member import evidence, exact RPH/game and optional tool versions; no-op command | NOT_TESTED |
| E0.1 | Each safe read-only native and each dedicated opt-in mutation family reports true success or exception | NOT_TESTED |
| E0.2 | 30 CodeWalker measured surfaces, native hit/material, joaat variants and hash-matching table | NOT_TESTED |
| E0.3 | 10 measured walls; forward, reverse and inside-solid probes and thickness error | NOT_TESTED |
| E0.4 | Independently count single, burst, auto, shotgun pellets and isolated NPC rounds vs first-hit native proof | NOT_TESTED |
| E0.5 | Native bullet, actor LOS, player traversal, and +1/+5/+30-frame post-deletion probe collision and milliseconds | NOT_TESTED |
| E0.6 | 0.5–10 cm offsets, native damage, correct shooter in callbacks, player self-hit and duplicate-hit checks | NOT_TESTED |
| E0.7 | Model hiding of vanilla object and building archetype, visual and collision results, clean restoration | NOT_TESTED |
| E0.8 | Vanilla fragment prop before/after selected child break; health, index semantics and collision | NOT_TESTED |
| E0.9 | Explicit arm; 100/250/500/1000/2000 props as safe, crashes/failures, p95/p99 frame timing, fragment comparison | NOT_TESTED |
| E0.10 | Multiple explosion types, including player grenade, native detection latency/type/owner and negative control | NOT_TESTED |
| E0.11 | Known vanilla geometry IPL, 20 cycles, collision before/after and cleanup matching original state | NOT_TESTED |
| E0.12 | Slow-motion 0.2–1.0, elapsed clocks, moving debris and re-emitted bullet physical behavior and full restoration | NOT_TESTED |

**Routing decisions from doc 04:** E0.4 <90% confirmed full-auto round coverage means deeper capture research; E0.5 >100 ms phantom prop collision means deleted entities may be unsound; E0.9 <300 usable entities requires smaller/merged kits; E0.11 collision remaining static means native vanilla IPL swaps do not prove latent twin activation.

Record a works / partial / no / crash hypothesis judgment separately from the five execution statuses. A successful compilation, even with the genuine SDK, is not GTA_VERIFIED. Follow all cleanup and negative controls before deciding architectural viability.

**Known acceptance blockers:** 30/10 CodeWalker ground-truth surfaces and native game installation test points; safe NPC-shooter control and reliable per-pellet impact capture; authoritative E0.6 damage attribution callbacks; E0.5 movement/actor LOS and E0.8 child-index evidence; actual selected IPL with measurable collision; and attended GTA runtime sessions. A real crash or failure must remain visible and must not be changed into a passing verdict. This PR is experimental, aimed at the research branch, never main.
