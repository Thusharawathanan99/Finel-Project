import { defineConfig } from 'vite'
import path from 'path'
import { fileURLToPath } from 'node:url'
import { readdirSync, readFileSync } from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ortDirectory = path.resolve(__dirname, 'node_modules/onnxruntime-web/dist')
const ortFiles = () => readdirSync(ortDirectory).filter(name => name.endsWith('.wasm') || name === 'ort-wasm-simd-threaded.jsep.mjs')

export default defineConfig({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
    // Copy ORT WASM assets into dist/onnxruntime at build time.
    // For dev mode, these files must also live in public/onnxruntime/.
    {
      name: 'careconnect-ort-assets',
      generateBundle() {
        for (const name of ortFiles()) this.emitFile({type:'asset',fileName:`onnxruntime/${name}`,source:readFileSync(path.join(ortDirectory,name))})
      },
      configureServer(server) {
        server.middlewares.use((req,res,next) => {
          const name = req.url?.split('?')[0].replace(/^\/onnxruntime\//,'')
          if (!req.url?.startsWith('/onnxruntime/') || !name || !ortFiles().includes(name)) return next()
          res.setHeader('Content-Type',name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
          res.end(readFileSync(path.join(ortDirectory,name)))
        })
      }
    },
    // Custom plugin to serve .mjs files from public/ as raw JS in dev mode.
    // Without this, Vite intercepts .mjs imports and tries to run them
    // through its module pipeline — adding ?import and rewriting imports —
    // which breaks ORT's dynamic WASM worker loading.
    {
      name: 'ort-wasm-mime-fix',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          // Strip Vite's ?import suffix so the file is served raw
          if (req.url?.startsWith('/onnxruntime/') && req.url.includes('?import')) {
            req.url = req.url.replace('?import', '');
          }
          next();
        });
      }
    }
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Load .env from project root (shared across all modules)
  envDir: path.resolve(__dirname, '..'),
  // Bind to all interfaces so Cloudflare Tunnel can reach the dev server
  server: {
    host: true,
    allowedHosts: ['admin.careconnect.website', '.careconnect.website'],
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web']
  }
})
