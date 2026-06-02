import { defineConfig } from 'vitest/config';
import * as path from 'path';

// Unit tests run against a lightweight `vscode` stub (see test/vscode-mock.ts),
// since the real module is only available inside the Extension Host.
export default defineConfig({
  resolve: {
    alias: { vscode: path.resolve(__dirname, 'test/vscode-mock.ts') },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
