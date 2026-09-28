/** Read-only diagnosis of the original P1-42 A6 fixture; no assertion update. */
import { it, vi, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { createHeadlessGame } from '../src/test/harness';
import { TerrainType as T } from '../src/engine/Map/Grid';
import { rng } from '../src/engine/Random';
import { TERRAIN_FLAGS, TM_IS_SECRET } from '../src/engine/Map/TerrainCatalog';
it('records all fifteen original hidden-door trials and percent-call origins', () => {
    const rows = [];
    const isolated = process.env.X4_R1_ISOLATE === '1';
    for (let seed = 42500; seed < 42515; seed++) {
        const game = createHeadlessGame(seed);
        game.monsters = [];
        for (let x=10;x<=30;x++) for(let y=10;y<=30;y++) game.grid.setTerrain(x,y,T.FLOOR);
        game.player.loc.x=20;game.player.loc.y=20;
        game.grid.setTerrain(25,20,T.SECRET_DOOR,'#',0x999999);
        for(let y=17;y<=23;y++) game.grid.setTerrain(22,y,T.GRANITE,'#',0x666666);
        game.fov.computeFOV(20,20,10);
        expect(game.grid.getCell(25,20)!.isVisible).toBe(false);
        const stalks=[];
        for(let x=0;x<game.grid.width;x++) for(let y=0;y<game.grid.height;y++) {
            const c=game.grid.getCell(x,y)!;
            for(let layer=0;layer<4;layer++) if(c.layers[layer]===T.BLOODFLOWER_STALK) {
                stalks.push({x,y,layer});
                if(isolated) game.grid.setTerrainLayer(x,y,layer,T.NOTHING);
            }
        }
        const calls: {percent:number;stack:string;secrets:unknown[]}[]=[];
        const original=rng.randPercent.bind(rng);
        vi.spyOn(rng,'randPercent').mockImplementation(percent=>{
            const secrets=[];
            for(let x=0;x<game.grid.width;x++) for(let y=0;y<game.grid.height;y++) {
                const c=game.grid.getCell(x,y)!;
                if(c.isVisible && c.layers.some(t=>(TERRAIN_FLAGS[t].mechFlags&TM_IS_SECRET)!==0))
                    secrets.push({x,y,layers:c.layers.map(t=>T[t])});
            }
            calls.push({percent,stack:new Error().stack??'',secrets});
            return original(percent);
        });
        for(let k=0;k<5;k++) game.handlePlayerAction('search',undefined,'system');
        rows.push({seed,stalks,calls,door:T[game.grid.getCell(25,20)!.terrain]});
        if(isolated) expect(calls).toHaveLength(0);
        expect(game.grid.getCell(25,20)!.terrain).toBe(T.SECRET_DOOR);
        vi.restoreAllMocks();
    }
    writeFileSync(`ai_docs/reports/x4-r1-evidence/search-${isolated?'isolated':'probe'}.json`,JSON.stringify(rows,null,2)+'\n');
});
