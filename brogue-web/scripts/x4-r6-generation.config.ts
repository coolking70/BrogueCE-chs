import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['scripts/x4-r6-generation.ts'], testTimeout: 900000, hookTimeout: 120000 } });
