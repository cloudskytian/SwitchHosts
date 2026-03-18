import * as path from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [],
  base: './',
  build: {
    rolldownOptions: {
      input: {
        preload: path.join(__dirname, 'src', 'main', 'preload.ts'),
      },
      output: {
        format: 'cjs',
        entryFileNames: '[name].js',
      },
    },
    outDir: path.join(__dirname, 'build'),
    minify: true,
    ssr: true,
    emptyOutDir: false,
  },
  resolve: {
    tsconfigPaths: true,
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@root': path.resolve(__dirname),
      '@assets': path.resolve(__dirname, 'assets'),
      '@src': path.resolve(__dirname, 'src'),
      '@common': path.resolve(__dirname, 'src', 'common'),
      '@main': path.resolve(__dirname, 'src', 'main'),
      '@renderer': path.resolve(__dirname, 'src', 'renderer'),
    },
  },
})
