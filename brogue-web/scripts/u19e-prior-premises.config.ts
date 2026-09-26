import fs from 'node:fs';import {defineConfig} from 'vitest/config';
const guards=['v_2b_7_features.test.ts','u_19d_machine_families.test.ts','p1_20_item_placement.test.ts','u19d-natural-cases.json'];
export default defineConfig({plugins:[{name:'u19e-head',enforce:'pre',load(id){
 const file=id.split('/').pop();
 if(process.env.U19E_ORIGINAL_GUARDS==='1'&&id.includes('/src/test/')&&guards.includes(file!))return fs.readFileSync(`ai_docs/reports/u-19e-evidence/${file}.original.txt`,'utf8');
 if(process.env.U19E_PREMISE_FINAL!=='1'&&id.includes('/src/engine/')&&['BlueprintEngine.ts','Game.ts'].includes(file!))return fs.readFileSync(`ai_docs/reports/u-19e-evidence/${file!.replace('.ts','')}-before.ts.txt`,'utf8');
}}]});
