# ASTRA-002 E0 | Owner GTA acceptance: PENDING

All boxes are unchecked until backed-up laboratory GTA evidence exists. The Windows SDK build is NOT a GTA runtime test.

## Exact version evidence to capture

- GTA V Enhanced executable version: not measured
- RPH runtime version: not measured
- Essential binary hash: not measured (helper enforces P2's known-good pin)
- AGM E0 plugin hash: from CI build-evidence.json
- OBS2 manifest hash: not captured
- Save backup, mod inventory, GPU load, game session date, screen capture timecodes: not recorded

## Gates

- [ ] E0.1: 20 each ped / vehicle / prop / pickup; readback ≥95% each
- [ ] E0.1 extended: 16 sequential five-second holds (4 per kind), 1s/5s readback, all 80 checked 250/750 ms post-cleanup
- [ ] E0.1 model variation: compare four allowlisted ped/vehicle/prop variants, annotate invalid-class refusals and weak pickup identity
- [ ] E0.1 passive side effects: Essential NpcState samples, Nathan/Director/ACT + OBS2/video comparison, no E0.1 task writes
- [ ] E0.1 per-spawn and delete latency and enumerated population vs pool capacities; no claim of actual frame-time or free-slot headroom
- [ ] E0.2: 10 independent 60 s trials for walk/drive/flee/guard/chase per condition; yield-on retention ≥90%
- [ ] E0.2 controls: Essential off; Essential on with yielding off; Essential on with yielding on
- [ ] E0.3: 100 / 250 / 400 / 800 m over 5 min + streaming and save reload
- [ ] E0.4: relationship group and combat with no ambient/police/Nathan collateral
- [ ] E0.5: 4 Hz sensor data with video ground truth, ≤2% verified error
- [ ] E0.6: cross-correlated Essential state, PerceptionSnapshot, reflex, conversation and Luna utterances
- [ ] E0.7: clean cancel, plugin reload, crash recovery, save reload, zero orphans
- [ ] E0.8: pool headroom for 12 peds + 6 vehicles and ≤0.5 ms total frame impact
- [ ] Terminal / Grapeseed / Vinewood Blvd / Del Perro, day and night
- [ ] Nathan present/absent; no task commands to ambient or existing companion actors
- [ ] No changes to production ACT, P2, Director or mission flag
- [ ] Full video/OBS2/log bundle and sample denominators uploaded

The central E0.2/E0.6 result determines whether a general scene actor executor is viable. <50% retention with yielding invokes ASTRA-002 FF-1 and blocks E1. **Current verdict: GTA unverified.**
