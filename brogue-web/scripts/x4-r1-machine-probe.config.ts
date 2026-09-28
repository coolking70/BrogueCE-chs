import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['scripts/x4-r1-machine-probe.ts'],maxWorkers:1,testTimeout:120000}});
