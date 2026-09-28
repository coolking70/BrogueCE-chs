import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['output/x4-r3/replay-probe.ts'],testTimeout:600000,maxWorkers:1}});
