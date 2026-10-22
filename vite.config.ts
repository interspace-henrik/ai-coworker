import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the same build works on GitHub Pages (/ai-coworker/) and any static server.
  base: './',
  build: {
    // Yodeck players may ship an older Chromium; keep the output syntax conservative.
    target: 'es2018',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
