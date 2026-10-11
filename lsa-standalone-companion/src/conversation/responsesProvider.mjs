// Independent provider adapter, no stock Essential bootstrap or Gemini scheduler.
// Audio, player attributes, memories, and world observations are NOT claimed here.
export function createResponsesProvider({
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.LSA_STANDALONE_MODEL,
  fetchImpl = globalThis.fetch,
  endpoint = 'https://api.openai.com/v1/responses'
} = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim() ||
      typeof model !== 'string' || !/^[a-zA-Z0-9._:-]{2,100}$/.test(model))
    throw new Error('provider_configuration_missing');
  if (typeof fetchImpl !== 'function') throw new Error('provider_fetch_missing');

  return {
    async complete({ text, previousPlayerInputs = [], signal }) {
      if (typeof text !== 'string' || !text.trim() || text.length > 1024)
        throw new Error('invalid_player_text');
      if (!Array.isArray(previousPlayerInputs) || previousPlayerInputs.length > 6 ||
          previousPlayerInputs.some(entry => typeof entry !== 'string' ||
            !entry.trim() || entry.length > 1024))
        throw new Error('invalid_source_time_context');
      const deadline = AbortSignal.timeout(20000);
      const bound = signal ? AbortSignal.any([signal, deadline]) : deadline;
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + apiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model, store: false,
            instructions: 'You are a fictional GTA character speaking with the player. Answer naturally and briefly. Do not claim to have witnessed events unless verified world facts were provided. No actions or game effects are available.',
            // Only earlier *player* text is eligible before native playback
            // completes. No unplayed assistant response enters model history.
            input: previousPlayerInputs.length
              ? [...previousPlayerInputs, text].map(value =>
                  ({ role: 'user', content: value })) : text,
            max_output_tokens: 350
          }),
          signal: bound
        });
      } catch {
        throw new Error('provider_transport_failure');
      }
      if (!response?.ok) throw new Error('provider_http_failure');
      let json;
      try { json = await response.json(); }
      catch { throw new Error('provider_invalid_json'); }
      if (json?.status !== 'completed' || !Array.isArray(json?.output))
        throw new Error('provider_incomplete');
      // Responses API output array can include reasoning, tool calls, etc.
      const parts = json.output
        .filter(item => item.type === 'message' && item.role === 'assistant')
        .flatMap(item => Array.isArray(item.content) ? item.content : [])
        .filter(part => part.type === 'output_text' && typeof part.text === 'string')
        .map(part => part.text);
      const answer = parts.join('').trim();
      if (!answer || answer.length > 2048 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(answer))
        throw new Error('provider_invalid_answer');
      return answer;
    }
  };
}
