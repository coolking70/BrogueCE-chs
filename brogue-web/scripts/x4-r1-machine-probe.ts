import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHeadlessGame } from '../src/test/harness';
import { setMachineObservationHook } from '../src/engine/Generator/MachineObservation';
import { TerrainType as T } from '../src/engine/Map/Grid';
import { runAltarActions } from '../src/test/fixtures/u19e-machine-actions';
it('records both original machine-driver regressions without altering the worlds',()=>{
    const rows=[];
    for(const depth of [5,8]) {
        let machines:any[]=[];setMachineObservationHook(()=>{});
        const generated:any=depth===5?createHeadlessGame(19,'test'):createHeadlessGame(424242);
        const populate=generated.populateLevel.bind(generated);
        generated.populateLevel=(...args:any[])=>{const r=populate(...args);machines=args[3];return r;};
        generated.startNewGame({seed:424242,mode:'normal'});
        for(let d=2;d<=depth;d++){generated.depth=d;generated.generateDepth(false,false);}
        const machine=depth===5?machines.find(m=>m.observation?.ceBlueprintId===47&&m.machineNumber===4)
            :machines.find(m=>m.itemSpawns.some((s:any)=>s.viaAdoption&&s.pos.x===54&&s.pos.y===16));
        expect(machine).toBeDefined();
        let g=generated;
        if(depth===8){g=createHeadlessGame(19,'test');expect(g.loadSnapshot(JSON.parse(JSON.stringify(generated.toSnapshot())))).toBe(true);}
        const initial=g.toSnapshot(),commands:any[]=[];
        const act=g.handlePlayerAction.bind(g);
        g.handlePlayerAction=(action:string,...args:any[])=>{
            const before={...g.player.loc},value=act(action,...args);
            commands.push({action,data:args[0],before,player:{...g.player.loc},hp:g.player.hp,
                layers:g.grid.getCell(g.player.x,g.player.y).layers.map((t:T)=>T[t]),
                marked:[...g.monsters,...g.dormantMonsters].filter((m:any)=>m.markedForSacrifice).map((m:any)=>({id:m.id,loc:{...m.loc},state:m.state,hp:m.hp})),
                over:g.isGameOver,death:g.deathReason});return value;
        };
        let error:string|undefined,result:unknown;
        try{result=runAltarActions(g,machine.observation,depth===5?{x:66,y:16}:machine.door??machine.center);}
        catch(e){error=String(e);}
        rows.push({depth,error,result,initial,commands,diagnostics:g.u19fAltarDiagnostics});
        setMachineObservationHook(null);
    }
    const stage=process.env.X4_R1_MACHINE_STAGE??'before';
    writeFileSync(`ai_docs/reports/x4-r1-evidence/machine-${stage}.json.gz`,gzipSync(JSON.stringify(rows)));
    if(stage==='after')for(const row of rows)expect(row.error).toBeUndefined();
});
