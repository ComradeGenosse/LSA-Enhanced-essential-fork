import { OpenAIConnection } from './openaiConnection.mjs';

export class OpenAITransport {
  #runtime;

  constructor(runtime) {
    this.#runtime = runtime;
    this.provider = 'openai';
  }

  async connect(options = {}) {
    if (!String(options.systemInstruction || '').trim()) throw new Error('OpenAI session requires the Essential system instruction.');
    if (options.resumeHandle) throw new Error('OpenAI sessions do not accept Gemini resume handles.');
    const connection = new OpenAIConnection({ runtime: this.#runtime, onEvent: options.onEvent, options, diagnosticContext: options.diagnosticContext });
    this.#runtime.attach(connection, options.diagnosticContext);
    return connection;
  }
}
