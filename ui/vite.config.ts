import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/index.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      }
    }
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  },
  server: {
    port: 5173,
    proxy: {
      '/style_grid': 'http://127.0.0.1:7860',
      '/extensions/sd-webui-style-organizer/ui/dist': {
        target: 'http://127.0.0.1:5173',
        rewrite: (p) => p.replace(
          '/extensions/sd-webui-style-organizer/ui/dist', ''
        )
      }
    }
  }
})
