import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a,b) => a-b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] : null;
}

export function summarizeRecords(records, { malformedLines = 0, truncatedTail = false } = {}) {
  const runs = new Map();
  for (const row of records) {
    if (row?.schemaVersion !== 1 || typeof row.runId !== 'string' || typeof row.event !== 'string') continue;
    const run = runs.get(row.runId) || { runId: row.runId, events: 0, turns: new Map(), usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, known: new Set() }, dropped: 0 };
    run.events++;
    const key = row.identity ? [row.identity.pedId,row.identity.turnId,row.identity.generationId,row.identity.sessionNonce].join(':') : null;
    if (key) {
      const turn = run.turns.get(key) || { identity: row.identity, source: row.source || 'unknown', events: [], terminal: null };
      turn.events.push(row);
      if (row.event === 'turn_terminal_summary') turn.terminal = row.data || {};
      turn.events.at(-1).data ||= {};
      run.turns.set(key, turn);
    }
    if (row.event === 'model_usage') for (const field of ['inputTokens','outputTokens','totalTokens']) if (Number.isFinite(row.data?.[field])) { run.usage[field] += row.data[field]; run.usage.known.add(field); }
    if (row.event === 'telemetry_records_dropped') run.dropped += Number(row.data?.dropped || 0);
    runs.set(row.runId, run);
  }
  return [...runs.values()].map(run => {
    const turns = [...run.turns.values()].map(turn => {
      const counts = event => turn.events.filter(row => row.event === event).length;
      const requests = turn.events.filter(row => ['provider_request_finished','provider_request_failed'].includes(row.event)).map(row => ({ operation: row.data?.operation || 'unknown', outcome: row.event.endsWith('failed') ? 'failed' : 'finished', durationMs: row.data?.durationMs ?? null, bodyReadMs: row.data?.bodyReadMs ?? null, handoffMs: row.data?.handoffMs ?? null }));
      const phases = turn.events.filter(row => ['phase_finished','phase_failed'].includes(row.event)).map(row => ({ operation: row.data?.operation || 'unknown', outcome: row.event.endsWith('failed') ? 'failed' : 'finished', durationMs: row.data?.durationMs ?? null }));
      const usage = turn.events.filter(row => row.event === 'model_usage').at(-1)?.data;
      const byEvent = event => turn.events.find(row => row.event === event);
      const headerDuration = operation => turn.events.find(row => row.event === 'provider_headers' && row.data?.operation === operation)?.data?.durationMs ?? null;
      const elapsed = event => byEvent(event)?.elapsedMs ?? null;
      const started = elapsed('native_playback_started');
      const ended = elapsed('native_playback_ended');
      const streamEnded = elapsed('native_stream_end_handoff');
      const authRequested = elapsed('native_authorization_requested');
      const authAccepted = elapsed('native_authorization_accepted');
      const inputReady = elapsed('input_ready');
      const providerWorkMs = phases.find(span => span.operation === 'provider_work')?.durationMs ?? null;
      return {
        identity: turn.identity, source: turn.source, terminalReason: turn.terminal?.terminalReason || 'missing_terminal_summary',
        stage: turn.terminal?.stage || null, totalDurationMs: turn.terminal?.durationMs ?? null,
        requests, phases, providerWorkMs,
        timings: {
          inputReadyDelayMs: byEvent('input_ready')?.data?.durationMs ?? null,
          sttMs: requests.find(span => span.operation === 'stt')?.durationMs ?? null,
          sttHeadersMs: headerDuration('stt'),
          modelMs: requests.find(span => span.operation === 'model')?.durationMs ?? null,
          modelHeadersMs: headerDuration('model'),
          ttsMs: requests.find(span => span.operation === 'tts')?.durationMs ?? null,
          ttsHeadersMs: headerDuration('tts'),
          ttsFirstByteMs: byEvent('provider_first_byte')?.data?.durationMs ?? null,
          ttsFirstPcmMs: byEvent('pcm_first_ready')?.data?.durationMs ?? null,
          firstForwardedPcmAfterInputMs: byEvent('pcm_first_forwarded')?.data?.durationMs ?? null,
          authorizationMs: authRequested !== null && authAccepted !== null ? Math.max(0, authAccepted-authRequested) : null,
          inputToPlaybackStartedMs: inputReady !== null && started !== null ? Math.max(0, started-inputReady) : null,
          observedPlaybackMs: started !== null && ended !== null ? Math.max(0, ended-started) : null,
          completionWaitMs: streamEnded !== null && ended !== null ? Math.max(0, ended-streamEnded) : null,
        },
        usage: usage ? Object.fromEntries(['inputTokens','outputTokens','totalTokens','cachedInputTokens','reasoningTokens'].map(name => [name, usage[name] ?? null])) : null,
        pcmBytes: turn.terminal?.pcmBytes ?? turn.events.filter(row => row.event === 'pcm_delivery_summary').at(-1)?.data?.pcmBytes ?? null,
        pcmChunks: turn.terminal?.pcmChunks ?? turn.events.filter(row => row.event === 'pcm_delivery_summary').at(-1)?.data?.chunks ?? null,
        expectedPcmDurationMs: turn.terminal?.audioDurationMs ?? null,
        native: { authorizationAccepted: counts('native_authorization_accepted'), playbackStarted: counts('native_playback_started'), playbackEnded: counts('native_playback_ended') },
        history: { playerCommitted: counts('player_history_committed'), assistantStaged: counts('assistant_history_staged'), assistantCommitted: counts('assistant_history_committed'), assistantDiscarded: counts('assistant_history_discarded') },
        actionDispatch: { attempted: counts('action_dispatch_attempted'), accepted: counts('action_dispatch_accepted'), rejected: counts('action_dispatch_rejected') },
        traceComplete: turn.terminal?.traceComplete ?? false,
      };
    });
    const success = turns.filter(turn => turn.terminalReason === 'completed');
    const failures = turns.filter(turn => turn.terminalReason !== 'completed');
    const latency = rows => ({ count: rows.length, p50Ms: percentile(rows.map(x => x.totalDurationMs), .50), p95Ms: percentile(rows.map(x => x.totalDurationMs), .95), p99Ms: percentile(rows.map(x => x.totalDurationMs), .99) });
    return {
      runId: run.runId, eventCount: run.events, turnCount: turns.length, completedCount: success.length,
      nonCompletedCount: failures.length, completionLatency: latency(success), nonCompletionLatency: latency(failures),
      providerUsage: Object.fromEntries(['inputTokens','outputTokens','totalTokens'].map(name => [name, run.usage.known.has(name) ? run.usage[name] : null])),
      droppedTelemetryRecords: run.dropped,
      malformedLines, truncatedTail,
      traceComplete: malformedLines === 0 && !truncatedTail && run.dropped === 0 && turns.every(turn => turn.terminalReason !== 'missing_terminal_summary' && turn.traceComplete),
      turns,
    };
  });
}

export async function readLogFiles(inputPath) {
  const info = await stat(inputPath);
  const files = info.isDirectory() ? (await readdir(inputPath)).filter(name => /^e1-run-\d{8}T\d{6}Z-[a-f0-9-]{36}(?:-\d+)?\.jsonl$/.test(name)).map(name => path.join(inputPath,name)) : [inputPath];
  const records = [];
  let malformedLines = 0;
  let truncatedTail = false;
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const lines = text.split('\n');
    if (lines.at(-1) === '') lines.pop(); else truncatedTail = true;
    for (const line of lines) if (line) { try { records.push(JSON.parse(line)); } catch { malformedLines++; } }
  }
  records.sort((a,b) => String(a.runId).localeCompare(String(b.runId)) || Number(a.sequence || 0)-Number(b.sequence || 0));
  return { records, malformedLines, truncatedTail };
}

export function renderMarkdown(runs) {
  const lines = ['# E1.1 telemetry run summary', '', 'All timings are Node-side observations. Missing values are unknown. Action acceptance is the stock event-handler boundary; it does not prove that GTA completed the world action.', ''];
  for (const run of runs) {
    lines.push(`## Run ${run.runId}`, '', `Events: ${run.eventCount}; turns: ${run.turnCount}; completed: ${run.completedCount}; other outcomes: ${run.nonCompletedCount}; dropped telemetry: ${run.droppedTelemetryRecords}; trace complete: ${run.traceComplete}.`, '', '| Source | Ped | Turn | Generation | Outcome | Stage | Total ms | PCM bytes | Playback start/end | Player/assistant commits |', '|---|---|---|---:|---|---|---:|---:|---:|---:|');
    for (const turn of run.turns) lines.push(`| ${turn.source} | ${turn.identity.pedId} | ${turn.identity.turnId} | ${turn.identity.generationId} | ${turn.terminalReason} | ${turn.stage || ''} | ${turn.totalDurationMs ?? ''} | ${turn.pcmBytes ?? ''} | ${turn.native.playbackStarted}/${turn.native.playbackEnded} | ${turn.history.playerCommitted}/${turn.history.assistantCommitted} |`);
    lines.push('', `Completed latency nearest-rank p50/p95/p99: ${run.completionLatency.p50Ms ?? 'n/a'} / ${run.completionLatency.p95Ms ?? 'n/a'} / ${run.completionLatency.p99Ms ?? 'n/a'} ms. Non-completed turns are separate.`, '', `Malformed lines: ${run.malformedLines}; truncated final line: ${run.truncatedTail}.`, '');
  }
  return lines.join('\n');
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const input = process.argv[2];
  if (!input) throw new Error('Usage: node tools/summarizeRun.mjs <JSONL file or logs directory> [output-prefix]');
  const { records, malformedLines, truncatedTail } = await readLogFiles(path.resolve(input));
  const runs = summarizeRecords(records, { malformedLines, truncatedTail });
  const prefix = path.resolve(process.argv[3] || 'e1-telemetry-summary');
  await writeFile(`${prefix}.json`, JSON.stringify(runs, null, 2) + '\n');
  await writeFile(`${prefix}.md`, renderMarkdown(runs));
  console.log(`Summarized ${runs.length} run(s); malformed=${malformedLines}; truncatedTail=${truncatedTail}.`);
}
