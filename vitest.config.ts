import { defineConfig } from 'vitest/config';

const sharedTestConfig = {
  environment: 'node' as const,
  passWithNoTests: true,
  coverage: {
    provider: 'v8' as const,
    reportsDirectory: './coverage',
  },
};

export default defineConfig({
  projects: [
    {
      test: {
        ...sharedTestConfig,
        include: ['packages/tts-core/src/**/*.test.ts'],
        name: 'tts-core',
        reporters: ['basic'],
      },
    },
    {
      test: {
        ...sharedTestConfig,
        include: ['packages/tts-provider-elevenlabs/src/**/*.test.ts'],
        name: 'tts-provider-elevenlabs',
        reporters: ['basic'],
      },
    },
  ],
});
