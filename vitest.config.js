import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    hookTimeout: 60_000 * 2,
    testTimeout: 60_000,
  },
})
