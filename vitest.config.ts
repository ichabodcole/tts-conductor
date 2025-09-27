import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    passWithNoTests: true,
    include: [
      'packages/tts-core/src/**/*.test.ts',
      'packages/tts-provider-elevenlabs/src/**/*.test.ts',
    ],
    reporters: [['default', { summary: false }]],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
    },
  },
});
