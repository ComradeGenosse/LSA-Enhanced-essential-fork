# PR114 repair integration — source authority, legacy cursor, EA regression

Branch `fix/memory-k-pr114-source-authority-replay-20261013` is based on Memory K PR #138 at `a47539cce0d67bd1f33ae6856628522408fa99ce`.

- P2 single-writer queue admission and commit read uses an authority generation and exact source context; revocations, scene/save resets and new host epochs retire stale operations, while benign `host_reload` and identical authenticated source samples preserve continuity.
- Integrated recall is performed through the existing `withP2SqliteRead` scoped, source-confirmed API instead of direct SQL read.
- Legacy v1 replay cursor tokens are accepted only if canonical and exactly scoped to the original requested avatar, and are rewound to position zero for unified-player replay. Forged tokens and wrong avatars stay rejected. Existing v2 cursor CAS, stronger M6 checkpoints, and anti-forgery checks remain intact.
- M7 curation source gate recognizes provenance `multi_avatar` for evidence qualified from multiple player models.
- All six original #114 real-P2 SQLite tests were ported, with three additional regression tests; historical original source blobs archived.
- Node24 Linux and Windows workflow added for focused M1/EA/M4/M5/M6 replay tests.

**Unresolved:** user-selected timeline confirmation still relies on trusted bootstrap/editor control path for its legacy one-argument API; optional explicit confirmation is validated, but this PR is *not* proof of independent physical operator selection. This should be reviewed in the M1/F11 authority UX before deployment. D01/D02 and S01–S10 source/GTA acceptance remain NO-GO until independently validated.

The repair is targeted at the Memory K branch, not EA #118 or `main`, and is not deployed.
