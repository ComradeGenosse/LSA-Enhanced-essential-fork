# Social Routing / Multi-character Research

**Canonical decisions:** D-004, D-005, D-008, D-013.  
**Forward contracts:** C-01, C-04, C-11, C-12.

Primary source architecture is the preserved [../perception/perception-salience-scene-director-architecture.md](../perception/perception-salience-scene-director-architecture.md), interpreted through the convergence audit.

Current sequence:

```text
one utterance
  → PS2 hearing / address evidence
  → PS3 relevance
  → responder reservation / turn-yield (C-12)
  → PS4 knowledge frame
  → Director proposal
  → ACT7 directed-interaction execution when physical DI is required
```

Do not fan one utterance into independent STT/model stacks per nearby NPC. Do not let the Director become a second physical executor.
