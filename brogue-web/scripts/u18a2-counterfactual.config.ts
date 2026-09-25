// Test-only rollback, without rewriting the workspace or relaxing a guard.
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
export default defineConfig({
    plugins: [{name:'u18a2-one-step-rollback',enforce:'pre',load(id){
        const stage=process.env.U18A2_STAGE;
        if(stage && /\/(Game|Pathfinding|ItemSpawnHeatMap)\.ts$/.test(id))
            return fs.readFileSync(`ai_docs/reports/u-18a-2-evidence/${stage}/${path.basename(id)}.txt`,'utf8');
    }}],
    test:{testTimeout:900000},
});
