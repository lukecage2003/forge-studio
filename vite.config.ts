import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * Each production build has an id (the commit in CI, FORGE_BUILD in tests, else the time).
 * It is compiled into the page and written to version.json: an open tab compares the two
 * and offers to reload when a newer Forge was published (src/lib/staleVersion.ts).
 */
const build = process.env.FORGE_BUILD || process.env.GITHUB_SHA?.slice(0, 12) || `local-${Date.now().toString(36)}`
const versionFile = (): Plugin => ({
  name: 'forge-version',
  apply: 'build',
  generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build, at: new Date().toISOString() }) }) },
})

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // relative paths: the same build works at / and under /forge-studio/ (GitHub Pages)
  base: './',
  plugins: [react(), versionFile()],
  define: { 'import.meta.env.VITE_FORGE_BUILD': JSON.stringify(command === 'build' ? build : 'dev') },
  build: {
    // list of every file of the build and of what each one imports: checked by scripts/check-build.mjs
    manifest: true,
    rolldownOptions: {
      output: {
        // tests only (tests/e2e/update.e2e.cjs): FORGE_TEST_RENAME gives every module a new file name,
        // like a publication that changed the code; unset in every real build
        ...(process.env.FORGE_TEST_RENAME ? { chunkFileNames: `assets/[name]-[hash]-${process.env.FORGE_TEST_RENAME}.js` } : {}),
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
}))
