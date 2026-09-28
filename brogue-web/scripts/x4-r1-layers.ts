import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHeadlessGame } from '../src/test/harness';
import { Grid, TerrainType as T, DungeonLayer } from '../src/engine/Map/Grid';

it('records cold generation layer writers for the exact historical F3 seeds/depths', () => {
    const writes: unknown[] = [], cells: unknown[] = [];
    const original = Grid.prototype.setTerrainLayer;
    let active: {seed:number,depth:number} | null = null;
    Grid.prototype.setTerrainLayer = function(x:number,y:number,layer:DungeonLayer,tile:T) {
        const prior = this.getCell(x,y)?.layers.slice();
        const result = original.call(this,x,y,layer,tile);
        if (active && prior) writes.push({...active,x,y,layer,tile:T[tile],before:prior.map(t=>T[t]),
            after:this.getCell(x,y)!.layers.map(t=>T[t]),stack:new Error().stack?.split('\n').slice(2,8)});
        return result;
    };
    try {
        for (const seed of [424242,777]) {
            const game:any=createHeadlessGame(seed);
            const catchUp=game.catchUpEnvironment.bind(game);
            game.catchUpEnvironment=(...args:unknown[])=>{
                for(let x=0;x<game.grid.width;x++)for(let y=0;y<game.grid.height;y++) {
                    const cell=game.grid.getCell(x,y)!;
                    if(cell.layers.some((t:T)=>t>=T.BLOODFLOWER_POD))cells.push({seed,depth:game.depth,x,y,machine:cell.machineNumber,layers:cell.layers.map((t:T)=>T[t])});
                }
                active=null;
                return catchUp(...args);
            };
            active={seed,depth:1};game.startNewGame({seed});
            game.depth=9;active={seed,depth:9};game.generateDepth(false,false);
            active=null;
        }
    } finally {Grid.prototype.setTerrainLayer=original;}
    writeFileSync('ai_docs/reports/x4-r1-evidence/layer-writes.json.gz',gzipSync(JSON.stringify(writes)));
    writeFileSync('ai_docs/reports/x4-r1-evidence/new-terrain-cold-cells.json',JSON.stringify(cells,null,2)+'\n');
});
