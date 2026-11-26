import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // libraries in their own files: they stay cached between two versions of Forge
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'mediabunny', test: /node_modules[\\/]mediabunny[\\/]/ },
            { name: 'icons', test: /node_modules[\\/]lucide-react[\\/]/ },
            { name: 'fflate', test: /node_modules[\\/]fflate[\\/]/ },
          ],
        },
      },
    },
  },
})
