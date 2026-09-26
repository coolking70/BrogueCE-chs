import {defineConfig} from 'vitest/config';
import {sourceFiles,variant} from './u19b-variants.mjs';
export default defineConfig({plugins:[{name:'u19b-negative',enforce:'pre',load(id){
 const file=sourceFiles.find(f=>id.endsWith('/'+f));if(file)return variant(process.env.U19B_VARIANT!,file);
}}],test:{testTimeout:900000}});
