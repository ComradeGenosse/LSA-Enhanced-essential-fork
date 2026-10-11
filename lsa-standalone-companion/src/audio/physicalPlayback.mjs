import { performance } from 'node:perf_hooks';

// Optional S3 physical-output completion barrier. Native PCM EOS remains a
// separate event. No caller of this helper is allowed to infer durable
// dialogue history or that an in-world NPC listener heard the speech.
const pause = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new Error('playback_cancelled'));
  const cancel = () => {
    clearTimeout(timer);
    reject(new Error('playback_cancelled'));
  };
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', cancel);
    resolve();
  }, ms);
  signal?.addEventListener('abort', cancel, { once: true });
});

export async function awaitNativePhysicalPlayback(client, claims, {
  expectedBytes, expectedSegments, signal, onProgress = () => {},
  pollMs = 75, stallMs = 6500, timeoutMs = 35000
} = {}) {
  if (!client?.request || !claims?.streamId || !claims?.audioLeaseId ||
      !claims?.audioGeneration || !claims?.turnId ||
      !claims?.actorIncarnationId || !Number.isSafeInteger(expectedBytes) ||
      expectedBytes < 2 || expectedBytes > 1_440_000 ||
      !Number.isSafeInteger(expectedSegments) ||
      expectedSegments < 1 || expectedSegments > 12 ||
      typeof onProgress !== 'function' || !Number.isInteger(pollMs) ||
      pollMs < 10 || pollMs > 1000 || !Number.isInteger(stallMs) ||
      stallMs < 100 || stallMs > 30000 || !Number.isInteger(timeoutMs) ||
      timeoutMs < stallMs || timeoutMs > 60000)
    throw new Error('invalid_playback_wait');
  const start = performance.now();
  let lastActivity = start, highestBytes = 0, highestSegments = 0;
  let markedSegments = 0, physicalSeen = false;
  for (;;) {
    if (signal?.aborted) throw new Error('playback_cancelled');
    const now = performance.now();
    if (now - start >= timeoutMs) throw new Error('playback_deadline');
    if (now - lastActivity >= stallMs) throw new Error('playback_device_stalled');
    const report = await client.request('audio.playback', claims);
    if (signal?.aborted) throw new Error('playback_cancelled');
    if (report.status === 'device_unavailable') {
      // The output adapter is optional and may not yet have accepted PCM.
      await pause(pollMs, signal);
      continue;
    }
    if (report.status === 'device_failed')
      throw new Error('playback_device_failed');
    if (!['device_progress', 'playback_completed'].includes(report.status) ||
        !Number.isSafeInteger(report.playedBytes) ||
        !Number.isSafeInteger(report.submittedBytes) ||
        !Number.isSafeInteger(report.completedSegments) ||
        !Number.isSafeInteger(report.markedSegments) ||
        report.playedBytes < highestBytes ||
        report.playedBytes > expectedBytes ||
        report.submittedBytes > expectedBytes ||
        report.completedSegments < highestSegments ||
        report.completedSegments > report.markedSegments ||
        report.markedSegments < markedSegments ||
        report.markedSegments > expectedSegments ||
        report.finalSegments !== true || report.sealed !== true ||
        (report.status === 'playback_completed' &&
          (report.playedBytes !== expectedBytes ||
           report.completedSegments !== expectedSegments ||
           report.markedSegments !== expectedSegments)))
      throw new Error('invalid_native_physical_progress');
    physicalSeen = true;
    if (report.playedBytes > highestBytes ||
        report.completedSegments > highestSegments) {
      lastActivity = performance.now();
      highestBytes = report.playedBytes;
      highestSegments = report.completedSegments;
      onProgress({ playedBytes: highestBytes,
        completedSegments: highestSegments, expectedSegments });
    }
    markedSegments = report.markedSegments;
    if (report.status === 'playback_completed') {
      // Consume the EXACT receipt once, atomically retiring the lease.
      // If this acknowledgment fails, do NOT assert a durable completion.
      const receipt = await client.request('audio.playback.ack', claims);
      if (receipt.status !== 'ok') throw new Error('playback_ack_rejected');
      return { status: 'device_playback_completed', verified: true,
        playedBytes: highestBytes, completedSegments: highestSegments,
        historyCommitted: false };
    }
    await pause(pollMs, signal);
  }
}
