import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['firebase-admin', 'web-push'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // El default de vitest (5000ms) deja rojo un `npx vitest run` limpio: hay
    // tests de componente pesados que lo superan de manera reproducible --
    // __tests__/components/orden-form-dispositivo-error.test.tsx tarda ~18.6s
    // montando el wizard completo. Subir el techo global es lo que hace que el
    // comando por defecto del repo pase sin flags.
    testTimeout: 30000,
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.{test,spec}.{ts,tsx}'],
    // Custom `exclude` REPLACES vitest's defaults, and bare names like
    // 'node_modules' only match at the root: a stray worktree (.worktrees/,
    // .claude/worktrees/) re-introduces its whole node_modules into discovery
    // and a plain `npx vitest run` hangs for 15-30 min. Globstar everything.
    exclude: ['**/node_modules/**', '**/.next/**', '**/dist/**', 'e2e/**', '.claude/**', '.worktrees/**'],
    deps: {
      optimizer: {
        // Vitest 4 usa las claves "client"/"ssr" (la clave vieja "web" es
        // config muerta y se ignora en silencio).
        client: {
          enabled: true,
          exclude: ['firebase-admin', 'web-push'],
          // react-day-picker v9 arrastra un grafo de ~950 modulos ESM chicos
          // (incluye una copia anidada de date-fns@4 completa via su barrel).
          // Sin prebundle, Node resuelve ~2000 specifiers por worker (~1.2ms
          // c/u en Windows) y montar OrdenForm cuesta ~6s de puro import de
          // ui/date-picker. esbuild los colapsa a un bundle cacheado.
          include: ['react-day-picker', 'date-fns', 'date-fns/locale'],
        },
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['**/node_modules/**', '**/.next/**', '**/*.d.ts', 'vitest.config.ts']
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      'firebase-admin': path.resolve(__dirname, './__mocks__/firebase-admin.ts'),
      'web-push': path.resolve(__dirname, './__mocks__/web-push.ts'),
    },
  },
})