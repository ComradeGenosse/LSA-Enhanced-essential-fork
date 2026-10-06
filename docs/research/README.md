# LSA Research Corpus

This directory is the durable research memory for LSA Enhanced, but **not every preserved artifact is current guidance**.

## Start here

For ordinary implementation/planning work, read in this order:

1. [../ROADMAP.md](../ROADMAP.md) — what is implemented, merged, deployed and GTA-validated.
2. [CURRENT.md](CURRENT.md) — current architecture synthesis.
3. [DECISIONS.md](DECISIONS.md) — durable LOCKED/SETTLED design decisions.
4. [system-contract-register.md](system-contract-register.md) — forward contracts and ownership boundaries.
5. [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) — unresolved probes/questions.
6. The relevant domain README and current phase/status document.

## Search / AI context rule

**Do not use `docs/research/archive/` as current architecture, implementation status or an implementation plan.**

Archive material exists for provenance, evidence archaeology and "why did we decide this?" questions. It can contain old branch SHAs, old test counts, fixed bugs, superseded ownership, and plans that were later changed.

If active and archived material disagree, active material wins in this order:

1. current phase/status docs and `docs/ROADMAP.md`
2. `CURRENT.md`
3. `DECISIONS.md`
4. `system-contract-register.md`
5. active convergence synthesis / ownership / dependency / risk docs
6. domain supporting evidence
7. archive/history

A research finding never implies code is merged, built, deployed or GTA-validated.

## Active convergence package

- [system-convergence-architecture.md](system-convergence-architecture.md)
- [system-contract-register.md](system-contract-register.md)
- [system-ownership-matrix.md](system-ownership-matrix.md)
- [system-convergence-dependency-graph.md](system-convergence-dependency-graph.md)
- [system-convergence-risks.md](system-convergence-risks.md)
- [system-contracts.v1.json](system-contracts.v1.json)

The original October 5 audit package is preserved under [archive/convergence/](archive/convergence/) and is historical evidence only.

## Domains

- [Essential / native authority](domains/essential/README.md)
- [Identity / memory](domains/identity/README.md)
- [Perception / salience / Director](domains/perception/README.md)
- [Activities / physical execution](domains/activities/README.md)
- [Radio perception](domains/radio/README.md)
- [UX / targeting](domains/ux/README.md)
- [Conversation gaze](domains/gaze/README.md)
- [Social routing](domains/social/README.md)

## Corpus metadata

[CORPUS.json](CORPUS.json) is the machine-readable provenance/index map. Historical documents are indexed at their archive paths rather than their old active paths.

Run:

```bash
node docs/research/tools/validate-corpus.mjs
```

The validator checks indexed paths, canonical files, unique IDs, supersession/incorporation references and links in entry/domain documents.
