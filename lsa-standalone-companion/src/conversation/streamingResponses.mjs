// Phase 4 S2 - Responses streaming output_text -> source-validated speech
// clauses. NEVER consume model reasoning/tool bytes as spoken text.
// Physical actor authorization and audio/history admission are native-only.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const MAX_SEGMENTS = 12;
const MAX_SPOKEN = 2048;
const MAX_SEGMENT = 500;

export function extractSpeechSegments() {
  let pending = '', emitted = 0, total = 0;
  const valid = s => {
    if (typeof s !== 'string' || CONTROL.test(s) || s.includes('\uFFFD'))
      throw new Error('invalid_speech_delta');
    return s;
  };
  return {
    push(delta) {
      valid(delta);
      total += delta.length;
      if (total > MAX_SPOKEN) throw new Error('speech_text_capacity');
      pending += delta;
      const ready = [];
      // Only complete prose clauses (punctuation + boundary), never raw
      // incomplete JSON or tool/action fields. If output is unterminated or
      // unusually long, defer to final rather than cut arbitrary tokens.
      while (true) {
        const match = /[.!?](?=\s|$)/g;
        let boundary = -1, hit;
        while ((hit = match.exec(pending))) {
          if (hit.index + 1 < pending.length || hit.index + 1 >= 40)
            { boundary = hit.index + 1; break; }
        }
        if (boundary < 0 || boundary > MAX_SEGMENT) break;
        const segment = pending.slice(0, boundary).trim();
        if (!segment) { pending = pending.slice(boundary); continue; }
        if (emitted >= MAX_SEGMENTS) throw new Error('speech_segment_capacity');
        ready.push(segment); emitted++;
        pending = pending.slice(boundary).trimStart();
      }
      if (pending.length > MAX_SEGMENT)
        throw new Error('speech_segment_capacity');
      return ready;
    },
    finish() {
      const tail = pending.trim();
      if (!tail && emitted === 0) throw new Error('provider_invalid_answer');
      if (tail) {
        valid(tail);
        if (emitted >= MAX_SEGMENTS || tail.length > MAX_SEGMENT)
          throw new Error('speech_segment_capacity');
        emitted++; pending = '';
        return [tail];
      }
      return [];
    }
  };
}

export function createStreamingResponsesProvider({
  apiKey = process.env.OPENAI_API_KEY, model = process.env.LSA_STANDALONE_MODEL,
  endpoint = 'https://api.openai.com/v1/responses',
  fetchImpl = globalThis.fetch
} = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim() ||
      typeof model !== 'string' || !/^[a-zA-Z0-9._:-]{2,100}$/.test(model) ||
      typeof fetchImpl !== 'function') throw new Error('provider_configuration_missing');
  return {
    async *streamSpeechSegments({ text, previousPlayerInputs = [], signal }) {
      if (typeof text !== 'string' || !text.trim() || text.length > 1024 ||
          CONTROL.test(text) ||
          !Array.isArray(previousPlayerInputs) || previousPlayerInputs.length > 6 ||
          previousPlayerInputs.some(v => typeof v !== 'string' || !v.trim() ||
            v.length > 1024 || CONTROL.test(v)))
        throw new Error('invalid_player_text');
      const deadline = AbortSignal.timeout(25000);
      const bound = signal ? AbortSignal.any([deadline, signal]) : deadline;
      if (bound.aborted) throw new Error('typed_turn_cancelled');
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + apiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model, store: false, stream: true,
            instructions: 'You are a fictional GTA NPC responding to the player. Speak in plain natural dialogue. No structured JSON, tool calls, actions, or unverified claims of witnessed events. Keep answers brief.',
            input: previousPlayerInputs.length
              ? [...previousPlayerInputs, text].map(content => ({ role: 'user', content }))
              : text, max_output_tokens: 350
          }),
          signal: bound
        });
      } catch { throw new Error('provider_transport_failure'); }
      if (!response?.ok) throw new Error('provider_http_failure');
      if (!response.body?.getReader) throw new Error('provider_stream_unavailable');
      const reader = response.body.getReader();
      const split = extractSpeechSegments();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let pending = '', observed = 0, complete = false;
      try {
        while (!complete) {
          if (bound.aborted) throw new Error('typed_turn_cancelled');
          let packet;
          try { packet = await reader.read(); }
          catch { throw new Error('provider_stream_failure'); }
          if (packet.done) break;
          if (!(packet.value instanceof Uint8Array))
            throw new Error('provider_stream_invalid');
          observed += packet.value.length;
          if (observed > 128000) throw new Error('provider_stream_capacity');
          pending += decoder.decode(packet.value, { stream: true }).replace(/\r\n/g, '\n');
          if (pending.length > 8192) throw new Error('provider_stream_capacity');
          while (pending.includes('\n\n')) {
            const cut = pending.indexOf('\n\n');
            const raw = pending.slice(0, cut); pending = pending.slice(cut + 2);
            const json = raw.split('\n').filter(x => x.startsWith('data:'))
              .map(x => x.slice(5).trimStart()).join('\n');
            if (!json || json === '[DONE]') continue;
            let message;
            try { message = JSON.parse(json); }
            catch { throw new Error('provider_stream_invalid'); }
            if (message.type === 'response.output_text.delta') {
              for (const segment of split.push(message.delta)) yield segment;
            } else if (message.type === 'response.completed') {
              if (message.response?.status !== 'completed')
                throw new Error('provider_incomplete');
              complete = true; break;
            } else if (message.type === 'response.failed' ||
                       message.type === 'response.incomplete' ||
                       message.type === 'response.refusal.delta' ||
                       message.type === 'response.function_call_arguments.delta' ||
                       message.type === 'response.output_item.added' &&
                         message.item?.type !== 'message')
              throw new Error('provider_unsupported_output');
          }
        }
        if (!complete || bound.aborted) throw new Error('provider_incomplete');
        for (const tail of split.finish()) yield tail;
      } finally {
        try { await reader.cancel(); } catch {}
        try { reader.releaseLock(); } catch {}
      }
    }
  };
}
