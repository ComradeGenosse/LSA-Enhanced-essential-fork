# NPCTalk gestures — pinned upstream reference (2026-10-16)

**Reference-only source: not built or executed by LSA.** The files below are copied **verbatim** from [christos-antono/NPCTalk](https://github.com/christos-antono/NPCTalk) commit [`59635ceb8ee010599c3caf9d9d1ee1aa114af91d`](https://github.com/christos-antono/NPCTalk/commit/59635ceb8ee010599c3caf9d9d1ee1aa114af91d).

| Local | Upstream | Git blob SHA |
| --- | --- | --- |
| `NpcActions.cs` | `examples/gta-v/mod/NpcActions.cs` | `fee2be7bde28805ff0c135c774393e675eaf09d2` |
| `ActionCatalog.cs` | `examples/gta-v/mod/ActionCatalog.cs` | `cb727309dca52165c13b7db9d6f9ec72a922c0d0` |
| `Jev.cs` | `examples/gta-v/mod/Jev.cs` | `20592039deefa8f8e733e9dbfb3ee75d5b46d435` |
| `LICENSE` | `LICENSE` | `b64f5205315d649fcdac4c4a7d1bef259b7cf08e` |

MIT © 2026 Christos Antonopoulos. Retain the [MIT license](LICENSE) and original notice with any adapted substantial code.

**Important:** NPCTalk runs GTA V **Legacy**, ScriptHookVDotNet, and its own task scheduler. LSA uses **Enhanced**, RAGE Plugin Hook, native Essential/P2 action ownership, ACT0–ACT2, and a strict LLM response schema. **Never compile these files directly into LSA.** The upstream `Restore()` calls `ped.Task.ClearAll()`; `Sequence()` can force player/NPC positions, weapon changes, and task transitions. Those are expressly prohibited for the visual-only gesture slice.

Review the [implementation plan](../../../plans/npctalk-microexpressions-gestures-implementation-20261016.md) and [agent implementation prompt](../../../handoffs/NPCTALK-MICROEXPRESSIONS-GESTURES-IMPLEMENTATION-PROMPT-20261016.md).
