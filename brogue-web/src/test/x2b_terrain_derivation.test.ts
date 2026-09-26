import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import ts from 'typescript';
import { Cell, DCOLS, DROWS, DungeonLayer as L, Grid, TerrainType as T } from '../engine/Map/Grid';
import * as F from '../engine/Map/TerrainCatalog';
import { createHeadlessGame, runTurns } from './harness';
import { snapshotGrid, restoreGrid } from '../engine/Core/LevelSnapshot';
import { BlueprintEngine } from '../engine/Generator/BlueprintEngine';
import { cleanUpLakeBoundaries, fillLakes } from '../engine/Map/LakeSystem';
import { EnvironmentManager, GasType } from '../engine/Environment/Gas';
import { catalogFeature, setDungeonFeatureEffects, spawnDungeonFeature } from '../engine/Map/DungeonFeature';
import { DF } from '../engine/Map/DungeonFeatureCatalog';
import { discoverTerrain, exposeTileToFire, promoteTile, runFireUpdate, runPromotionUpdate } from '../engine/Map/Promotion';
import { FOVSys } from '../engine/Lighting/FOV';
import { genericPathCost, safetyTerrainCosts, terrainBlocksScent } from '../engine/Map/TerrainRules';
import { playerTravelTerrainAllowed } from '../engine/Movement/PlayerTravel';
import { Monster, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { Item, ItemCategory } from '../engine/Items/Item';
import { rng } from '../engine/Random';

// Independent oracle: never calls the production refresh or terrain query helpers.
function assertCell(c: Cell): void {
    const flags = [0, 1, 2, 3].map(layer => F.TERRAIN_FLAGS[c.layers[layer]!].flags).reduce((a,b) => a|b, 0);
    expect([c.isPassable, c.isOpaque], `${c.x},${c.y}: ${c.layers.map(t=>T[t]).join('/')}`)
        .toEqual([!(flags & F.T_OBSTRUCTS_PASSABILITY), !!(flags & F.T_OBSTRUCTS_VISION)]);
}
function assertGrid(grid: Grid): void {
    for(let x=0;x<grid.width;x++) for(let y=0;y<grid.height;y++) assertCell(grid.getCell(x,y)!);
}
function plain(width=DCOLS,height=DROWS): Grid {
    const grid=new Grid(width,height);
    for(let x=0;x<width;x++) for(let y=0;y<height;y++) grid.setTerrain(x,y,T.FLOOR);
    return grid;
}
function scene(): any {
    const g:any=createHeadlessGame(424242);g.monsters=[];g.dormantMonsters=[];g.items=[];
    for(let x=0;x<g.grid.width;x++) for(let y=0;y<g.grid.height;y++) g.grid.setTerrain(x,y,T.FLOOR);
    g.player.loc={x:10,y:10};g.environment=new EnvironmentManager(g.grid);g.secretScanDepth=-1;
    return g;
}
function rat(x:number,y:number,id='rat'): Monster {
    return new Monster(x,y,(monsters as MonsterData[]).find(m=>m.id===id)!);
}
afterEach(()=>vi.restoreAllMocks());

describe('X2b full-layer terrain derivation',()=>{
    it('production has one boolean derivation owner and an exhaustive direct-layer writer inventory',()=>{
        const walk=(dir:string):string[]=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${dir}/${e.name}`):[`${dir}/${e.name}`]);
        const booleans:string[]=[],writers=new Set<string>();
        for(const file of [...walk('src/engine'),...walk('src/entities')].filter(f=>f.endsWith('.ts'))) {
            const ast=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
            const visit=(n:ts.Node)=>{
                if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.EqualsToken) {
                    const left=n.left;
                    let owner:ts.Node|undefined=n.parent;
                    while(owner&&!ts.isMethodDeclaration(owner)&&!ts.isFunctionDeclaration(owner))owner=owner.parent;
                    const name=owner&&(ts.isMethodDeclaration(owner)||ts.isFunctionDeclaration(owner))?owner.name?.getText(ast):'?';
                    if(ts.isPropertyAccessExpression(left)&&['isPassable','isOpaque'].includes(left.name.text))booleans.push(`${file}:${name}:${left.name.text}`);
                    const property=ts.isElementAccessExpression(left)?left.expression:left;
                    if(ts.isPropertyAccessExpression(property)&&property.name.text==='layers')writers.add(`${file}:${name}`);
                }
                ts.forEachChild(n,visit);
            };visit(ast);
        }
        expect(booleans.sort()).toEqual(['src/engine/Map/Grid.ts:refreshTerrainProperties:isOpaque','src/engine/Map/Grid.ts:refreshTerrainProperties:isPassable']);
        expect([...writers].sort()).toEqual([
            'src/engine/Core/Game.ts:crystalizeFromPlayer','src/engine/Core/Game.ts:resetTestRoom',
            'src/engine/Environment/Gas.ts:addGas','src/engine/Environment/Gas.ts:clearGasAt','src/engine/Environment/Gas.ts:updateGases',
            'src/engine/Generator/BlueprintEngine.ts:restoreLevel','src/engine/Map/Grid.ts:setTerrainLayer','src/engine/Map/Grid.ts:writeTerrainHome',
        ]);
    });
    it('fresh cells, every catalog entry, every layer, overlap, replacement and clear agree with flags',()=>{
        const grid=new Grid(3,3), c=grid.getCell(1,1)!;assertGrid(grid);
        for(const tile of Object.values(T).filter((t):t is T=>typeof t==='number')) {
            grid.setTerrain(1,1,tile);assertCell(c);
            c.terrain=T.FLOOR;assertCell(c);c.terrain=tile;assertCell(c);
            for(let layer=0;layer<4;layer++) {
                grid.setTerrain(1,1,T.FLOOR);
                grid.setTerrainLayer(1,1,layer,tile);assertCell(c);
                const other=(layer+1)%4;
                grid.setTerrainLayer(1,1,other,T.FORCEFIELD);assertCell(c);
                grid.setTerrainLayer(1,1,layer,T.NOTHING);assertCell(c);
                grid.setTerrainLayer(1,1,other,T.NOTHING);assertCell(c);
            }
        }
    });
    it('natural seed424242 D1 contains TORCH_WALL and FOLIAGE with correct blocking',()=>{
        const g=createHeadlessGame(424242);const counts={torch:0,foliage:0};
        for(let x=0;x<DCOLS;x++)for(let y=0;y<DROWS;y++) {
            const c=g.grid.getCell(x,y)!;assertCell(c);
            if(c.layers.includes(T.TORCH_WALL)){counts.torch++;expect(c.isPassable).toBe(false);expect(c.isOpaque).toBe(true);}
            if(c.layers.includes(T.FOLIAGE)){counts.foliage++;expect(c.isOpaque).toBe(true);}
        }
        expect(counts.torch).toBeGreaterThan(0);expect(counts.foliage).toBeGreaterThan(0);
        expect(g.grid.getCell(1,6)!.layers).toContain(T.TORCH_WALL);
    });
    it('natural Architect/Blueprint/Lake generation through D40 and runtime turns retain the invariant',()=>{
        for(const seed of [424242,777]) {
            const g:any=createHeadlessGame(seed);
            for(let depth=1;depth<=40;depth++) {
                if(depth>1){g.depth=depth;g.generateDepth(false,false);}
                assertGrid(g.grid);
                if([1,8,26,27,40].includes(depth)) {
                    runTurns(g,3,()=>({action:'wait'}));assertGrid(g.grid);
                }
            }
        }
    });
    it('lake filling/cleanup and blueprint rollback recompute both directions',()=>{
        const grid=plain();const engine:any=new BlueprintEngine(grid,5,[]);
        grid.setTerrain(10,10,T.TORCH_WALL);grid.setTerrainLayer(12,10,L.SURFACE,T.FOLIAGE);
        const snapshot=engine.backupLevel();
        grid.setTerrain(10,10,T.FLOOR);grid.setTerrainLayer(12,10,L.SURFACE,T.NOTHING);assertGrid(grid);
        engine.restoreLevel(snapshot);assertGrid(grid);
        expect(grid.getCell(10,10)!.isOpaque).toBe(true);expect(grid.getCell(12,10)!.isOpaque).toBe(true);
        fillLakes(grid,new Set([20+10*DCOLS,21+10*DCOLS]),2);assertGrid(grid);
        cleanUpLakeBoundaries(grid);assertGrid(grid);
        grid.setTerrain(10,10,T.FLOOR);const floor=engine.backupLevel();
        grid.setTerrain(10,10,T.TORCH_WALL);engine.restoreLevel(floor);assertGrid(grid);
        expect(grid.getCell(10,10)!.isOpaque).toBe(false);
    });
    it('snapshot restoration derives from layers, even if saved caches are stale',()=>{
        const grid=plain(6,6);grid.setTerrain(2,2,T.TORCH_WALL);grid.setTerrainLayer(3,3,L.SURFACE,T.FOLIAGE);
        const saved=snapshotGrid(grid);for(const c of saved){c.isOpaque=!c.isOpaque;c.isPassable=!c.isPassable;}
        const restored=restoreGrid(6,6,saved,[]);assertGrid(restored);
        expect(restored.getCell(2,2)!.isPassable).toBe(false);expect(restored.getCell(0,0)!.isPassable).toBe(true);
    });
    it('DF effect callbacks see already refreshed flags; DF clear and promotion preserve other-layer blockers',()=>{
        const grid=plain();let callbacks=0;
        setDungeonFeatureEffects(grid,{refreshCell:p=>{assertCell(grid.getCell(p.x,p.y)!);callbacks++;}});
        spawnDungeonFeature(grid,10,10,{...catalogFeature(DF.DF_FOLIAGE),startProbability:0},true);assertGrid(grid);
        expect(grid.getCell(10,10)!.isOpaque).toBe(true);expect(callbacks).toBeGreaterThan(0);
        grid.setTerrainLayer(10,10,L.DUNGEON,T.TORCH_WALL);
        promoteTile(grid,10,10,L.SURFACE,false);assertGrid(grid);
        expect(grid.getCell(10,10)!.isOpaque).toBe(true);
        grid.setTerrainLayer(10,10,L.DUNGEON,T.FLOOR);
        grid.setTerrainLayer(10,10,L.SURFACE,T.NOTHING);assertGrid(grid);
        expect(grid.getCell(10,10)!.isOpaque).toBe(false);
    });
    it('discovery, opening doors, foliage promotion, combustion and fire aging keep flags current',()=>{
        const grid=plain();grid.setTerrain(10,10,T.SECRET_DOOR);discoverTerrain(grid,10,10);assertGrid(grid);
        expect(grid.getCell(10,10)!.isPassable).toBe(true);
        grid.setTerrain(10,10,T.DOOR);promoteTile(grid,10,10,L.DUNGEON,false);assertGrid(grid);
        expect(grid.getCell(10,10)!.isOpaque).toBe(false);
        grid.setTerrainLayer(12,10,L.SURFACE,T.FOLIAGE);promoteTile(grid,12,10,L.SURFACE,false);assertGrid(grid);
        expect(grid.getCell(12,10)!.isOpaque).toBe(false);
        grid.setTerrainLayer(12,10,L.SURFACE,T.FOLIAGE);expect(exposeTileToFire(grid,12,10,true).ignited).toBe(true);assertGrid(grid);
        runFireUpdate(grid,{});assertGrid(grid);runPromotionUpdate(grid,{keyOnTileAt:()=>false});assertGrid(grid);
    });
    it('test-room restore and shattering refresh whole-layer replacement and border crystal',()=>{
        const g=scene();const c=g.grid.getCell(12,10)!;
        g.testRooms.set(123,{x1:12,x2:12,y1:10,y2:10,baselineItems:[],baselineMonsters:[],
            baselineTerrains:[{x:12,y:10,layers:[T.TORCH_WALL,T.NOTHING,T.NOTHING,T.NOTHING],char:'#',color:0xffffff,isPassable:true,isOpaque:false}]});
        g.resetTestRoom(123);assertGrid(g.grid);expect(c.isPassable).toBe(false);expect(c.isOpaque).toBe(true);
        g.crystalizeFromPlayer(3);assertGrid(g.grid);expect(c.isOpaque).toBe(false);
        g.player.loc={x:1,y:10};g.grid.setTerrain(0,10,T.TORCH_WALL);g.grid.impregnableCells.clear();
        g.crystalizeFromPlayer(3);assertGrid(g.grid);
        expect(g.grid.getCell(0,10)!.layers[L.DUNGEON]).toBe(T.CRYSTAL_WALL);
        expect(g.grid.getCell(0,10)!.isPassable).toBe(false);expect(g.grid.getCell(0,10)!.isOpaque).toBe(false);
        g.testRooms.get(123).baselineTerrains[0].layers=[T.FLOOR,T.NOTHING,T.NOTHING,T.NOTHING];
        g.resetTestRoom(123);assertGrid(g.grid);expect(c.isPassable).toBe(true);
    });
    it('gas insertion/competition/evacuation and clearing retain both positive and negative blockers',()=>{
        const grid=plain();const env=new EnvironmentManager(grid);
        grid.setTerrainLayer(10,10,L.SURFACE,T.FOLIAGE);
        env.addGas(10,10,GasType.POISON,100);assertGrid(grid);env.updateGases();assertGrid(grid);
        env.clearGasAt(10,10);assertGrid(grid);expect(grid.getCell(10,10)!.isOpaque).toBe(true);
        grid.setTerrain(12,10,T.FORCEFIELD);env.addGas(12,10,GasType.POISON,100);env.updateGases();assertGrid(grid);
        grid.setTerrain(10,10,T.FLOOR);env.addGas(10,10,GasType.POISON,100);env.clearGasAt(10,10);assertGrid(grid);
        expect(grid.getCell(10,10)!.isOpaque).toBe(false);
    });
});

describe('X2b consumers retain their CE terrain responsibility',()=>{
    it('generation arc counts use pathing blockers and door exceptions, without consuming RNG',()=>{
        const g=scene();const dirs=[[0,1],[1,1],[1,0],[1,-1],[0,-1],[-1,-1],[-1,0],[-1,1]];
        for(const [dx,dy]of dirs)g.grid.setTerrain(20+dx!,10+dy!,T.CHASM);
        g.grid.setTerrain(20,9,T.FLOOR);g.grid.setTerrain(20,11,T.LOCKED_DOOR);
        const before=rng.getState();expect(g.passableArcCount(20,10)).toBe(2);expect(rng.getState()).toEqual(before);
        g.grid.setTerrain(20,11,T.CRYSTAL_WALL);expect(g.passableArcCount(20,10)).toBe(1);
    });
    it('FOV and LOS block foliage but see through crystal; movement does the reverse',()=>{
        const g=scene();const fov=new FOVSys(g.grid);
        g.grid.setTerrainLayer(12,10,L.SURFACE,T.FOLIAGE);
        expect(g.hasLineOfSight(10,10,14,10)).toBe(false);
        expect(fov.computeFOVMask(10,10,10,c=>c.isOpaque)[14]![10]).toBe(false);
        expect(g.grid.getCell(12,10)!.isPassable).toBe(true);
        g.grid.setTerrain(12,10,T.CRYSTAL_WALL);
        expect(g.hasLineOfSight(10,10,14,10)).toBe(true);
        expect(g.grid.getCell(12,10)!.isPassable).toBe(false);
    });
    it('search uses full-layer blocking for the probability discount and opacity before RNG',()=>{
        const g=scene();g.grid.setTerrain(12,10,T.GAS_TRAP_POISON_HIDDEN);
        g.grid.setTerrainLayer(12,10,L.LIQUID,T.LOCKED_DOOR);
        g.grid.setTerrainLayer(12,10,L.SURFACE,T.PLAIN_FIRE);
        expect(g.grid.getCell(12,10)!.terrain).toBe(T.PLAIN_FIRE);
        const rolls=vi.spyOn(rng,'randPercent').mockReturnValue(false);
        g.searchForSecrets(60);expect(rolls).toHaveBeenCalledWith(40*2/3);
        rolls.mockClear();g.grid.setTerrainLayer(11,10,L.SURFACE,T.FOLIAGE);
        g.searchForSecrets(60);expect(rolls).not.toHaveBeenCalled();
    });
    it('flight walks through foliage, blocks crystal and allows chasms; ground avoids chasms',()=>{
        const g=scene(), m:any=rat(11,10,'bloat');g.monsters=[m];m.setStatusDuration('levitating',100);
        g.grid.setTerrainLayer(12,10,L.SURFACE,T.FOLIAGE);expect(m.canEnterMovementTerrain(g,12,10)).toBe(true);
        g.grid.setTerrain(12,10,T.CRYSTAL_WALL);expect(m.canEnterMovementTerrain(g,12,10)).toBe(false);
        m.tryMoveTo(12,10,g);expect(m.x).toBe(11);
        g.grid.setTerrain(12,10,T.CHASM);expect(m.canEnterMovementTerrain(g,12,10)).toBe(true);
        const ground:any=rat(11,11);expect(ground.canEnterMovementTerrain(g,12,10)).toBe(false);
        g.grid.setTerrain(12,10,T.SECRET_DOOR);expect(ground.canEnterMovementTerrain(g,12,10)).toBe(true);
    });
    it('auto travel uses remembered full-layer terrain, hazards and player immunity without revealing unseen changes',()=>{
        const g=scene(), cell=g.grid.getCell(12,10)!,here=g.grid.getCell(10,10)!;here.isVisible=true;cell.isVisible=true;
        g.grid.setTerrain(12,10,T.CHASM);expect(cell.isPassable).toBe(true);
        expect(playerTravelTerrainAllowed(cell,here,g.player)).toBe(false);
        g.player.setStatusDuration('levitating',100);expect(playerTravelTerrainAllowed(cell,here,g.player)).toBe(true);
        g.grid.setTerrain(12,10,T.CRYSTAL_WALL);expect(playerTravelTerrainAllowed(cell,here,g.player)).toBe(false);
        cell.isVisible=false;cell.hasMemory=true;cell.rememberedLayers=[T.FLOOR,T.NOTHING,T.NOTHING,T.FOLIAGE];
        expect(playerTravelTerrainAllowed(cell,here,g.player)).toBe(true);
        cell.rememberedLayers=[T.TORCH_WALL,T.NOTHING,T.NOTHING,T.NOTHING];
        g.grid.setTerrain(12,10,T.FLOOR);expect(playerTravelTerrainAllowed(cell,here,g.player)).toBe(false);
        cell.hasMemory=false;cell.isExplored=false;expect(playerTravelTerrainAllowed(cell,here,g.player)).toBe(true);
    });
    it('auto travel does not reveal secret floor hazards, but still blocks secret walls',()=>{
        const g=scene(),cell=g.grid.getCell(12,10)!,here=g.grid.getCell(10,10)!;
        for(const [hidden,revealed] of [[T.GAS_TRAP_POISON_HIDDEN,T.GAS_TRAP_POISON],[T.TRAP_DOOR_HIDDEN,T.TRAP_DOOR]]) {
            g.grid.setTerrain(12,10,hidden!);expect(playerTravelTerrainAllowed(cell,here,g.player)).toBe(true);
            cell.isVisible=false;cell.hasMemory=true;cell.rememberedLayers=[...cell.layers];
            g.grid.setTerrain(12,10,revealed!);expect(playerTravelTerrainAllowed(cell,here,g.player)).toBe(true);
            cell.isVisible=true;expect(playerTravelTerrainAllowed(cell,here,g.player)).toBe(false);
        }
        g.grid.setTerrain(12,10,T.SECRET_DOOR);expect(playerTravelTerrainAllowed(cell,here,g.player)).toBe(false);
    });
    it('generic/safety/scent keep distinct costs despite identical physical passability',()=>{
        const grid=plain(),c=grid.getCell(5,5)!;const ctx={playerLevitating:false,playerImmuneToFire:false,harmlessOccupant:false};
        grid.setTerrain(5,5,T.WATER_DEEP);expect(c.isPassable).toBe(true);expect(genericPathCost(c)).toBe(-1);expect(safetyTerrainCosts(c,ctx)).toEqual([5,5]);
        grid.setTerrain(5,5,T.CHASM);expect(c.isPassable).toBe(true);expect(safetyTerrainCosts(c,ctx)).toEqual([-1,-1]);
        grid.setTerrain(5,5,T.DOOR);expect(c.isPassable).toBe(true);expect(c.isOpaque).toBe(true);expect(terrainBlocksScent(c)).toBe(true);
        grid.setTerrain(5,5,T.SECRET_DOOR);expect(c.isPassable).toBe(false);expect(genericPathCost(c)).toBe(1);expect(safetyTerrainCosts(c,ctx)).toEqual([100,1]);
    });
    it('force respects both optical and physical blockers, unlike ordinary stagger',()=>{
        const g=scene(),m=rat(11,10);g.monsters=[m];
        const weapon=new Item('dagger','/',0xffffff,ItemCategory.WEAPON);
        weapon.enchantment=3;weapon.strengthRequired=g.player.effectiveStrength;g.player.equippedWeapon=weapon;
        g.grid.setTerrain(12,10,T.FOLIAGE);g.applyWeaponRunicEffect(m,1,'force');expect(m.x).toBe(11);
        g.grid.setTerrain(12,10,T.CRYSTAL_WALL);g.applyWeaponRunicEffect(m,1,'force');expect(m.x).toBe(11);
        g.grid.setTerrain(12,10,T.FLOOR);g.applyWeaponRunicEffect(m,1,'force');expect(m.x).toBeGreaterThan(11);
    });
    it('random player teleport never admits physically passable hazards; split uses monster avoidance',()=>{
        const g=scene();
        for(let x=0;x<DCOLS;x++)for(let y=0;y<DROWS;y++)g.grid.setTerrain(x,y,T.CHASM);
        for(let y=0;y<DROWS;y++)g.grid.setTerrain(20,y,T.WALL);
        g.grid.getCell(70,20)!.machineNumber=0;
        g.grid.setTerrain(10,10,T.FLOOR);g.grid.setTerrain(70,20,T.FLOOR);
        g.teleportPlayerRandom();expect(g.player.loc).toEqual({x:70,y:20});
        const jelly=rat(69,20,'pink_jelly');g.monsters=[jelly];g.grid.setTerrain(69,20,T.FLOOR);
        const hp=jelly.hp;g.trySplitMonster(jelly,g.player);
        expect(g.monsters).toHaveLength(1);expect(jelly.hp).toBe(hp);
    });
    it('stagger checks source/destination passability, can enter water and crosses opaque foliage',()=>{
        const g=scene(),m=rat(11,10);g.monsters=[m];
        g.grid.setTerrain(12,10,T.WATER_DEEP);g.processStaggerHit(g.player,m);expect(m.loc).toEqual({x:12,y:10});
        m.loc={x:11,y:10};g.grid.setTerrain(12,10,T.FOLIAGE);g.processStaggerHit(g.player,m);expect(m.x).toBe(12);assertGrid(g.grid);
        m.loc={x:11,y:10};g.grid.setTerrain(11,10,T.CRYSTAL_WALL);g.processStaggerHit(g.player,m);expect(m.x).toBe(11);
        g.grid.setTerrain(11,10,T.FLOOR);g.grid.setTerrain(12,10,T.CRYSTAL_WALL);g.processStaggerHit(g.player,m);expect(m.x).toBe(11);
    });
});
