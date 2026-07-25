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
    exclude: ['node_modules', '.next', 'dist', 'e2e', '.claude/**'],
    deps: {
      optimizer: {
        web: {
          exclude: ['firebase-admin', 'web-push'],
        },
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules', '.next', '**/*.d.ts', 'vitest.config.ts']
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