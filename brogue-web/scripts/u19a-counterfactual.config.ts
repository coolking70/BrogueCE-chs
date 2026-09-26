import {defineConfig} from 'vitest/config';
import {blueprintVariant} from './u19a-variants.mjs';
export default defineConfig({plugins:[{name:'u19a-negative',enforce:'pre',load(id){
 if(id.endsWith('/Generator/BlueprintEngine.ts'))return blueprintVariant(process.env.U19A_VARIANT!);
}}],test:{testTimeout:900000}});
