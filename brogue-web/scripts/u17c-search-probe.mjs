// Preserve the original A6 assertion, recording unrelated natural searchable tiles.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'u17c-search-')),out=path.resolve('ai_docs/reports/u-17c-evidence');
try{
 fs.cpSync('src',`${temp}/src`,{recursive:true});for(const p of ['package.json','vite.config.ts'])fs.copyFileSync(p,`${temp}/${p}`);fs.symlinkSync(path.resolve('node_modules'),`${temp}/node_modules`,'dir');
 const file=`${temp}/src/test/p1_42_secret_door_search.test.ts`;let s=fs.readFileSync(file,'utf8');
 const anchor='            const spy = vi.spyOn(rng, \'randPercent\');';
 s="import {writeFileSync as saveProbe} from 'node:fs';\nconst probe: unknown[]=[];\n"+s.replace(anchor,`            const candidates=[];
            for(let x=0;x<game.grid.width;x++)for(let y=0;y<game.grid.height;y++){
                const c=game.grid.getCell(x,y)!;
                if(c.isVisible && c.layers.some(t=>[TerrainType.SECRET_DOOR,TerrainType.TRAP_DOOR_HIDDEN,TerrainType.WALL_LEVER_HIDDEN].includes(t))) candidates.push({x,y,layers:c.layers.map(t=>TerrainType[t])});
            }
            probe.push({seed:42500+i,candidates});saveProbe(${JSON.stringify(out+'/search-probe.json')},JSON.stringify(probe,null,2));\n`+anchor);
 fs.writeFileSync(file,s);const fd=fs.openSync(`${out}/search-probe.txt`,'w');const r=spawnSync(process.execPath,[path.resolve('node_modules/vitest/vitest.mjs'),'run','src/test/p1_42_secret_door_search.test.ts','-t','A6 可见性'],{cwd:temp,stdio:['ignore',fd,fd]});fs.closeSync(fd);console.log({diagnosticExit:r.status});
}finally{fs.rmSync(temp,{recursive:true,force:true});}
