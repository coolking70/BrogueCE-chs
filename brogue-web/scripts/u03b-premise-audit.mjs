import fs from 'node:fs';import ts from 'typescript';import {execFileSync} from 'node:child_process';import assert from 'node:assert/strict';
const files=['src/test/c_5_fall_subsystem.test.ts','src/test/g_2_gas_df_wiring.test.ts','src/test/u_02b_level_rng.test.ts','src/test/c_4a_0_layer_model.test.ts','src/test/c_4b_dungeon_feature.test.ts','src/test/ui_2_protection.test.ts','src/test/w_11_teleport_placement.test.ts'];
const printer=ts.createPrinter({removeComments:true});
function expectations(raw){const source=ts.createSourceFile('test.ts',raw,ts.ScriptTarget.Latest,true),out=[];function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(source).startsWith('expect('))out.push(printer.printNode(ts.EmitHint.Unspecified,n,source));ts.forEachChild(n,visit);}visit(source);return out;}
const rows=files.map(f=>{const before=expectations(execFileSync('git',['show',`HEAD:brogue-web/${f}`],{encoding:'utf8'})),after=expectations(fs.readFileSync(f,'utf8'));assert.deepEqual(after,before,f);return {file:f,expectExpressions:after.length,identical:true};});
fs.writeFileSync('ai_docs/reports/u-03b-evidence/premise-expect-audit.json',JSON.stringify(rows,null,2)+'\n');
fs.writeFileSync('ai_docs/reports/u-03b-evidence/premise-only.patch',execFileSync('git',['diff','--',...files]));console.log(rows);
