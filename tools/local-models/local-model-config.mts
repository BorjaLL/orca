// Central config for the local-model tooling. Everything reads from here so a
// single env override (or one edit) re-points every tool at a different server
// or model — Ollama and LM Studio both speak the OpenAI-compatible /v1 API.

export interface LocalModelConfig {
  /** OpenAI-compatible base URL. Ollama: :11434/v1 — LM Studio: :1234/v1 */
  baseUrl: string
  /** Most local servers ignore this; kept for OpenAI-compatible auth headers. */
  apiKey: string
  /** Chat/instruct model tag, e.g. qwen2.5-coder:7b or :32b. */
  chatModel: string
  /** Embedding model tag, e.g. nomic-embed-text. */
  embedModel: string
  /** Per-request timeout. Big prompts on a 32B model can be slow — be generous. */
  requestTimeoutMs: number
}

function env(name: string, fallback: string): string {
  const value = process.env[name]
  return value === undefined || value === '' ? fallback : value
}

export function loadConfig(): LocalModelConfig {
  return {
    baseUrl: env('LOCAL_MODEL_BASE_URL', 'http://localhost:11434/v1'),
    apiKey: env('LOCAL_MODEL_API_KEY', 'not-needed'),
    // 7B is the safe default on 48GB with room for everything else running.
    // Bump to qwen2.5-coder:32b (~20GB at Q4) when you want stronger output.
    chatModel: env('LOCAL_MODEL_CHAT', 'qwen2.5-coder:7b'),
    embedModel: env('LOCAL_MODEL_EMBED', 'nomic-embed-text'),
    requestTimeoutMs: Number(env('LOCAL_MODEL_TIMEOUT_MS', '120000'))
  }
}
