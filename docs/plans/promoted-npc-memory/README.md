# Promoted NPC memory and experience — project hub

**Design status:** accepted product direction / implementation not started in this PR. **Only promoted NPCs get persistent personal memory.**

- [Approved decisions](approved-decisions.md) — eight chosen options, including **natural character recall with precise on-demand retrieval**; **Luna cloud curation by default** with **zero additional local curator VRAM**; single P2 SQLite store; long-lived verbatim dialogue archive; timeline safety; two-minute promotion import.
- [M0 boundary contracts and code integration handoff](M0-contract-and-handoff.md) — versioned interfaces, existing source seams, safety invariants and first offline scenario fixtures.
- [Implementation roadmap](implementation-roadmap.md) — M0–M10 phased plan, dependencies, integration contracts, migration safety, tests and GTA acceptance. M7 is explicitly **Luna cloud curation**, not a local model.
- [Full architecture study (original investigation)](architecture-study-20261011.md) — original detailed Oct 11 audit, schemas, scenarios, risks and rationale. **Historical recommendations in that source are superseded where they conflict with approved decisions**, particularly local models/embeddings, 60-day quote deletion, hard memory limits and default player identity handling.

## Desired player experience

Nathan and other promoted companions maintain accurate recent event and utterance history, selectively form detailed permanent memories, develop *funny* callbacks, inside jokes, grudges and preferences, and retain personality across sessions. Source facts are never warped to fit a joke. Direct questions receive reliable evidence-driven answers; idle dialogue brings up memories organically and sparingly.

**Do not confuse this documentation PR with source implementation, merge, installation or GTA validation.** Existing locked ownership remains until separately changed by the Essential replacement track.
