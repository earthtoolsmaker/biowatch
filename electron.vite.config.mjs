import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'fs'

const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig({
  main: {
    build: {
      externalizeDeps: true,
      rollupOptions: {
        external: [
          'drizzle-orm',
          'drizzle-orm/better-sqlite3',
          'drizzle-orm/better-sqlite3/migrator',
          'drizzle-orm/sqlite-core',
          'better-sqlite3'
        ]
      }
    }
  },
  preload: {
    build: {
      externalizeDeps: true
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(packageJson.version)
    },
    plugins: [react(), tailwindcss()]
  }
})
