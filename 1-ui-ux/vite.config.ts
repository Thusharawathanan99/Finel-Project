import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
    // Copy ORT WASM assets into dist/onnxruntime at build time.
    // For dev mode, these files must also live in public/onnxruntime/.
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/onnxruntime-web/dist/*.wasm',
          dest: 'onnxruntime'
        },
        {
          src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs',
          dest: 'onnxruntime'
        }
      ]
    }),
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
