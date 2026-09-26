import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const out='ai_docs/reports/u-19a-evidence';
export function blueprintVariant(name){
 const final=fs.readFileSync('src/engine/Generator/BlueprintEngine.ts','utf8');
 const baseline=fs.readFileSync(`${out}/BlueprintEngine-before.ts.txt`,'utf8');
 if(name==='s0')return baseline;
 if(name==='s2')return final;
 const needle="view = computeMachineView(this.grid, origin, flags.has('MF_IN_PASSABLE_VIEW_OF_ORIGIN'));";
 if(!final.includes(needle))throw Error('Final machine view call changed');
 const legacy="view = new FOVSys(this.grid).computeFOVMask(origin.x, origin.y, Math.max(DCOLS, DROWS), cell => !!(cellTerrainFlags(this.grid, cell.x, cell.y) & T_PATHING_BLOCKER)); view[origin.x][origin.y] = true;";
 if(name==='s1')return "import { FOVSys } from '../Lighting/FOV';\n"+final.replace(needle,`if (flags.has('MF_IN_PASSABLE_VIEW_OF_ORIGIN')) { ${legacy} } else { view = computeMachineView(this.grid, origin, false); }`);
 if(name==='no-ordinary'||name==='no-passable'){
  const flag=name==='no-ordinary'?'MF_IN_VIEW_OF_ORIGIN':'MF_IN_PASSABLE_VIEW_OF_ORIGIN';
  return final.replace('const view = this.featureView(origin, fFlags);',`const view = fFlags.has('${flag}') ? null : this.featureView(origin, fFlags);`);
 }
 throw Error(name);
}
export function freezeBaseline(){
 if(!fs.existsSync(`${out}/BlueprintEngine-before.ts.txt`))fs.writeFileSync(`${out}/BlueprintEngine-before.ts.txt`,execFileSync('git',['show','HEAD:brogue-web/src/engine/Generator/BlueprintEngine.ts']));
}
