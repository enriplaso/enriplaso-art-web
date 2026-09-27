import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.spec.ts', 'test/e2e/**/*.e2e-spec.ts'],
    environment: 'node',
    // e2e tests boot the full Nest app and hit a real Postgres connection.
    testTimeout: 20_000,
  },
  plugins: [
    // Vitest's default esbuild transform doesn't emit TS decorator
    // metadata, which NestJS's constructor-based DI relies on to resolve
    // injected types. SWC does emit it (same as ts-jest did before).
    swc.vite(),
  ],
});
