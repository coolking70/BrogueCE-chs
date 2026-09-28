import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['scripts/x4-r2-ce52.ts'],maxWorkers:1,testTimeout:600000}});
