import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['scripts/x4-r3-generation.ts'], testTimeout: 600000, maxWorkers: 1 } });
