# Local model tooling

Scaffolding for offloading cheap, high-volume, or privacy-sensitive work to a
local model running on your Mac — keeping cloud Claude for the hard reasoning.
Everything here is plain ESM TypeScript (`.mts`) that Node 24 runs directly via
built-in type stripping, with **no new dependencies**.

A 48GB M5 comfortably runs quantized models up to ~32B. These tools default to
small/fast models; bump the env vars when you want stronger output.

## One-time setup

```sh
# Ollama is the simplest local server (LM Studio works too — just change the URL).
brew install ollama
ollama serve            # leave running, or use the menubar app

# Pull a chat/instruct model and an embedding model.
ollama pull qwen2.5-coder:7b      # or :32b (~20GB at Q4) for stronger output
ollama pull nomic-embed-text
```

Configuration is centralized in [`local-model-config.mts`](./local-model-config.mts)
and overridable by env var:

| Env var | Default | Purpose |
| --- | --- | --- |
| `LOCAL_MODEL_BASE_URL` | `http://localhost:11434/v1` | OpenAI-compatible endpoint (LM Studio: `:1234/v1`) |
| `LOCAL_MODEL_CHAT` | `qwen2.5-coder:7b` | chat/instruct model |
| `LOCAL_MODEL_EMBED` | `nomic-embed-text` | embedding model |
| `LOCAL_MODEL_TIMEOUT_MS` | `120000` | per-request timeout |

## What's here

### 1. Semantic codebase search (RAG) — `embeddings/`
Index the repo locally, then search it by meaning instead of grep. Free, offline,
and great for "where is X handled?" lookups before spending cloud tokens.

```sh
pnpm local:index                       # build/refresh the index (re-run as code drifts)
pnpm local:search "where do we wire up the terminal pty"
```

The index lives in the gitignored `.cache/`. Swap `vector-store.mts` for
sqlite-vec / a real vector DB when it outgrows memory — `upsert`/`search` is the
seam to keep stable.

### 2. Local-model commit hook — `hooks/`
`prescreen-diff.mts` reads your staged diff and prints a terse risk summary
(bugs, leftover debug code, secrets). It is **advisory and non-blocking** — always
exits 0. Run it standalone (`pnpm local:prescreen`) or wire it as a Claude Code
`PreToolUse` hook; see [`hooks/settings.example.json`](./hooks/settings.example.json).

### 3. Always-on background helper — `background/`
`background-assistant.mts` watches the working tree and, shortly after you save a
file, asks the local model for a quick read on that file's uncommitted diff.

```sh
pnpm local:watch        # Ctrl-C to stop
```

`runTask` is the extension point — repoint it at TODO extraction, test-stub
drafting, changelog notes, etc. Keep background tasks read-only and cheap.

> Recursive `fs.watch` is supported on macOS/Windows (the M5 target) but not
> Linux; the watcher would need a directory walk or watcher library there.

## Design

`local-model-client.mts` is a tiny wrapper over the OpenAI-compatible
`/chat/completions` and `/embeddings` endpoints — no SDK, so any server speaking
that API (Ollama, LM Studio, llama.cpp) works by changing the base URL. All three
tools build on that one client plus the shared config.
