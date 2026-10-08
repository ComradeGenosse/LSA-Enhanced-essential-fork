import { ActivityClient } from './activityClient.mjs';
import { ActivityEngine } from './activityEngine.mjs';

// Thin shell: the pipe stays transport, and the engine owns the plan.
export class ActivityRuntime {
  constructor(config, options = {}) {
    this.engine = new ActivityEngine({
      config, registry: options.registry, now: options.now, id: options.id, onEvent: options.onEvent || (() => {}),
      onCommand: frame => this.client?.send(frame),
    });
    this.client = new ActivityClient(config, { ...options, onFrame: frame => this.engine.ingest(frame), onEvent: options.onEvent });
  }
  start() {
    this.client.start();
    if (!this.pulse) {
      this.pulse = setInterval(() => { try { this.engine.tick(); } catch {} }, 100);
      this.pulse.unref?.();
    }
  }
  stop() {
    clearInterval(this.pulse); this.pulse = null;
    try { this.engine.clockReset(); } catch {}
    this.client.stop();
  }
  factsForCharacter(binding) {return this.engine.factsForCharacter(binding);}
  status(characterId) { return this.engine.status(characterId); }
  pause(characterId) { return this.engine.pause(characterId); }
  resume(characterId) { return this.engine.resume(characterId); }
  cancel(characterId) { return this.engine.cancel(characterId); }
  assign(proposal, binding) { return this.engine.assign(proposal, binding); }
  history(characterId) { return this.engine.historyFor(characterId); }
}
