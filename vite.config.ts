import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { moodboardServer } from './server/plugin.ts'

export default defineConfig({
  plugins: [react(), moodboardServer()],
  server: {
    port: 5180,
    // Boards are watched by the plugin itself; keep Vite from reloading on them.
    watch: { ignored: ['**/boards/**'] },
  },
})
