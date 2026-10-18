# Personal test defaults (October 18, 2026)

The personal fork now starts with **testable, implemented optional features requested on**
when a config is loaded from disk, including on older existing JSONs. Existing actor
ownership, C-06 player priority, original native proof, receipt/availability,
cancellation, ACT passed-probe requirements and privacy checks are **not** bypassed.

* Companion: `loadConfig` applies `personalTestDefaults.mjs` before validation.
  PS6 spontaneous speech, PS4 knowledge, ACT3/5/6 request switches, M2–M9
  supported Memory K modes, reactions (including nod/shrug), and ElevenLabs
  emotional delivery are requested on. It never manufactures ACT probe results.
* Native: `RuntimeEntry.Start` requests PS1 producers, PS6 Director, ACT host
  and receipts, M9 event families, reactions and radio. Mouth/facial overlay
  stays **off**. The promoted-character native packaging helper compiles the
  experimental M9 sampler with `-p:LsaM9Native=true`.
* To return to your exact manually configured modes, set
  `"personalTestMode": false` in **both** JSON configs and restart.
  This is a per-file opt-out; absent means test defaults **on**.
* **M7 paid processing still requires independently recorded P2 cloud approval,
  valid price evidence, verified native idle, a current writable timeline and
  its configured budget.** Setting a mode never authorizes cloud upload or
  billable usage. The existing inspector's one-time approval and budgets apply.
* `passedProbes` remains an unforgeable *operator assertion*, **not** a
  runtime PASS. Capabilities without required probes stay unavailable, and
  none of the new features are claimed GTA-accepted without a real game run.
* Standalone M10, PS7/ACT7, unsupported sensors/actions and safe facial
  expression animation are not implemented and cannot be enabled.

## Deployment

A GitHub commit **does not update your installed GTA files**. Build and install
matching new companion/native payloads with the existing pinned-reference build
and deployment procedure (including a new M9-enabled native DLL), then restart.
Use `[PS] m9_sampler_requested` and the E1 Memory K capability diagnostics
to distinguish requested, registered, and actually observed operation.
