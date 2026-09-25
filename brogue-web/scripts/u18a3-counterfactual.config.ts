// Frozen production source only. Original tests and their assertions stay intact.
import fs from 'node:fs';
import path from 'node:path';
import {defineConfig} from 'vitest/config';
export default defineConfig({plugins:[{name:'u18a3-frozen',enforce:'pre',load(id){
 const stage=process.env.U18A3_STAGE;
 if(stage && id.includes('/src/') && !id.includes('/test/')){
  const file=`ai_docs/reports/u-18a-3-evidence/${stage}/${path.basename(id)}.txt`;
  if(fs.existsSync(file))return fs.readFileSync(file,'utf8');
 }
}}],test:{testTimeout:900000}});
