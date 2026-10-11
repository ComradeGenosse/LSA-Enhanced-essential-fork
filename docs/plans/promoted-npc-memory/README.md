# Promoted NPC memory and experience — project hub

**Status:** accepted architecture; M0 contracts and **M1 offline implementation/acceptance gates** are on this stacked branch. **M2 may begin from the validated M1 head; no production switch or GTA acceptance is implied.** **Only promoted NPCs get persistent personal memory.**

- [Approved decisions](approved-decisions.md) — eight chosen options, including **natural character recall with precise on-demand retrieval**; **Luna cloud curation by default** with **zero additional local curator VRAM**; single P2 SQLite store; long-lived verbatim dialogue archive; timeline safety; two-minute promotion import.
- [M0 boundary contracts and code integration handoff](M0-contract-and-handoff.md) — versioned interfaces, existing source seams, safety invariants and first offline scenario fixtures.
- [M1 shared SQLite and two thin adapters (increments 1–4)](M1-sqlite-foundation-status.md) — reusable P2 validation/CRUD and timeline logic, opt-in Essential storage mode, standalone adapter entrypoint, one-writer lock, and guarded editor timeline UI; JSON remains default.
- [M1 offline acceptance and M2 handoff](M1-offline-acceptance-and-M2-handoff.md) — source write fences, recovery and the M2 branching contract.
- [Implementation roadmap](implementation-roadmap.md) — M0–M10 phased plan, dependencies, integration contracts, migration safety, tests and GTA acceptance. M7 is explicitly **Luna cloud curation**, not a local model.
- [Full architecture study (original investigation)](architecture-study-20261011.md) — original detailed Oct 11 audit, schemas, scenarios, risks and rationale. **Historical recommendations in that source are superseded where they conflict with approved decisions**, particularly local models/embeddings, 60-day quote deletion, hard memory limits and default player identity handling.

## Desired player experience

Nathan and other promoted companions maintain accurate recent event and utterance history, selectively form detailed permanent memories, develop *funny* callbacks, inside jokes, grudges and preferences, and retain personality across sessions. Source facts are never warped to fit a joke. Direct questions receive reliable evidence-driven answers; idle dialogue brings up memories organically and sparingly.

**M0/M1 work is source-only here; merges, installation, live SQLite activation and GTA validation require independent proof.** Existing locked ownership remains until separately changed by the Essential replacement track.
