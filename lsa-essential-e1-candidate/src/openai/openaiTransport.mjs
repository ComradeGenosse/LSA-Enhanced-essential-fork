import { OpenAIConnection } from './openaiConnection.mjs';

export class OpenAITransport {
  #runtime;
  #memorySources;

  // memorySources: private capabilities from createRuntime's closure only.
  constructor(runtime, memorySources = null) {
    this.#runtime = runtime;
    this.#memorySources = memorySources;
    this.provider = 'openai';
  }

  async connect(options = {}) {
    if (!String(options.systemInstruction || '').trim()) throw new Error('OpenAI session requires the Essential system instruction.');
    if (options.resumeHandle) throw new Error('OpenAI sessions do not accept Gemini resume handles.');
    const connection = new OpenAIConnection({ runtime: this.#runtime, onEvent: options.onEvent, options, diagnosticContext: options.diagnosticContext, memorySources: this.#memorySources });
    this.#runtime.attach(connection, options.diagnosticContext);
    return connection;
  }
}
