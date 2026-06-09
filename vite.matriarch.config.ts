import { resolve } from 'path'
import { readFileSync } from 'fs'
import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Why: `pnpm dev:matriarch` should surface a one-click *paired* URL, not just the
// bare dev port. Vite can't know the Orca runtime token, so we append a locally
// stored pairing offer (.matriarch-pairing.local, gitignored) to the portal entry
// once the server's real port is known. Dev-only (`apply: 'serve'`); the build is
// untouched. Absent the file, we still print the plain entry so `/` is never used.
function matriarchPairedUrl(): Plugin {
  return {
    name: 'matriarch-paired-url',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      server.httpServer?.once('listening', () => {
        const address = server.httpServer?.address()
        const port = address && typeof address === 'object' ? address.port : null
        if (!port) {
          return
        }
        const base = `http://127.0.0.1:${port}/matriarch-index.html`
        let offer = ''
        try {
          offer = readFileSync(resolve('.matriarch-pairing.local'), 'utf8').trim()
        } catch {
          // No local offer configured — fall through to the unpaired hint.
        }
        // Defer so this lands beneath Vite's own ready banner.
        setTimeout(() => {
          server.config.logger.info(`  ➜  Portal:   ${base}`)
          server.config.logger.info(
            offer
              ? `  ➜  Paired:   ${base}#${offer}`
              : `  ➜  Paired:   add an orca://pair offer to .matriarch-pairing.local for a one-click link`
          )
        }, 1)
      })
    }
  }
}

// Why: the Matriarch Portal is a SEPARATE Vite entry from the editor web bundle
// (web-index.html). It reuses the same renderer source root so the shared design
// system (main.css tokens, shadcn primitives under @/components/ui) and the
// E2EE/pairing client (src/web/*) resolve through the existing @ / @renderer
// aliases, but it boots a thin client instead of the full editor App.
export default defineConfig({
  root: resolve('src/renderer'),
  // Why: pairing URLs may live under a reverse-proxy path prefix, so built
  // assets must resolve relative to the page (mirrors vite.web.config.ts).
  base: './',
  plugins: [react(), tailwindcss(), matriarchPairedUrl()],
  define: {
    ORCA_FEATURE_WALL_ENABLED: 'true'
  },
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@': resolve('src/renderer/src')
    }
  },
  build: {
    outDir: resolve('out/matriarch'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve('src/renderer/matriarch-index.html')
    }
  },
  worker: {
    format: 'es'
  }
})
