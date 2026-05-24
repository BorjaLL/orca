// Thin client over the OpenAI-compatible chat + embeddings endpoints exposed by
// Ollama / LM Studio. Uses the global fetch (Node 18+) — no SDK dependency, so
// this whole scaffold runs with a bare `node file.mts` on Node 24.

import { loadConfig, type LocalModelConfig } from './local-model-config.mts'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  /** 0 for deterministic review/extraction tasks, higher for drafting. */
  temperature?: number
  maxTokens?: number
}

export class LocalModelClient {
  private config: LocalModelConfig

  constructor(config: LocalModelConfig) {
    this.config = config
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const body = {
      model: this.config.chatModel,
      messages,
      temperature: options.temperature ?? 0,
      max_tokens: options.maxTokens,
      stream: false
    }
    const data = await this.post('/chat/completions', body)
    return data?.choices?.[0]?.message?.content ?? ''
  }

  /** Returns one embedding vector per input string, order preserved. */
  async embed(input: string | string[]): Promise<number[][]> {
    const inputs = Array.isArray(input) ? input : [input]
    const data = await this.post('/embeddings', { model: this.config.embedModel, input: inputs })
    // Sort by index because some servers don't guarantee response ordering.
    return (data?.data ?? [])
      .slice()
      .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
      .map((d: { embedding: number[] }) => d.embedding)
  }

  private async post(path: string, body: unknown): Promise<any> {
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.requestTimeoutMs)
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Local model request to ${path} failed (${res.status}): ${detail}`)
    }
    return res.json()
  }
}

export function createClientFromEnv(): LocalModelClient {
  return new LocalModelClient(loadConfig())
}
