import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['scripts/x4-r2-replay.ts'],testTimeout:180000}});
