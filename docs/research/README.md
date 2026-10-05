# LSA Research Corpus

This directory is the durable research memory for LSA Enhanced.

It exists so a human, Codex, Astra, or another future agent can enter the repository cold and answer four different questions without conflating them:

1. **What is implemented/deployed now?** → [../ROADMAP.md](../ROADMAP.md)
2. **What do we currently believe architecturally?** → [CURRENT.md](CURRENT.md)
3. **What contracts and decisions govern future work?** → [system-contract-register.md](system-contract-register.md) and [DECISIONS.md](DECISIONS.md)
4. **Why do we believe it?** → domain research and evidence indexed by [CORPUS.json](CORPUS.json)

## Authority order

When documents disagree, use this order:

1. **Current implementation/deployment state:** `docs/ROADMAP.md` and the relevant phase status document.
2. **Current architecture:** `docs/research/CURRENT.md`.
3. **Forward contracts:** `docs/research/system-contract-register.md`.
4. **Durable design decisions:** `docs/research/DECISIONS.md`.
5. **Convergence rationale:** `docs/research/system-convergence-architecture.md`.
6. **Domain research/evidence:** supporting or historical material.
7. **Branch snapshots / old plans:** evidence of what was investigated, not automatic implementation authority.

A research finding does **not** imply that code is merged, built, deployed, or GTA-validated. The roadmap keeps those states separate.

## Corpus status vocabulary

- **canonical** — current source of architectural truth.
- **supporting** — current evidence/rationale that informs canonical docs.
- **historical-source** — preserved primary research; useful for provenance but later synthesis may supersede conclusions.
- **superseded** — retained for history; do not implement directly without reading the successor.
- **current-status** — current implementation/deployment truth rather than architecture.
- **open-question** — requires a probe, implementation evidence, or GTA validation.

Decision maturity:

- **LOCKED** — do not redesign without contradictory evidence.
- **SETTLED** — expected design; implementation may refine details.
- **PROVISIONAL** — likely direction; verification can still change it.
- **UNKNOWN** — no trustworthy answer yet.

## Navigation

Start here for new work:

```text
README.md
   ↓
CURRENT.md
   ↓
DECISIONS.md + system-contract-register.md
   ↓
relevant domains/<domain>/README.md
   ↓
source research / evidence
```

The [system convergence architecture](system-convergence-architecture.md), [ownership matrix](system-ownership-matrix.md), [dependency graph](system-convergence-dependency-graph.md), [risk register](system-convergence-risks.md), [evidence](system-convergence-evidence.json), and [machine contracts](system-contracts.v1.json) form one research package.

## Domains

- [Essential / native authority](domains/essential/README.md)
- [Identity / memory](domains/identity/README.md)
- [Perception / salience / Director](domains/perception/README.md)
- [Activities / physical execution](domains/activities/README.md)
- [Radio perception](domains/radio/README.md)
- [UX / targeting](domains/ux/README.md)
- [Conversation gaze](domains/gaze/README.md)
- [Social routing](domains/social/README.md)

## Preservation policy

The corpus is **additive**.

Existing research files are not deleted merely because they are superseded. Branch-only primary research may be copied into a domain as an immutable snapshot while the original branch remains intact. The domain README records the source branch and how later work incorporated or superseded it.

Do not silently rewrite an old research result to make it look as if it predicted newer architecture. Add a supersession note or update a canonical synthesis instead.

## Machine use

`CORPUS.json` is the machine-readable catalog. Run:

```bash
node docs/research/tools/validate-corpus.mjs
```

The validator checks canonical files, unique IDs, local corpus paths, supersession targets, and relative links in the corpus entry documents.
