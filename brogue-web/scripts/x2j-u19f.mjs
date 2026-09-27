import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x2j-u19f-'));
const source = `
import fs from 'node:fs';
import { createHeadlessGame } from './harness';
import { setMachineObservationHook } from '../engine/Generator/MachineObservation';
import { runCrystalWormActions } from './fixtures/u19f-machine-actions';
import { route } from './fixtures/u19d-machine-actions';
import cases from './fixtures/u19f-natural-cases.json';
const row=cases.find(r=>r.ce===55)!,g:any=createHeadlessGame(19,'test');let traces:any[]=[];
setMachineObservationHook(()=>{});const populate=g.populateLevel.bind(g);
g.populateLevel=(...a:any[])=>{const r=populate(...a);traces=a[3].flatMap((m:any)=>m.observation?[m.observation]:[]);return r;};
g.startNewGame({seed:row.seed,mode:'normal'});for(let d=2;d<=row.depth;d++){g.depth=d;g.generateDepth(false,false);}
const trace=traces.find(t=>t.ceBlueprintId===55&&t.machineNumber===row.machine);
const r=runCrystalWormActions(g,trace,row.entry);
const residents=()=>g.monsters.filter((m:any)=>m.machineHome===row.machine&&m.hp>0);
const before=residents().map((m:any)=>({id:m.id,hp:m.hp,loc:m.loc,state:m.state,lastSeen:m.lastSeenPlayerAt}));
const extra:any[]=[];
for(let n=0;n<600&&residents().length;n++){
 const routes=residents().map((m:any)=>route(g,g.player.loc,m.loc,true)).filter((p:any)=>p?.length).sort((a:any,b:any)=>a.length-b.length);
 const next=routes[0]?.[0],data=next?{x:next.x-g.player.x,y:next.y-g.player.y}:undefined;
 const action=next?'move':'wait';extra.push({action,data});g.handlePlayerAction(action,data);
}
fs.writeFileSync('ai_docs/reports/x2j-evidence/u19f-pursuit.json',JSON.stringify({before,originalCommands:r.commands.length,extra,after:residents().map((m:any)=>m.id)},null,2)+'\\n');
console.log(JSON.stringify({before,extra:extra.length,remaining:residents().length}));
`;
try {
    await build({ stdin: { contents: source, resolveDir: path.resolve('src/test'), loader: 'ts' },
        outfile: `${dir}/run.mjs`, bundle: true, platform: 'node', format: 'esm' });
    const r = spawnSync(process.execPath, [`${dir}/run.mjs`], { stdio: 'inherit' });
    process.exitCode = r.status ?? 1;
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
