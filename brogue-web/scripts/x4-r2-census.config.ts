import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['scripts/x4-r2-census.ts'],maxWorkers:1,fileParallelism:false,testTimeout:7200000}});
