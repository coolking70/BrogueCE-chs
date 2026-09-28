import {it, expect} from 'vitest';
import {readFileSync, writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {createHeadlessGame} from '../src/test/harness';
import {Cell, TerrainType as T} from '../src/engine/Map/Grid';
import {machineScene} from '../src/test/fixtures/u19a-machine-scenes';
import {setMachineObservationHook} from '../src/engine/Generator/MachineObservation';
const out = 'ai_docs/reports/x4-r2-evidence';
it('records exact historical cold F3 samples and constructive rare-machine checks', () => {
    const cells: unknown[] = [], rare: unknown[] = [];
    for (const seed of [424242, 777]) {
        const g: any = createHeadlessGame(seed), catchUp = g.catchUpEnvironment.bind(g);
        g.catchUpEnvironment = (...args: unknown[]) => {
            for (const c of g.grid.cells.flat()) if (c.layers.filter((t: T) => t !== T.NOTHING).length > 1) {
                cells.push({seed, depth:g.depth, x:c.x, y:c.y, machine:c.machineNumber, layers:c.layers.map((t:T) => T[t])});
            }
            return catchUp(...args);
        };
        g.startNewGame({seed}); g.depth = 9; g.generateDepth(false, false);
    }
    writeFileSync(`${out}/cold-layer-cells.json`, JSON.stringify(cells, null, 2)+'\n');
    const g: any = createHeadlessGame(19, 'test');
    for (const id of [46, 50]) {
        let success: any = null;
        const failures: unknown[] = [];
        setMachineObservationHook(t => {if(t.status === 'rolled_back') failures.push(t);});
        outer: for (const size of [-1, 0, 1, 2]) for (let seed = 1; seed <= 8; seed++) {
            const scene = machineScene(g, id, seed, size, true);
            if (scene) {
                success = {id,seed,size,features:scene.result.observation?.features,
                    items:g.items.map((i:any)=>({identity:i.identityId??i.consumableId,loc:i.loc})),
                    monsters:[...g.monsters,...g.dormantMonsters].map((m:any)=>({type:m.typeId,dormant:m.isDormant}))};
                break outer;
            }
        }
        rare.push({id,success,failures});
        expect(success).not.toBeNull();
    }
    setMachineObservationHook(null);
    writeFileSync(`${out}/rare-constructive.json`, JSON.stringify(rare, null, 2)+'\n');
});

it('traces the actual writers of the ten newly observed F3 tuples', () => {
    const targets = JSON.parse(readFileSync(`${out}/f3-new-tuples.json`, 'utf8'));
    const wanted = new Set(targets.map((c:any) => `${c.seed}:${c.depth}:${c.x}:${c.y}`));
    const prior = new WeakMap<Cell, T[]>(), writes: unknown[] = [];
    let active: {seed:number,depth:number} | null = null;
    const original = Cell.prototype.refreshTerrainProperties;
    Cell.prototype.refreshTerrainProperties = function() {
        const before = prior.get(this), result = original.call(this);
        if (active && wanted.has(`${active.seed}:${active.depth}:${this.x}:${this.y}`)
            && (!before || before.some((t,i) => t !== this.layers[i]))) {
            writes.push({...active,x:this.x,y:this.y,before:before?.map(t=>T[t]),after:this.layers.map(t=>T[t]),
                stack:new Error().stack?.split('\n').slice(2,9)});
        }
        prior.set(this, [...this.layers]);
        return result;
    };
    try {
        for (const seed of [424242,777]) {
            const g:any=createHeadlessGame(seed), catchUp=g.catchUpEnvironment.bind(g);
            g.catchUpEnvironment=(...args:unknown[])=>{active=null;return catchUp(...args);};
            active={seed,depth:1};g.startNewGame({seed});
            g.depth=9;active={seed,depth:9};g.generateDepth(false,false);
        }
    } finally {Cell.prototype.refreshTerrainProperties=original;}
    writeFileSync(`${out}/f3-layer-writers.json.gz`,gzipSync(JSON.stringify(writes)));
});
