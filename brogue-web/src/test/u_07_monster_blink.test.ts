import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../engine/Core/Game';
import { Grid, DungeonLayer, TerrainType as T } from '../engine/Map/Grid';
import { EnvironmentManager } from '../engine/Environment/Gas';
import { Player } from '../entities/Player';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { rng } from '../engine/Random';
import { ScentMap } from '../engine/Map/Scent';
import { burnedTerrainFlagsOfCell } from '../engine/Map/DungeonFeature';
import { TERRAIN_FLAGS, T_IS_FLAMMABLE } from '../engine/Map/TerrainCatalog';
import { allocShortGrid } from '../engine/Map/SafetyMap';
import { perimeterCoords } from '../engine/Combat/BoltReflection';
import { chooseMonsterBlink, monsterBlinkToPreferenceMap, monsterBlinkImpact, monsterBlinkAvoids,
    monsterBlinkToSafety, buildBlinkAllySafetyMap, buildBlinkSafeTerrainMap, buildBlinkEnemyMap, buildBlinkTargetMap,
    closestBlinkEnemy, blinkTowardCreature, blinkTowardCaptiveLeader, blinkChance, blinkAllyFlees, blinkAllyAfterMagic, scanBlinkMap } from '../engine/Combat/MonsterBlink';
import golden from '../../ai_docs/reports/u-07-evidence/ce-blink.json';

function scene() {
    const g = Object.create(Game.prototype) as Game;
    g.grid = new Grid(40,30);
    for(let x=0;x<40;x++) for(let y=0;y<30;y++) {
        g.grid.setTerrain(x,y,x===0||y===0||x===39||y===29?T.WALL:T.FLOOR);
        Object.assign(g.grid.getCell(x,y)!,{isVisible:true,hasMemory:true});
    }
    g.player = new Player(30,15); g.player.hp=g.player.maxHp=100;
    g.monsters=[];g.dormantMonsters=[];g.items=[];g.levels=new Map();
    g.visibleMonsters=new Set();g.environment=new EnvironmentManager(g.grid);
    g.scent=new ScentMap(40,30);g.safetyMap=allocShortGrid(40,30,0);g.updatedSafetyMapThisTurn=false;
    g.loopMap=Array.from({length:40},()=>Array(30).fill(false));
    g.spawnFloatingText=vi.fn();(g as any).updateVision=vi.fn();
    g.waypoints={count:0,chooseNewWanderDestination:vi.fn()} as any;
    (g as any).machineCells=new Set();
    return g;
}
function monster(g:Game,x=15,y=15,id='imp') {
    const m=new Monster(x,y,(monsters as MonsterData[]).find(m=>m.id===id)!);
    m.state=MonsterState.HUNTING;m.behaviorFlags.add('MONST_ALWAYS_USE_ABILITY');
    m.behaviorFlags.add('MONST_ALWAYS_HUNTING');m.ticksUntilTurn=17;
    g.monsters.push(m);return m;
}
const manhattan=(p:{x:number;y:number},q:{x:number;y:number})=>Math.abs(p.x-q.x)+Math.abs(p.y-q.y);
beforeEach(()=>{vi.restoreAllMocks();rng.seedRandomGenerator(707);});

describe('U07 CE selector oracle and perimeter',()=>{
    it('matches all 100 independently compiled CE vectors, with 40 probes and no RNG',()=>{
        const before=rng.randomNumbersGenerated;
        for(const c of golden.cases) {
            let calls=0;
            const choice=c.hasBolt?chooseMonsterBlink({x:15,y:15},p=>c.values[p.x]![p.y]!,c.uphill,
                p=>!!c.avoids[p.x]![p.y],()=>c.impacts[calls++]!,p=>!!c.blocks[p.x]![p.y]):null;
            expect(!!choice).toBe(c.expected.ok);expect(choice?.aim??{x:-1,y:-1}).toEqual(c.expected.aim);
            expect(calls).toBe(c.expected.calls);
        }
        expect(rng.randomNumbersGenerated).toBe(before);
    });
    it('enumerates the exact 40 targets without duplicated corners',()=>{
        const p=Array.from({length:40},(_,n)=>perimeterCoords(n));
        expect(new Set(p.map(p=>`${p.x},${p.y}`)).size).toBe(40);
        expect(p.slice(0,11)).toEqual(Array.from({length:11},(_,i)=>({x:i-5,y:-5})));
        expect(p.slice(11,22)).toEqual(Array.from({length:11},(_,i)=>({x:i-5,y:5})));
        expect(p.slice(22,31)).toEqual(Array.from({length:9},(_,i)=>({x:-5,y:i-4})));
        expect(p.slice(31)).toEqual(Array.from({length:9},(_,i)=>({x:5,y:i-4})));
    });
    it('ties keep the first aim; a cardinal score must be beaten, not equaled',()=>{
        const o={x:15,y:15};let calls=0;
        const value=(p:{x:number;y:number})=>p.y===14?10:p.y===20?10:0;
        expect(chooseMonsterBlink(o,value,true,()=>false,()=>{calls++;return {x:15,y:20};},()=>false)).toBeNull();
        expect(calls).toBe(40);
        const best=chooseMonsterBlink(o,p=>p.y===20?11:0,true,()=>false,()=>({x:15,y:20}),()=>false);
        expect(best?.aim).toEqual({x:10,y:10});
    });
    it('a later better adjacent diagonal clears an earlier useful jump',()=>{
        let n=0;const o={x:15,y:15};
        const run=(blocked:boolean)=>{n=0;return chooseMonsterBlink(o,p=>p.x===16&&p.y===16?3:p.x===20?2:0,true,()=>false,
            ()=>++n===1?{x:20,y:15}:{x:16,y:16},p=>blocked&&p.x===16&&p.y===15);};
        expect(run(false)).toBeNull();expect(run(true)?.impact).toEqual({x:16,y:16});
    });
});

describe('U07 capability and probability resource contract',()=>{
    it('bolts, not an MA flag: absent and ALWAYS cost zero draws; ordinary gate costs one',()=>{
        const g=scene(),m=monster(g);let before=rng.randomNumbersGenerated;
        expect(blinkChance(m)).toBe(true);expect(rng.randomNumbersGenerated).toBe(before);
        m.behaviorFlags.delete('MONST_ALWAYS_USE_ABILITY');blinkChance(m);expect(rng.randomNumbersGenerated).toBe(before+1);
        before=rng.randomNumbersGenerated;m.bolts=[];m.abilityFlags.add('MA_BLINK');
        expect(blinkChance(m)).toBe(false);expect(rng.randomNumbersGenerated).toBe(before);
    });
    it('every currently flammable terrain has a readable immediate burn successor',()=>{
        const g=scene();for(const [id,tile] of Object.entries(TERRAIN_FLAGS)) {
            if(!(tile.flags&T_IS_FLAMMABLE))continue;
            g.grid.setTerrainLayer(8,8,DungeonLayer.SURFACE,Number(id));
            expect(()=>burnedTerrainFlagsOfCell(g.grid.getCell(8,8)!)).not.toThrow();
        }
    });
    it('rest/search extends ally combat leash, with no changes to ordinary movement state',()=>{
        const g=scene();expect(g.allyBlinkLeashLength()).toBe(4);
        (g as any).justRested=true;expect(g.allyBlinkLeashLength()).toBe(10);
        (g as any).justRested=false;(g as any).justSearched=true;expect(g.allyBlinkLeashLength()).toBe(10);
    });
});

describe('U07 rays, destination policy, ticks and resources',()=>{
    it.each([false,true])('fixed E5/12-cell range, slow=%s, no RNG or item resource consumption',slow=>{
        const g=scene(),m=monster(g);if(slow)m.behaviorFlags.add('MONST_CAST_SPELLS_SLOWLY');
        m.attackSpeed=73;const before=rng.randomNumbersGenerated;const player=JSON.stringify(g.player);
        expect(monsterBlinkToPreferenceMap(g,m,p=>p.x,true)).toBe(true);
        expect(m.x).toBe(27);expect(m.ticksUntilTurn).toBe(slow?146:73);
        expect(rng.randomNumbersGenerated).toBe(before);expect(JSON.stringify(g.player)).toBe(player);
        expect((g as any).updateVision).toHaveBeenCalledOnce();
    });
    it('flat/no ability failures leave position, clock, animation and RNG unchanged',()=>{
        const g=scene(),m=monster(g),before=rng.randomNumbersGenerated;
        expect(monsterBlinkToPreferenceMap(g,m,()=>5,true)).toBe(false);
        expect(m.loc).toEqual({x:15,y:15});expect(m.ticksUntilTurn).toBe(17);
        m.bolts=[];expect(monsterBlinkToPreferenceMap(g,m,p=>p.x,true)).toBe(false);
        expect((g as any).updateVision).not.toHaveBeenCalled();expect(rng.randomNumbersGenerated).toBe(before);
        expect((g as any).pendingBoltFrames).toBeUndefined();
    });
    it.each([T.WALL,T.LOCKED_DOOR,T.FORCEFIELD,T.CRYSTAL_WALL,T.SECRET_DOOR,T.PORTCULLIS_CLOSED])('four-layer obstruction %s stops the ray, including flying casters',terrain=>{
        const g=scene(),m=monster(g);g.grid.setTerrainLayer(18,15,DungeonLayer.SURFACE,terrain);
        g.grid.getCell(18,15)!.isPassable=true;
        expect(monsterBlinkImpact(g,m,{x:20,y:15})).toEqual({x:17,y:15});
        g.castMonsterBlink(m,{x:20,y:15});expect(m.loc).toEqual({x:17,y:15});
    });
    it.each(['rat','stone_guardian'])('occupied target %s halts before it without damage/reflection',id=>{
        const g=scene(),m=monster(g),other=monster(g,18,15,id),hp=other.hp;
        expect(monsterBlinkImpact(g,m,{x:20,y:15})).toEqual({x:17,y:15});
        const r=g.castMonsterBlink(m,{x:20,y:15});expect(m.loc).toEqual({x:17,y:15});
        expect(r.hits).toEqual([]);expect(r.reflections).toEqual([]);expect(other.hp).toBe(hp);
    });
    it('hidden enemy is ignored in prediction but actual cast stops short and spends the attack clock',()=>{
        const g=scene(),m=monster(g),other=monster(g,16,15,'rat');other.isAlly=true;other.setStatusDuration('invisible',20);
        expect(monsterBlinkImpact(g,m,{x:20,y:15})).toEqual({x:27,y:15});
        expect(monsterBlinkToPreferenceMap(g,m,p=>p.x===27&&p.y===15?10:0,true)).toBe(true);
        expect(m.loc).toEqual({x:15,y:15});expect(m.ticksUntilTurn).toBe(m.attackSpeed);
        expect((g as any).updateVision).not.toHaveBeenCalled();
    });
    it('dormant occupied landing is rejected by W11 commit without displacing either creature',()=>{
        const g=scene(),m=monster(g),d=monster(g,27,15,'rat');g.monsters.pop();d.isDormant=true;g.dormantMonsters.push(d);
        g.castMonsterBlink(m,{x:20,y:15});expect(m.loc).toEqual({x:15,y:15});expect(d.loc).toEqual({x:27,y:15});
    });
    it('an unobservable landing is legal; player blink visibility policy is not consulted',()=>{
        const g=scene(),m=monster(g);
        for(let x=0;x<40;x++)for(let y=0;y<30;y++)g.grid.getCell(x,y)!.isVisible=false;
        expect(monsterBlinkToPreferenceMap(g,m,p=>p.x,true)).toBe(true);expect(m.x).toBe(27);
    });
    it('hazard and immunity contract is based on real layers and temporary statuses',()=>{
        const g=scene(),m=monster(g,15,15,'rat'),p={x:20,y:15};m.bolts=['BLINKING'];
        g.grid.setTerrainLayer(p.x,p.y,DungeonLayer.LIQUID,T.LAVA);
        expect(monsterBlinkAvoids(g,m,p)).toBe(true);m.setStatusDuration('levitating',10);expect(monsterBlinkAvoids(g,m,p)).toBe(false);
        m.setStatusDuration('levitating',0);m.setStatusDuration('immune_fire',10);expect(monsterBlinkAvoids(g,m,p)).toBe(false);
        g.grid.setTerrain(p.x,p.y,T.STAIRS_DOWN);expect(monsterBlinkAvoids(g,m,p)).toBe(true);
    });
});

describe('U07 AI call sites',()=>{
    it('fleeing blink increases distance using the existing safety map before summon/bolt',()=>{
        const g=scene(),m=monster(g);g.player.loc={x:12,y:15};m.state=MonsterState.FLEEING;m.hp=1;
        const summon=vi.spyOn(m,'trySummon');const before=manhattan(m.loc,g.player.loc);
        m.takeTurn(g,20);expect(manhattan(m.loc,g.player.loc)).toBeGreaterThan(before+1);expect(summon).not.toHaveBeenCalled();
    });
    it('30% rejection consumes exactly the gate RNG; ALWAYS bypasses it',()=>{
        const g=scene(),m=monster(g);m.state=MonsterState.FLEEING;m.hp=1;m.behaviorFlags.delete('MONST_ALWAYS_USE_ABILITY');
        const chance=vi.spyOn(rng,'randPercent').mockReturnValue(false),cast=vi.spyOn(g,'castMonsterBlink');
        m.takeTurn(g,20);expect(chance).toHaveBeenCalledExactlyOnceWith(30);expect(cast).not.toHaveBeenCalled();
    });
    it('safety snapshot survives an unseen moving player and is released upon awareness',()=>{
        const g=scene(),m=monster(g);g.grid.getCell(m.x,m.y)!.isVisible=false;
        monsterBlinkToSafety(g,m);const snap=m.safetySnapshot;expect(snap).not.toBeNull();
        g.player.loc={x:4,y:4};g.updatedSafetyMapThisTurn=false;g.grid.getCell(m.x,m.y)!.isVisible=false;
        monsterBlinkToSafety(g,m);expect(m.safetySnapshot).toBe(snap);
        g.grid.getCell(m.x,m.y)!.isVisible=true;monsterBlinkToSafety(g,m);expect(m.safetySnapshot).toBeNull();
    });
    it('hunting moves uphill toward player scent even without line of sight',()=>{
        const g=scene(),m=monster(g);const scent=vi.spyOn(g.scent,'get').mockImplementation((x)=>x);
        vi.spyOn(g,'hasLineOfSight').mockReturnValue(false);
        m.takeTurn(g,20);expect(m.x).toBe(27);expect(scent).toHaveBeenCalled();
    });
    it('ordinary successful magic keeps priority over hunting blink',()=>{
        const g=scene(),m=monster(g);m.bolts=['HASTE','BLINKING'];
        vi.spyOn(m,'tryUseBolt').mockReturnValue(true);const blink=vi.spyOn(g,'castMonsterBlink');
        m.takeTurn(g,20);expect(blink).not.toHaveBeenCalled();
    });
    it.each(['paralyzed','entranced','caged','asleep','immobile','turret','dormant'])('%s cannot enter the dedicated schedule',gate=>{
        const g=scene(),m=monster(g);vi.spyOn(g.scent,'get').mockImplementation(x=>x);const blink=vi.spyOn(g,'castMonsterBlink');
        if(gate==='paralyzed'||gate==='entranced')m.setStatusDuration(gate,20);
        else if(gate==='caged')m.isCaged=true;else if(gate==='asleep')m.state=MonsterState.ASLEEP;
        else if(gate==='dormant')m.isDormant=true;else m.behaviorFlags.add(gate==='turret'?'MONST_TURRET':'MONST_IMMOBILE');
        m.takeTurn(g,20);expect(blink).not.toHaveBeenCalled();
    });
    it.each([true,false])('ally=%s escapes harmful terrain with no 30% lottery',ally=>{
        const g=scene(),m=monster(g,15,15,'rat');m.bolts=['BLINKING'];m.isAlly=ally;m.state=MonsterState.WANDERING;
        m.behaviorFlags.delete('MONST_ALWAYS_HUNTING');m.behaviorFlags.delete('MONST_ALWAYS_USE_ABILITY');
        g.player.loc={x:35,y:25};
        for(let x=11;x<=19;x++)for(let y=11;y<=19;y++)g.grid.setTerrainLayer(x,y,DungeonLayer.GAS,T.POISON_GAS);
        const chance=vi.spyOn(rng,'randPercent');m.takeTurn(g,1);
        expect(manhattan(m.loc,{x:15,y:15})).toBeGreaterThan(4);expect(m.ticksUntilTurn).toBe(m.attackSpeed);
        expect(chance).not.toHaveBeenCalled();
    });
    it('weak ally flees nearby enemies using ally safety, not player safety',()=>{
        const g=scene(),m=monster(g);m.isAlly=true;m.hp=1;m.regenTurns=10;
        const enemy=monster(g,18,15,'rat');expect(blinkAllyFlees(g,m,enemy)).toBe(true);
        const d=manhattan(m.loc,enemy.loc);m.takeTurn(g,20);expect(manhattan(m.loc,enemy.loc)).toBeGreaterThan(d);
        expect(m.safetySnapshot).toBeNull();
    });
    it('ally follows player scent beyond distance 10 with no probability gate',()=>{
        const g=scene(),m=monster(g);m.isAlly=true;m.behaviorFlags.delete('MONST_ALWAYS_USE_ABILITY');
        vi.spyOn(g.scent,'get').mockImplementation(x=>x);const chance=vi.spyOn(rng,'randPercent');
        m.takeTurn(g,20);expect(m.x).toBe(27);expect(chance).not.toHaveBeenCalled();
    });
    it('leader distance 10 and independent follower gates suppress scent blink',()=>{
        const g=scene(),m=monster(g);m.isAlly=true;g.player.loc={x:25,y:15};
        vi.spyOn(g.scent,'get').mockImplementation(x=>x);expect(blinkAllyAfterMagic(g,m,null)).toBe(false);
        g.player.loc={x:30,y:15};m.doesNotTrackLeader=true;expect(blinkAllyAfterMagic(g,m,null)).toBe(false);
    });
    it('CE strict enemy-map inequality leaves visible nearest enemy unseeded',()=>{
        const g=scene(),m=monster(g);m.isAlly=true;g.player.loc={x:14,y:15};const enemy=monster(g,21,15,'rat');
        expect(closestBlinkEnemy(g,m)).toBe(enemy);const map=buildBlinkEnemyMap(g,m,6);
        expect(map[enemy.x]![enemy.y]).toBe(10000);expect(blinkAllyAfterMagic(g,m,enemy)).toBe(false);
        // A source admitted by the CE predicate produces a real downhill pursuit.
        const seeded=buildBlinkEnemyMap(g,m,7);expect(seeded[enemy.x]![enemy.y]).toBe(0);
        expect(monsterBlinkToPreferenceMap(g,m,seeded,false)).toBe(true);expect(manhattan(m.loc,enemy.loc)).toBeLessThan(6);
    });
    it('invisible closer enemy is retried by enemy-map loop after the first scan misses it',()=>{
        const g=scene(),m=monster(g);m.isAlly=true;g.player.loc={x:14,y:15};
        const hidden=monster(g,21,15,'rat');hidden.setStatusDuration('invisible',20);monster(g,24,15,'rat');
        vi.spyOn(rng,'randPercent').mockReturnValue(false);
        const closest=closestBlinkEnemy(g,m)!;expect(closest.x).toBe(24);
        expect(blinkAllyAfterMagic(g,m,closest)).toBe(true);expect(m.x).toBeGreaterThan(15);
    });
    it('blocked straight leader path uses target-distance map; clear straight path skips it',()=>{
        const g=scene(),m=monster(g);m.isAlly=true;
        expect(blinkTowardCreature(g,m,g.player)).toBe(false);
        g.grid.setTerrain(22,15,T.WALL);expect(blinkTowardCreature(g,m,g.player)).toBe(true);
        expect(manhattan(m.loc,g.player.loc)).toBeLessThan(15);
    });
    it.each([false,true])('wandering follower reaches its own leader across a blocked straight path, captive=%s',captive=>{
        const g=scene(),m=monster(g),leader=monster(g,28,15,'rat');
        m.state=MonsterState.WANDERING;m.leader=leader;leader.isCaged=captive;leader.hp=100;leader.regenTurns=10;
        g.player.loc={x:2,y:2};vi.spyOn(g,'hasLineOfSight').mockReturnValue(false);g.grid.setTerrain(22,15,T.WALL);
        if(captive){const ally=monster(g,14,15,'rat');ally.isAlly=true;ally.dominated=true;}
        const origin={...m.loc};m.takeTurn(g,1);
        expect(manhattan(m.loc,leader.loc)).toBeLessThan(manhattan(origin,leader.loc)-1);
        expect(m.ticksUntilTurn).toBe(m.attackSpeed);expect(leader.hp).toBe(100);
    });
    it.each(['low-hp','no-regen','poison','diagonal'])('captive-priority gate rejects %s, without resource/time use',gate=>{
        const g=scene(),m=monster(g),leader=monster(g,28,15,'rat');m.leader=leader;
        leader.isCaged=true;leader.hp=100;leader.regenTurns=10;g.grid.setTerrain(22,15,T.WALL);
        if(gate==='low-hp')leader.hp=0;if(gate==='no-regen')leader.regenTurns=0;
        if(gate==='poison')m.abilityFlags.add('MA_POISONS');
        if(gate==='diagonal'){leader.loc.y=18;g.grid.setTerrain(15,18,T.WALL);}
        const before=rng.randomNumbersGenerated;expect(blinkTowardCaptiveLeader(g,m)).toBe(false);
        expect(m.ticksUntilTurn).toBe(17);expect(rng.randomNumbersGenerated).toBe(before);
    });
    it('failure continues walking in the same takeTurn, without charging an attack turn',()=>{
        const g=scene(),m=monster(g);vi.spyOn(g.scent,'get').mockReturnValue(0);const origin={...m.loc};
        m.takeTurn(g,20);expect(manhattan(m.loc,origin)).toBeGreaterThan(0);expect(m.ticksUntilTurn).not.toBe(m.attackSpeed);
    });
});

describe('U07 map boundaries',()=>{
    it('safe-terrain map seeds floor but not gas, doors, fire or forbidden chasms',()=>{
        const g=scene();g.grid.setTerrain(10,10,T.DOOR);g.grid.setTerrainLayer(11,10,DungeonLayer.GAS,T.POISON_GAS);
        g.grid.setTerrain(12,10,T.CHASM);const map=buildBlinkSafeTerrainMap(g);
        expect(map[9]![10]).toBe(0);expect(map[10]![10]).toBeGreaterThan(0);expect(map[11]![10]).toBeGreaterThan(0);expect(map[12]![10]).toBe(30000);
    });
    it('ally safety sources are enemies even outside player visibility, never player/teammates',()=>{
        const g=scene(),m=monster(g);m.isAlly=true;const enemy=monster(g,18,15,'rat');g.grid.getCell(18,15)!.isVisible=false;
        const map=buildBlinkAllySafetyMap(g);expect(map[enemy.x]![enemy.y]).toBe(0);expect(map[15]![15]).toBeLessThan(0);expect(map[g.player.x]![g.player.y]).toBe(30000);
    });
    it('target map seeds a forbidden destination like CE pdsSetDistance',()=>{
        const g=scene(),m=monster(g),target=monster(g,24,15,'stone_guardian');
        target.behaviorFlags.add('MONST_IMMOBILE');
        const map=buildBlinkTargetMap(g,m,target);expect(map[24]![15]).toBe(0);expect(map[23]![15]).toBe(1);
    });
    it('enemy scans respect both -2 diagonal obstructions, without changing the shared scanner',()=>{
        const g=scene();for(const offset of [[1,0],[0,1]]) {
            const map=allocShortGrid(40,30,30000),costs=allocShortGrid(40,30,-1);map[10]![10]=0;costs[10]![10]=1;costs[11]![11]=1;
            costs[10+offset[0]!]![10+offset[1]!]=-2;scanBlinkMap(g,map,costs,true);expect(map[11]![11]).toBe(30000);
        }
    });
});
