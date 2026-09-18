import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/react/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // CVAgent targets modern desktop Chromium. The Vite polyfill creates a
    // global MutationObserver solely for legacy modulepreload support, which
    // is unnecessary here and makes browser-console diagnosis noisier.
    modulePreload: { polyfill: false },
  },
})
