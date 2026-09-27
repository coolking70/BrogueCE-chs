import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Grid, TerrainType as T, DungeonLayer as L } from '../engine/Map/Grid';
import { spawnDungeonFeature, catalogFeature, setDungeonFeatureEffects, resetDFMessageEligibility,
    setDormantAwakener, type DungeonFeature } from '../engine/Map/DungeonFeature';
import { DF, DFF_EVACUATE_CREATURES_FIRST as EVAC, DFF_SUBSEQ_EVERYWHERE as EVERY,
    DFF_AGGRAVATES_MONSTERS as AGGRAVATE, DFF_PERMIT_BLOCKING as PERMIT,
    DFF_CLEAR_OTHER_TERRAIN as CLEAR, DFF_BLOCKED_BY_OTHER_LAYERS as BLOCKED,
    DFF_ACTIVATE_DORMANT_MONSTER as WAKE, DF_MISSING_TILES, DUNGEON_FEATURE_CATALOG } from '../engine/Map/DungeonFeatureCatalog';
import { T_PATHING_BLOCKER, TERRAIN_FLAGS } from '../engine/Map/TerrainCatalog';
import { spawnObstruction, promoteTile } from '../engine/Map/Promotion';
import { rng } from '../engine/Random';
import { createHeadlessGame } from './harness';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { Item, ItemCategory } from '../engine/Items/Item';
import { logger } from '../engine/Systems/Logger';
import { ScentMap } from '../engine/Map/Scent';

function grid(w=13,h=9) {
    const g=new Grid(w,h);
    for(let x=0;x<w;x++)for(let y=0;y<h;y++)g.setTerrain(x,y,x===0||y===0||x===w-1||y===h-1?T.WALL:T.FLOOR);
    return g;
}
function feat(changes: Partial<DungeonFeature>={}): DungeonFeature {
    return {...catalogFeature(DF.DF_FORCEFIELD),startProbability:0,probabilityDecrement:0,...changes};
}
function scene() {
    const game=createHeadlessGame(1717,'test');
    for(let x=1;x<game.grid.width-1;x++)for(let y=1;y<game.grid.height-1;y++) game.grid.setTerrain(x,y,T.FLOOR);
    game.monsters=[];game.dormantMonsters=[];game.items=[];game.player.loc={x:5,y:5};
    game.player.hp=game.player.maxHp=100;game.player.statusDurations={};
    (game as any).bindDormantAwakener();
    return game;
}
function rat(game: ReturnType<typeof scene>,x:number,y:number) {
    const m=new Monster(x,y,(monsters as MonsterData[]).find(m=>m.id==='rat')!);
    m.hp=m.maxHp=100;game.monsters.push(m);return m;
}
beforeEach(()=>{vi.restoreAllMocks();rng.seedRandomGenerator(1717);});

describe('U17a DF transaction: CE ordering and recursive world effects',()=>{
    it('evacuates from the raw footprint BEFORE priority rejects fill, including generation refresh=false',()=>{
        const g=grid(),entity={loc:{x:6,y:4},forbiddenTerrain:T_PATHING_BLOCKER};
        g.setTerrainLayer(6,4,L.SURFACE,T.FORCEFIELD);
        setDungeonFeatureEffects(g,{creatures:()=>[entity]});
        const result=spawnDungeonFeature(g,6,4,feat({flags:EVAC}),false,{refreshSideEffects:false});
        expect(result.builtCells).toEqual([]);expect(result.evacuationRequired).toBe(true);
        expect(entity.loc).not.toEqual({x:6,y:4});
        expect(g.getCell(6,4)!.layers[L.SURFACE]).toBe(T.FORCEFIELD);
    });
    it('uses species forbidden terrain, all occupants, x/y ring order, and no extra roll on singleton',()=>{
        const g=grid(7,7);
        for(let x=1;x<6;x++)for(let y=1;y<6;y++)g.setTerrain(x,y,T.WALL);
        for(const [x,y] of [[3,3],[2,3],[4,3]])g.setTerrain(x!,y!,T.FLOOR);
        const a={loc:{x:3,y:3},forbiddenTerrain:T_PATHING_BLOCKER},b={loc:{x:2,y:3},forbiddenTerrain:T_PATHING_BLOCKER};
        setDungeonFeatureEffects(g,{creatures:()=>[a,b]});
        const before=rng.randomNumbersGenerated;
        spawnDungeonFeature(g,3,3,feat({tile:T.NOTHING,flags:EVAC}),false);
        expect(a.loc).toEqual({x:4,y:3});expect(b.loc).toEqual({x:2,y:3});
        expect(rng.randomNumbersGenerated).toBe(before);
    });
    it('blocking veto has no evacuation/aggravation/recursion; PERMIT_BLOCKING permits the same footprint',()=>{
        const g=grid();for(let x=1;x<12;x++)for(let y=1;y<8;y++)g.setTerrain(x,y,y===4?T.FLOOR:T.WALL);
        const a={loc:{x:6,y:4},forbiddenTerrain:T_PATHING_BLOCKER};const alarm=vi.fn();
        setDungeonFeatureEffects(g,{creatures:()=>[a],aggravate:alarm});
        const f=feat({flags:EVAC|AGGRAVATE,effectRadius:4,subsequentDF:DF.DF_EMBERS});
        expect(spawnDungeonFeature(g,6,4,f,true).succeeded).toBe(false);expect(a.loc).toEqual({x:6,y:4});expect(alarm).not.toHaveBeenCalled();
        expect(spawnDungeonFeature(g,6,4,{...f,flags:f.flags|PERMIT},true).succeeded).toBe(true);
        expect(a.loc).not.toEqual({x:6,y:4});expect(alarm).toHaveBeenCalledWith(4,{x:6,y:4});
    });
    it('refresh occurs per cell before clear, aggravation, subsequent, shore invalidation and awakening',()=>{
        const g=grid();g.setTerrainLayer(6,4,L.SURFACE,T.BLOOD);
        const order:string[]=[];
        setDungeonFeatureEffects(g,{refreshCell:()=>order.push('refresh'),instantEffects:()=>order.push(`contact:${g.getCell(6,4)!.layers[L.SURFACE]}`),
            aggravate:()=>order.push(`alarm:${g.getCell(6,4)!.layers[L.SURFACE]}`),invalidateShore:()=>order.push('shore')});
        setDormantAwakener(g,()=>order.push('wake'));
        spawnDungeonFeature(g,6,4,feat({tile:T.HOLE,layer:L.LIQUID,flags:CLEAR|AGGRAVATE|WAKE,effectRadius:3,subsequentDF:DF.DF_EMBERS}),false);
        expect(order).toEqual(['refresh',`contact:${T.BLOOD}`,`alarm:${T.NOTHING}`,'refresh',`contact:${T.EMBERS}`,'shore','wake']);
    });
    it('EVERY uses only successfully filled cells; descendants inherit refresh=false and live context',()=>{
        const g=grid();g.setTerrainLayer(6,4,L.SURFACE,T.FORCEFIELD);
        const refresh=vi.fn(),alarm=vi.fn();setDungeonFeatureEffects(g,{refreshCell:refresh,aggravate:alarm});
        const f=feat({flags:EVERY|AGGRAVATE,effectRadius:3,subsequentDF:DF.DF_EMBERS});
        expect(spawnDungeonFeature(g,6,4,f,false,{refreshSideEffects:false}).builtCells).toEqual([]);
        expect(g.getCell(6,4)!.layers[L.SURFACE]).toBe(T.FORCEFIELD);expect(refresh).not.toHaveBeenCalled();expect(alarm).toHaveBeenCalledTimes(1);
        spawnDungeonFeature(g,4,4,{...f,tile:T.BLOOD},false,{refreshSideEffects:false});
        expect(g.getCell(4,4)!.layers[L.SURFACE]).toBe(T.EMBERS);expect(refresh).not.toHaveBeenCalled();
    });
    it('BLOCKED_BY_OTHER_LAYERS filters footprint before descendants',()=>{
        const g=grid();g.setTerrainLayer(6,4,L.LIQUID,T.LAVA);
        const f=feat({tile:T.BLOOD,flags:BLOCKED|EVERY,subsequentDF:DF.DF_EMBERS});
        expect(spawnDungeonFeature(g,6,4,f,false).builtCells).toEqual([]);
        expect(g.getCell(6,4)!.layers[L.SURFACE]).toBe(T.NOTHING);
    });
    it('gas refresh does not contact/burn/evacuate; following DF does contact and clear',()=>{
        const g=grid();const refresh=vi.fn(),contact=vi.fn(),burn=vi.fn();
        setDungeonFeatureEffects(g,{refreshCell:refresh,instantEffects:contact,burnItems:burn});
        spawnDungeonFeature(g,6,4,feat({tile:T.POISON_GAS,layer:L.GAS,startProbability:100,flags:EVAC,subsequentDF:DF.DF_PLAIN_FIRE}),false);
        expect(g.getCell(6,4)!.volume).toBe(100);expect(refresh).toHaveBeenCalledTimes(2);expect(contact).toHaveBeenCalledTimes(1);expect(burn).toHaveBeenCalledTimes(1);
    });
    it('description precedes veto, is visibility-gated and resets per turn; nested contexts restore after an error',()=>{
        const g=grid();let visible=false;const describe=vi.fn(()=>visible);setDungeonFeatureEffects(g,{describe});
        const f=feat({description:'test message'});
        spawnDungeonFeature(g,6,4,f,false);visible=true;spawnDungeonFeature(g,6,4,f,false);spawnDungeonFeature(g,6,4,f,false);
        expect(describe).toHaveBeenCalledTimes(2);resetDFMessageEligibility(g);spawnDungeonFeature(g,6,4,f,false);expect(describe).toHaveBeenCalledTimes(3);
        expect(()=>spawnDungeonFeature(g,4,4,feat(),false,{effects:{instantEffects:()=>{throw new Error('test');}}})).toThrow('test');
        expect(()=>spawnDungeonFeature(g,3,4,feat(),false)).not.toThrow();
    });
    it('message eligibility follows DF identity, not shared text; fresh catalog projections retain identity',()=>{
        const g=grid(),describe=vi.fn(()=>true);setDungeonFeatureEffects(g,{describe});
        const first=feat({catalogId:undefined,description:'shared text'}),second=feat({catalogId:undefined,description:'shared text'});
        spawnDungeonFeature(g,6,4,first,false);spawnDungeonFeature(g,6,4,first,false);
        spawnDungeonFeature(g,6,4,second,false);expect(describe).toHaveBeenCalledTimes(2);
        const catalog=(id=DF.DF_REPEL_CREATURES)=>{const f=catalogFeature(id);f.description='shared text';return f;};
        spawnDungeonFeature(g,6,4,catalog(),false);spawnDungeonFeature(g,6,4,catalog(),false);
        expect(describe).toHaveBeenCalledTimes(3);
        spawnDungeonFeature(g,6,4,catalog(DF.DF_OPEN_DOOR),false);
        expect(describe).toHaveBeenCalledTimes(4);
        resetDFMessageEligibility(g);spawnDungeonFeature(g,6,4,catalog(),false);
        expect(describe).toHaveBeenCalledTimes(5);
    });
    it('game end during fill stops further fill/contact and subsequent, while failed DF still refreshes player hazard',()=>{
        const g=grid();let ended=false;const contact=vi.fn(()=>{ended=true;}),burn=vi.fn();
        setDungeonFeatureEffects(g,{instantEffects:contact,gameHasEnded:()=>ended,burnItems:burn});
        spawnDungeonFeature(g,6,4,feat({tile:T.PLAIN_FIRE,startProbability:100,probabilityDecrement:100,subsequentDF:DF.DF_EMBERS}),false);
        expect(contact).toHaveBeenCalledTimes(1);expect(burn).not.toHaveBeenCalled();
        expect(g.getCell(6,4)!.layers[L.SURFACE]).toBe(T.NOTHING);
    });
    it('generic occupied contact dissolves both forcefield stages, also for direct DF and promotion recursion',()=>{
        const g=grid();setDungeonFeatureEffects(g,{occupied:p=>p.x===6&&p.y===4});
        spawnDungeonFeature(g,6,4,feat(),false);
        expect(g.getCell(6,4)!.layers[L.SURFACE]).toBe(T.NOTHING);expect(g.getCell(6,4)!.isPassable).toBe(true);
        spawnObstruction(g,8,4,2,()=>false);expect(g.getCell(8,4)!.isPassable).toBe(false);
    });
});

describe('U17a actual Game consumers',()=>{
    it('recursive hole marks player falling without inventing an immediate floor-item update',()=>{
        const g=scene(),item=new Item('test',')',0xffffff,ItemCategory.WEAPON);item.loc={...g.player.loc};g.items.push(item);
        spawnDungeonFeature(g.grid,5,5,feat({tile:T.NOTHING,subsequentDF:DF.DF_HOLE_POTION}),false);
        expect((g as any).playerFalling).toBe(true);expect(g.items).toContain(item);
    });
    it('instant fire burns only scrolls, ignites and damages through recursive DF before returning',()=>{
        const g=scene(),m=rat(g,7,5);g.player.loc={x:20,y:20};
        for(const category of [ItemCategory.SCROLL,ItemCategory.POTION]){const item=new Item('test','?',0xffffff,category);item.loc={x:7,y:5};g.items.push(item);}
        spawnDungeonFeature(g.grid,7,5,feat({tile:T.NOTHING,subsequentDF:DF.DF_BLOAT_EXPLOSION}),false);
        expect(m.hp).toBe(50);expect((g as any).burningDuration(m)).toBeGreaterThan(0);
        expect(g.items.map(i=>i.category)).toEqual([ItemCategory.POTION]);
        expect(g.grid.getCell(7,5)!.layers[L.SURFACE]).toBe(T.ITEM_FIRE);
        expect(TERRAIN_FLAGS[T.ITEM_FIRE].promoteChance).toBe(3000);
        const restored=createHeadlessGame(1718,'test');expect(restored.loadSnapshot(g.toSnapshot())).toBe(true);
        expect(restored.grid.getCell(7,5)!.layers[L.SURFACE]).toBe(T.ITEM_FIRE);
        promoteTile(g.grid,7,5,L.SURFACE,false);expect(g.grid.getCell(7,5)!.layers[L.SURFACE]).toBe(T.EMBERS);
    });
    it('lethal player contact ends the actual Game before burning items, filling later cells or running descendants',()=>{
        const g=scene();g.player.loc={x:4,y:5};g.player.hp=1;
        g.grid.setTerrainLayer(4,5,L.GAS,T.CONFUSION_GAS);
        const scroll=new Item('test','?',0xffffff,ItemCategory.SCROLL);scroll.loc={x:4,y:5};g.items.push(scroll);
        spawnDungeonFeature(g.grid,5,5,feat({tile:T.GAS_EXPLOSION,startProbability:100,probabilityDecrement:100,subsequentDF:DF.DF_EMBERS}),false);
        expect(g.isGameOver).toBe(true);expect(g.player.hp).toBeLessThanOrEqual(0);
        expect(g.player.hasStatus('confused'), 'CE Time.c:370 returns before gas statuses after lethal explosion').toBe(false);
        expect(g.items).toContain(scroll);expect(g.grid.getCell(4,5)!.layers[L.SURFACE]).toBe(T.GAS_EXPLOSION);
        expect(g.grid.getCell(6,5)!.layers[L.SURFACE]).toBe(T.NOTHING);
    });
    it('direct and descendant fires register the current-turn skip without callers draining results',()=>{
        const g=scene();g.player.loc={x:20,y:20};
        const r=spawnDungeonFeature(g.grid,7,5,feat({tile:T.NOTHING,subsequentDF:DF.DF_PLAIN_FIRE}),false);
        expect(r.caughtFireCells).toEqual([{x:7,y:5}]);
        expect((g as any).pendingCaughtFireCells).toContainEqual({x:7,y:5});
    });
    it('runtime evacuation moves real player and creature; generation refresh=false moves without contact/status',()=>{
        const g=scene(),m=rat(g,7,5);const before={...m.loc};
        spawnDungeonFeature(g.grid,7,5,feat({flags:EVAC,tile:T.PLAIN_FIRE}),false,{refreshSideEffects:false});
        expect(m.loc).not.toEqual(before);expect((g as any).burningDuration(m)).toBe(0);
        spawnDungeonFeature(g.grid,5,5,catalogFeature(DF.DF_REPEL_CREATURES),false);
        expect(g.player.loc).not.toEqual({x:5,y:5});
    });
    it('alarm uses four-way path radius from origin, resets scent, preserves allies, wakes enemies and sets source status',()=>{
        const g=scene(),near=rat(g,7,5),far=rat(g,8,5),ally=rat(g,5,6);
        near.state=far.state=MonsterState.ASLEEP;ally.isAlly=true;ally.state=MonsterState.WANDERING;
        near.behaviorFlags.add('MONST_MAINTAINS_DISTANCE');near.abilityFlags.add('MA_AVOID_CORRIDORS');
        g.scent=new ScentMap(g.grid.width,g.grid.height);g.scent.turnNumber=1000;g.scent.addScent(g.grid,7,5,0);
        spawnDungeonFeature(g.grid,5,5,feat({tile:T.NOTHING,flags:AGGRAVATE,effectRadius:2}),false);
        expect(near.state).toBe(MonsterState.HUNTING);expect(near.ticksUntilTurn).toBe(100);
        expect(far.state).toBe(MonsterState.ASLEEP);expect(ally.isAlly).toBe(true);
        expect(near.behaviorFlags.has('MONST_MAINTAINS_DISTANCE')).toBe(false);expect(near.abilityFlags.has('MA_AVOID_CORRIDORS')).toBe(false);
        expect(g.scent.get(7,5)).toBe(996);expect(g.player.getStatusDuration('aggravating')).toBe(2);
        expect(g.waypoints.coordinates[0]).toEqual({x:5,y:5});
    });
    it('two Game/grid owners cannot redirect each others contact or messages',()=>{
        const a=scene(),b=scene();b.player.loc={x:20,y:20};
        spawnDungeonFeature(a.grid,5,5,feat({tile:T.WEB}),false);
        expect(a.player.hasStatus('stuck')).toBe(true);expect(b.player.hasStatus('stuck')).toBe(false);
        const c=a.grid.getCell(5,5)!;c.isVisible=true;const before=logger.messages.length;
        spawnDungeonFeature(a.grid,5,5,catalogFeature(DF.DF_WOODEN_BARRICADE_BURN),false);
        expect(logger.messages.length).toBeGreaterThan(before);
    });
    it('actual stair movement changes level before REPEL_CREATURES can evict the player',()=>{
        const g=createHeadlessGame(1717);g.animationEnabled=false;g.monsters=[];
        const to={...(g as any).levelSeeds[0].downStairsLoc};
        const from=[[0,-1],[0,1],[-1,0],[1,0]].map(([dx,dy])=>({x:to.x+dx!,y:to.y+dy!}))
            .find(p=>(g as any).canMoveTo(p.x,p.y))!;
        expect(from).toBeDefined();g.player.loc=from;
        g.handlePlayerAction('move',{x:to.x-from.x,y:to.y-from.y},'system');
        expect(g.depth).toBe(2);expect(g.player.loc).not.toEqual(to);
    });
    it('alarm source may be remote: wall detours reject nearby cells and only player-origin alarms add AGGRAVATING',()=>{
        const g=scene(),m=rat(g,9,5);m.state=MonsterState.ASLEEP;
        for(let y=1;y<g.grid.height-1;y++)g.grid.setTerrain(8,y,T.WALL);
        spawnDungeonFeature(g.grid,7,5,feat({tile:T.NOTHING,flags:AGGRAVATE,effectRadius:4}),false);
        expect(m.state).toBe(MonsterState.ASLEEP);expect(g.player.hasStatus('aggravating')).toBe(false);
        expect(g.waypoints.coordinates[0]).toEqual({x:7,y:5});
    });
    it('alarm status, moved entities and post-load grid binding survive the existing snapshot contract',()=>{
        const g=scene();spawnDungeonFeature(g.grid,5,5,feat({tile:T.NOTHING,flags:AGGRAVATE,effectRadius:8}),false);
        spawnDungeonFeature(g.grid,5,5,feat({tile:T.NOTHING,flags:AGGRAVATE,effectRadius:3}),false);
        expect(g.player.getStatusDuration('aggravating')).toBe(3);expect(g.player.maxStatus.aggravating).toBe(3);
        spawnDungeonFeature(g.grid,5,5,catalogFeature(DF.DF_REPEL_CREATURES),false);const position={...g.player.loc};
        const restored=createHeadlessGame(1718,'test');expect(restored.loadSnapshot(g.toSnapshot())).toBe(true);
        expect(restored.player.loc).toEqual(position);expect(restored.player.maxStatus.aggravating).toBe(3);
        spawnDungeonFeature(restored.grid,position.x,position.y,feat({tile:T.WEB}),false);
        expect(restored.player.hasStatus('stuck')).toBe(true);expect(g.player.hasStatus('stuck')).toBe(false);
        restored.player.tickStatuses();expect(restored.player.getStatusDuration('aggravating')).toBe(2);
    });
    it('flash obeys refresh, radius and animation lifetime without changing lighting or either RNG stream',()=>{
        const g=scene();(g as any).updateVision();
        const f=feat({tile:T.NOTHING,flashColor:'darkBlue',effectRadius:3});
        const before=rng.getState(),light={...g.lightMap.lightAt(5,5)!};
        spawnDungeonFeature(g.grid,5,5,f,false,{refreshSideEffects:false});expect(g.terrainFlashAt(5,5)).toBeNull();
        spawnDungeonFeature(g.grid,5,5,f,false);
        expect(g.terrainFlashAt(5,5)!.b).toBeGreaterThan(0);expect(g.terrainFlashAt(12,5)).toBeNull();
        expect(g.lightMap.lightAt(5,5)).toEqual(light);expect(rng.getState()).toEqual(before);
        g.tickFlareAnimation(200);expect(g.terrainFlashAt(5,5)).toBeNull();
    });
    it('transient flashes are discarded by load and new-run lifecycle without entering snapshots',()=>{
        const g=scene();(g as any).updateVision();
        const flash=()=>spawnDungeonFeature(g.grid,g.player.x,g.player.y,feat({tile:T.NOTHING,flashColor:'darkBlue',effectRadius:3}),false);
        flash();expect(g.terrainFlashAt(g.player.x,g.player.y)).not.toBeNull();
        const snapshot=g.toSnapshot();expect(JSON.stringify(snapshot)).not.toContain('terrainFlashes');
        expect(g.loadSnapshot(snapshot)).toBe(true);expect(g.terrainFlashAt(g.player.x,g.player.y)).toBeNull();
        flash();expect(g.terrainFlashAt(g.player.x,g.player.y)).not.toBeNull();
        g.startNewGame({seed:1719,mode:'test'});expect(g.terrainFlashAt(g.player.x,g.player.y)).toBeNull();
    });
    it.each(['load','new-run','test-depth'])('retired grid cannot mutate the replacement world after %s',transition=>{
        const g=scene(),retired=g.grid;
        if(transition==='load') expect(g.loadSnapshot(g.toSnapshot())).toBe(true);
        else if(transition==='new-run') g.startNewGame({seed:1720,mode:'test'});
        else (g as any).generateTestDepth(true);
        g.monsters=[];g.player.loc={x:5,y:5};
        g.grid.setTerrain(5,5,T.FLOOR);g.grid.setTerrain(4,5,T.FLOOR);
        // savedAt is wall-clock metadata; every world field and both RNG streams stay exact.
        const worldSnapshot=()=>({...JSON.parse(JSON.stringify(g.toSnapshot())),savedAt:0});
        const before=worldSnapshot();
        const repel=feat({tile:T.NOTHING,flags:EVAC});
        spawnDungeonFeature(retired,5,5,repel,false);
        expect(worldSnapshot()).toEqual(before);
        spawnDungeonFeature(g.grid,5,5,repel,false);
        expect(g.player.loc).not.toEqual({x:5,y:5});
    });
    it('historical U17a projection: 30 missing rows before the U17b/U17c/U17d/U17e carriers',()=>{
        expect([...DF_MISSING_TILES, 155, 187, 87, 88, 148, 191, 61, 66, 104, 83, 98, 154, 17, 152, 95, 144, 179, 180, 182, 183, 185, 174, 175, 14, 19, 85, 140, 141, 143, 145]).toHaveLength(30);
        expect(Object.keys(DUNGEON_FEATURE_CATALOG).filter(k => Number(k) !== 63 && Number(k) !== 96 && Number(k) !== 137 && Number(k) !== 178 && ![84,142,146,192,5,9,11,12,18,20,21,22,42,64,65,71,72,73,74,75,76,77,78,79,80,126,127,128].includes(Number(k)))).toHaveLength(140);
        expect(DF.DF_ITEM_FIRE).toBe(110);
        expect(catalogFeature(DF.DF_ITEM_FIRE)).toMatchObject({tile:T.ITEM_FIRE,layer:L.SURFACE,startProbability:0,flags:0,lightFlare:'FALLEN_TORCH_FLASH_LIGHT'});
    });
});
