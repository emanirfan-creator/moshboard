import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { BOARDS_DIR, displayPath } from './server/boards-dir.ts'
import { moodboardServer } from './server/plugin.ts'

export default defineConfig({
  plugins: [react(), moodboardServer()],
  // The boards folder as shown in toasts and copied prompts (it can live in another repo).
  define: { __BOARDS__: JSON.stringify(displayPath(BOARDS_DIR)) },
  // shared/ imports Sucrase's parser by its CJS path so the same files run in Node (export). In the
  // browser that would be a second copy next to the ESM build the code frames compile with.
  resolve: { alias: [{ find: /^sucrase\/dist\/parser\//, replacement: 'sucrase/dist/esm/parser/' }] },
  server: {
    port: Number(process.env.PORT) || 5180,
    // Boards are watched by the plugin itself; keep Vite from reloading on them.
    watch: { ignored: ['**/boards/**', `${BOARDS_DIR}/**`] },
  },
})
