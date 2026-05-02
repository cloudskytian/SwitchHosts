import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [ tsconfigPaths(), react() ],
  test: {
    environment: 'node',
    fileParallelism: false,
    include: [ 'test/**/*.test.ts', 'test/**/*.test.tsx', 'src/**/*.test.ts', 'src/**/*.test.tsx' ],
    setupFiles: [ './test/setup.ts' ],
  },
})
