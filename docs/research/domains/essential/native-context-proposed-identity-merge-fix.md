# Proposed fix: preserve native demographics during OpenAI integration merging

Status: investigation proposal only. No production implementation is changed. Baseline: `main` at `612dd99b5a5442dd973f975a71abd91920b8a4fe`.

**PROVEN:** The stock actor normalizer can replace native/core gender with a private optional identity field before the OpenAI connection chooses its profile. `ia` normalizes integrations through `hO`, then calls `EO`; `EO` calls `Ev` on both integration objects and nested objects. `_O` excludes the `identity` container but does not exclude `gender` inside the separately visited identity object. `Ev` writes nonempty matching actor keys.

The accepted-input counterexample is:

```json
{
  "pedId": "17",
  "exists": true,
  "pedModel": "custom",
  "gender": "unknown",
  "ageRange": "unknown",
  "integrations": {
    "policingRedefined": {
      "detected": true,
      "identity": { "gender": "female" }
    }
  }
}
```

**PROVEN, offline:** With the investigation's four-voice configuration, real `ia -> Zi -> Xn -> OpenAIConnection` selects shimmer with normalized `gender=female`. Direct core-only resolution selects onyx with `gender=unknown`. Both use `vp_0dc5c45f41c5b134b88d` for PedId `17`, nonce 1: profileId derives from identity, so equal IDs do not prove equal input traits. [Exact results](native-context-evidence/openai-edges.json), [source boundary functions](native-context-evidence/stock-boundaries.txt), [reproduction](native-context-tools/openai-edges.mjs).

**PROVEN:** The inspected PR bridge (SHA-256 `712f9491c0693d496ea82b1e4cefaa03c0575408a2fefa8d9e295bb516e5ad3e`) does not emit ped `identity.gender`. Its emitted names, birthday and modelAge do not trigger the gender collision in the companion bridge-shaped fixture. **UNKNOWN:** Whether another actual producer emits the colliding member in this installation. This is a latent supported-input defect, not an observed live PR record or a new native classifier defect.

**INFERRED, proposed remedy:** Add an OpenAI-only exclusion of `gender` and `ageRange` when flattening optional integration records. Keep their explicit native actor fields as the voice inputs. `ageRange` is protected by the same contract, although the demonstrated PR identity counterexample uses `gender`. Preserve existing integration containers and persona/role description handling. Keep Gemini's existing behavior unchanged.

The [unapplied proposed diff](native-context-tools/proposed-demographic-guard.patch) adds one exact AST hook to the existing build patcher. `git apply --cached --check` verifies applicability against the repository index without changing it or the feature. The offline probe wraps the same real `_O` with the proposed predicate only inside its VM and verifies the counterexample retains core `unknown` gender. This validates the predicate, not a production rebuild with the proposal applied.

A future implementation PR should add regressions through the actual normalizer for both demographic keys and for nonempty native values, verify OpenAI's profile uses the preserved actor values, and check Gemini and existing persona/outfit merging remain unchanged. It should also verify the extra AST edit count and output manifest. No durability redesign, PR-to-age adapter, reroll behavior or patch to the settled `old -> older` mapping is proposed.
