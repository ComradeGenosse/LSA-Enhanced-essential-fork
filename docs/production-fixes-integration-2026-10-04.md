# Production fixes integrated into main — October 4, 2026

Integration starts from GitHub main `bc3b2027b0b2eb6a3c1a7dcb326587f9af781696` and preserves both source branches through merge commits:

- `fix/existing-key-gestures`, tip `3a78067989a89ee0684290045db106fb8a25e531`: Essential mark/text interception, application-base Harmony resolution, and independent F11 handling.
- `feature/ps2-witness-rules-episode-correlation`, tip `5ea77f8d28833a439da1370aa5bdada31e53c45f`: witness policy, episode correlation, injury/report/harm fixes, and offline host framework references.

The project-file conflict retains both the input interception sources and PS2 WitnessPolicy. The roadmap keeps the newer activity architecture and updates PS2 to merged status. Source-time player-speech hearing stays disabled pending the native capture receipt probe.

Validation of the combined source:

- Companion regression: 370 tests passed, zero failures.
- Input/settings/dispatch/menu: 402 assertions passed.
- Production intelligence sources: 76 assertions passed.
- Production intelligence integration: 41 assertions passed.
- AppDomain command bridge: 245 assertions passed.
- Continuous runtime host lifecycle: 10 assertions passed.
- Companion build: successful, 48 pinned patches; bundle SHA256 `7b4d461fe14976cd454be4babc0d84c1b350d4753ff378e681e819a02a934cde`, matching the installed PS2 companion.
- Combined native addon build: successful with pinned Essential, RPH, DamageTracker and RAGENativeUI references.

Validation is offline. This integration does not deploy artifacts or establish GTA/controller acceptance. The installed companion and native addon had separate PS2 and input-fix provenance; the combined native build now contains both sets of source changes.

The pre-integration GitHub main is retained on `safety/main-before-production-fixes-20261004`. Existing feature/fix branches and working directories are preserved. No credentials, personal profiles, production configurations or rollback backups are added to GitHub.
