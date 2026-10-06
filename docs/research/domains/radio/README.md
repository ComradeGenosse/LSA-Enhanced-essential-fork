# Radio Perception Research

**Canonical decision:** D-015.  
**Forward dependency:** PS2 witness → PS3 salience → C-04 PS4 TurnKnowledgeFrame.

Current supporting source/evidence:

- [public metadata source analysis](radio-public-data-source-analysis.md)
- [catalog provenance](radio-track-catalog-provenance.md)
- [validation plan](radio-track-perception-v2-validation.md)
- [current runtime status](../../../radio-track-perception-r0-r2-status.md)

The old implementation-ready v2 plan is preserved at [archive/radio](../../archive/radio/radio-track-perception-v2-implementation-plan-20261004.md) because later convergence changed how model-visible radio context is projected.

Current rule: the sampler produces bounded factual radio state. It never owns a Luna prompt writer. NPC knowledge requires PS2 witness → PS3 salience → PS4 projection.
