import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  base: './',
  plugins: [],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        billing: resolve(__dirname, 'BILLING SOFTWARE.html'),
        share: resolve(__dirname, 'share.html'),
      }
    }
  }
})