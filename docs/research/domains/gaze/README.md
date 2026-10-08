# Conversation Gaze / Engagement Research

**Canonical decision:** D-014.  
**Forward dependencies:** C-02/C-13 plus existing native playback/ownership probe for 10a; C-01 source-time player lifecycle additionally for 10b. Full proximity hearing is not a listening-gaze prerequisite.

The implementation plan is maintained at:

- [../../../plans/conversation-gaze-engagement/README.md](../../../plans/conversation-gaze-engagement/README.md)
- [../../../plans/conversation-gaze-engagement/runtime-contract.md](../../../plans/conversation-gaze-engagement/runtime-contract.md)
- [../../../plans/conversation-gaze-engagement/implementation-plan.md](../../../plans/conversation-gaze-engagement/implementation-plan.md)
- [../../../plans/conversation-gaze-engagement/gta-validation.md](../../../plans/conversation-gaze-engagement/gta-validation.md)

Current rule: CGE is supplemental head/eye attention only, yields to Essential's own conversation look behavior, and never owns whole-body orientation. ACT3 owns `stop_and_face`.

The [unified intelligence master plan](../../UNIFIED-LSA-INTELLIGENCE-IMPLEMENTATION-PLAN-20261008.md#10-conversation-gaze-and-attention-evidence) reconciles this domain with all C-01–C-15 contracts and supplies exact integration phases/tests/gates. Baseline PS4 does not wait for optional enrichment; original research/provenance and the detailed PS4 plan remain preserved.
