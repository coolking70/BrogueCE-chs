import { afterEach, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import { serializeMonster, restoreEntityGraph } from '../engine/Core/EntitySnapshot';
import { CEBoltType } from '../engine/Combat/BoltCatalog';
import { CombatSystem } from '../engine/Combat/Combat';
import { generateMonsterDetail } from '../engine/UI/DetailGenerator';
import { Grid, TerrainType as T, DCOLS, DROWS } from '../engine/Map/Grid';
import { EnvironmentManager } from '../engine/Environment/Gas';
import { FOVSys } from '../engine/Lighting/FOV';
import { LightMap } from '../engine/Lighting/LightMap';
import { rng } from '../engine/Random';
import monsters from '../data/monsters.json';
import { createHeadlessGame } from './harness';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const data = (id = 'rat') => (monsters as MonsterData[]).find(m => m.id === id)!;
function mob(id = 'rat') { const m = new Monster(10, 8, data(id)); m.hp = m.maxHp = 100; return m; }
function pending(m: Monster) {
    Object.assign(m, {targetCorpseLoc: {...m.loc}, targetCorpseName: 'fallen dragon', corpseAbsorptionCounter: 13,
        absorptionFlags: 'MONST_FLIES', absorbBehavior: true, absorptionBolt: CEBoltType.NONE,
        isAbsorbing: true, newPowerCount: 2, totalPowerCount: 4});
    return m;
}
// Independent explicit projection, not derived from MONSTER_FIELDS or the codec.
const state = (m: Monster) => ({targetCorpseLoc: m.targetCorpseLoc && {...m.targetCorpseLoc}, targetCorpseName: m.targetCorpseName,
    corpseAbsorptionCounter: m.corpseAbsorptionCounter, absorptionFlags: m.absorptionFlags, absorbBehavior: m.absorbBehavior,
    absorptionBolt: m.absorptionBolt, isAbsorbing: m.isAbsorbing, newPowerCount: m.newPowerCount, totalPowerCount: m.totalPowerCount});
function scene() {
    const g = createHeadlessGame(1010, 'test');
    g.grid = new Grid(DCOLS, DROWS);
    for (let x=0; x<DCOLS; x++) for (let y=0; y<DROWS; y++) {
        g.grid.setTerrain(x,y,x===0 || y===0 || x===DCOLS-1 || y===DROWS-1 ? T.WALL : T.FLOOR);
        g.grid.getCell(x,y)!.isVisible = true;
    }
    g.environment = new EnvironmentManager(g.grid); g.fov = new FOVSys(g.grid); g.lightMap = new LightMap(g.grid);
    g.player.loc = {x:4,y:5}; g.monsters = []; g.dormantMonsters = []; g.items = []; g.animationEnabled = false;
    return g;
}
afterEach(() => vi.restoreAllMocks());

it('fresh creature uses initializeMonster defaults; player clone copies the player memset position, with no absorption UI', () => {
    for (const m of [mob(), Monster.copyPlayerForClone(scene().player)]) {
        expect(state(m)).toEqual({targetCorpseLoc:m.typeId==='player_clone'?{x:0,y:0}:null,targetCorpseName:'',corpseAbsorptionCounter:0,absorptionFlags:null,
            absorbBehavior:false,absorptionBolt:CEBoltType.NONE,isAbsorbing:false,newPowerCount:0,totalPowerCount:0});
        expect(generateMonsterDetail(m,30,12,0,null,0,12).sections.flatMap(s=>s.lines).some(l=>l.progress)).toBe(false);
    }
});

it.each(['behavior','ability','bolt','interrupted','stale','empty'] as const)('%s selection round-trips in a standalone reactive entity graph without aliasing or RNG', kind => {
    const m = pending(mob());
    if (kind === 'ability') {m.absorptionFlags='MA_TRANSFERENCE';m.absorbBehavior=false;}
    if (kind === 'bolt') {m.absorptionBolt=CEBoltType.ANCIENT_SPIRIT_VINES;m.absorptionFlags=null;}
    if (kind === 'interrupted') m.isAbsorbing=false;
    if (kind === 'stale') {m.targetCorpseLoc=null;m.corpseAbsorptionCounter=-1;}
    if (kind === 'empty') Object.assign(m,state(mob()));
    m.behaviorFlags.add('MONST_REFLECT_50');m.abilityFlags.add('MA_CAUSES_WEAKNESS');m.bolts=['FIRE'];m.ticksUntilTurn=37;
    const before=state(m), random=JSON.stringify(rng), saved=serializeMonster(reactive(m) as Monster);
    const loaded=restoreEntityGraph([json(saved)]).monsters.get(m.id)!;
    expect(state(loaded)).toEqual(before);expect(loaded.ticksUntilTurn).toBe(37);
    expect(loaded.behaviorFlags.has('MONST_REFLECT_50')).toBe(true);expect(loaded.abilityFlags.has('MA_CAUSES_WEAKNESS')).toBe(true);expect(loaded.bolts).toEqual(['FIRE']);
    expect(JSON.stringify(rng)).toBe(random);
    if(loaded.targetCorpseLoc) {loaded.targetCorpseLoc.x++;expect(state(m)).toEqual(before);expect(saved.targetCorpseLoc).toEqual(before.targetCorpseLoc);}
});

it('current-layer active, dormant, cyclic carried/leader entities preserve their own pending task across real JSON load', () => {
    const g=scene(),a=pending(mob()),d=pending(mob('kobold')),p=pending(mob('phoenix'));
    d.isDormant=true;d.isAbsorbing=false;d.corpseAbsorptionCounter=18;d.absorptionBolt=CEBoltType.FIRE;
    p.targetCorpseLoc={x:8,y:9};p.absorptionFlags='MA_TRANSFERENCE';p.absorbBehavior=false;
    a.carriedMonster=p;p.leader=a;p.carriedMonster=d;d.leader=p;
    g.monsters=[a];g.dormantMonsters=[d];const saved=json(g.toSnapshot());
    const before=[a,d,p].map(state);
    expect(g.loadSnapshot(saved)).toBe(true);expect(rng.randomNumbersGenerated).toBe(0); // Existing load reseeds (U02), but decoding draws nothing.
    const la=g.monsters[0]!,ld=g.dormantMonsters[0]!,lp=la.carriedMonster!;
    expect([la,ld,lp].map(state)).toEqual(before);expect(lp.leader).toBe(la);expect(lp.carriedMonster).toBe(ld);expect(ld.leader).toBe(lp);
    la.targetCorpseLoc!.x=50;expect(saved.monsters[0]!.targetCorpseLoc!.x).toBe(10);expect(a.targetCorpseLoc!.x).toBe(10);
});

it('test-room baseline restore shares the same exact contract', () => {
    const g=scene(),m=pending(mob());const s=serializeMonster(m);
    const restored=(g as any).createMonsterFromSnapshot(json(s)) as Monster;
    expect(state(restored)).toEqual(state(m));expect(restored.targetCorpseLoc).not.toBe(m.targetCorpseLoc);
});

it('cloneMonster copies all pending values even when placed away from the target; coordinates are values', () => {
    const g=scene(),m=pending(mob());m.isAlly=true;g.monsters=[m];
    const expected=state(m),c=g.cloneMonster(m)!;
    expect(c).not.toBeNull();expect(state(c)).toEqual(expected);expect(c.loc).not.toEqual(m.loc);
    expect(c.targetCorpseLoc).not.toBe(m.targetCorpseLoc);c.targetCorpseLoc!.x=30;expect(state(m)).toEqual(expected);
    const saved=serializeMonster(c);expect(state(restoreEntityGraph([json(saved)]).monsters.get(c.id)!)).toEqual(state(c));
});

it('polymorph preserves creature absorption state while replacing species info', () => {
    const m=pending(mob());const expected=state(m);rng.seedRandomGenerator(10010);
    expect(m.polymorph(()=>{})).toBe(true);expect(m.typeId).not.toBe('rat');expect(state(m)).toEqual(expected);
});

it.each(['ordinary','invulnerable','dies_if_negated'] as const)('negation %s preserves pending task; only surviving noninvulnerable slots are refunded', kind => {
    const g=scene(),m=pending(mob());g.monsters=[m];m.bolts=['FIRE'];
    if(kind==='invulnerable')m.behaviorFlags.add('MONST_INVULNERABLE');
    if(kind==='dies_if_negated')m.behaviorFlags.add('MONST_DIES_IF_NEGATED');
    const expected=state(m);(g as any).negateCreatureMagic(m);
    expect(state(m)).toEqual({...expected,newPowerCount:kind==='ordinary'?4:2});
    if(kind==='dies_if_negated')expect(m.hp).toBe(0);
});

it.each([
    [0,false,false,true], [4,false,false,false], [4,true,false,false], [4,true,true,true], [0,true,false,true], [-2,false,false,false],
] as const)('damage input=%i shield=%s invulnerable=%s keeps absorption=%s', (amount,shield,invulnerable,absorbing) => {
    const m=pending(mob());if(shield)m.applyShield(1000);if(invulnerable)m.behaviorFlags.add('MONST_INVULNERABLE');
    const before=state(m);m.takeDamage(amount);
    expect(state(m)).toEqual({...before,isAbsorbing:absorbing});if(shield&&amount>0)expect(m.hp).toBe(100);
});

it('pre-shielded combat, bypassed poison and lethal damage all interrupt without clearing selection', () => {
    for(const route of ['pre-shield','poison','lethal'] as const){
        const m=pending(mob()),before=state(m);m.applyShield(1000);
        if(route==='pre-shield'){const amount=m.absorbShieldDamage(2);expect(amount).toBe(0);expect(m.isAbsorbing).toBe(false);m.takeDamage(amount,true);}
        if(route==='poison')m.takeDamage(2,true);
        if(route==='lethal')m.takeDamage(100,true);
        expect(state(m)).toEqual({...before,isAbsorbing:false});
    }
});

it.each(['melee','bolt','burning','explosion','vines'] as const)('%s real damage entry interrupts even with a full shield; retains task and slots', route => {
    const g=scene(),m=pending(mob());g.monsters=[m];m.applyShield(10000);const before=state(m);
    if(route==='melee')CombatSystem.attack(g.player,m,{lungeAttack:true});
    if(route==='bolt'){const caster=mob('dragon');caster.loc={x:13,y:8};g.monsters.push(caster);g.castMonsterBolt(caster,m,'FIRE');}
    if(route==='burning'){(m.statusDurations as Record<string,number>).burning=3;(g as any).resolveBurningDamage(m);}
    if(route==='explosion'){g.grid.setTerrain(m.x,m.y,T.GAS_EXPLOSION);(g as any).resolveExplosionDamage(m);}
    if(route==='vines'){g.grid.setTerrain(m.x,m.y,T.ANCIENT_SPIRIT_VINES);(g as any).applyEnvironmentalEffects();}
    expect(state(m)).toEqual({...before,isAbsorbing:false});
    if(['melee','bolt','explosion'].includes(route))expect(m.hp).toBe(100);
});

it('immunity gates do not interrupt on fire/explosion/poison that never reaches inflictDamage', () => {
    const g=scene(),m=pending(mob());g.monsters=[m];m.behaviorFlags.add('MONST_INVULNERABLE');(m.statusDurations as Record<string,number>).burning=3;
    const before=state(m);(g as any).resolveBurningDamage(m);g.grid.setTerrain(m.x,m.y,T.GAS_EXPLOSION);(g as any).resolveExplosionDamage(m);
    expect(state(m)).toEqual(before);
});

it('level-entry reset clears only target position, without RNG or resetting stale bookkeeping', () => {
    const m=pending(mob()),before=state(m),random=JSON.stringify(rng);m.clearCorpseTargetOnLevelChange();
    expect(state(m)).toEqual({...before,targetCorpseLoc:null});expect(JSON.stringify(rng)).toBe(random);
});

it.each([false,true])('fall to queued/cached next layer (cached=%s) clears only position after the separate damage interruption', cached => {
    const g=scene(),m=pending(mob());g.monsters=[m];m.falling=true;m.applyShield(10000);
    if(cached)(g as any).levels.set(g.depth+1,{monsters:[]});
    const before=state(m);(g as any).monstersFall();
    const next=cached?(g as any).levels.get(g.depth+1).monsters:(g as any).pendingFallenByDepth.get(g.depth+1);
    expect(next).toEqual([m]);expect(g.monsters).toEqual([]);expect(m.hp).toBe(100);
    expect(state(m)).toEqual({...before,targetCorpseLoc:null,isAbsorbing:false});
});

it('invulnerable falling survivor retains MB_ABSORBING: transfer itself only clears location', () => {
    const g=scene(),m=pending(mob());g.monsters=[m];m.falling=true;m.behaviorFlags.add('MONST_INVULNERABLE');const before=state(m);
    (g as any).monstersFall();expect(state(m)).toEqual({...before,targetCorpseLoc:null});
});

it('revisited level restores active residents only; JSON loading the same entities does not run restoreMonster', () => {
    const g=scene(),a=pending(mob()),d=pending(mob('kobold')),payload=pending(mob('phoenix'));a.carriedMonster=payload;d.isDormant=true;
    g.monsters=[a];g.dormantMonsters=[d];const expected=[a,d,payload].map(state),snapshot=json(g.toSnapshot());
    g.mode='normal';(g as any).levels.set(2,{grid:g.grid,environment:g.environment,fov:g.fov,lightMap:g.lightMap,
        monsters:g.monsters,dormantMonsters:g.dormantMonsters,items:[],visibleMonsters:new Set(),visibleItems:new Set(),machineCells:new Set()});
    g.depth=2;(g as any).generateDepth(false);
    expect(state(a)).toEqual({...expected[0],isAbsorbing:false,corpseAbsorptionCounter:0});expect(state(d)).toEqual(expected[1]);expect(state(payload)).toEqual(expected[2]);
    expect(g.loadSnapshot(snapshot)).toBe(true);expect(state(g.monsters[0]!)).toEqual(expected[0]);
});

it.each([['default',null,false,0,false],['walking',{x:11,y:8},true,13,false],['eating',{x:10,y:8},true,13,true],
    ['interrupted',{x:10,y:8},false,7,true],['expired',{x:10,y:8},false,0,true]] as const)(
    'detail %s follows CE position equality, without extra counter/MB gates', (_name,loc,absorbing,counter,shown) => {
        const m=mob();m.targetCorpseLoc=loc&&{...loc};m.isAbsorbing=absorbing;m.corpseAbsorptionCounter=counter;
        const rows=generateMonsterDetail(m,30,12,0,null,0,12).sections.flatMap(s=>s.lines).filter(l=>l.progress);
        expect(rows).toHaveLength(shown?1:0);if(shown)expect(rows[0]!.progress).toEqual({value:counter,max:20});
});

it('both actual inspect entry points suppress the bar under hallucination', () => {
    const g=scene(),m=pending(mob());g.monsters=[m];g.player.setStatusDuration('hallucinating',20);
    g.handleInspectAt(m.x,m.y);expect(g.inspectTarget!.sections.flatMap(s=>s.lines).some(l=>l.progress)).toBe(false);
    (g as any).handleExamineNearest();expect(g.inspectTarget!.sections.flatMap(s=>s.lines).some(l=>l.progress)).toBe(false);
    g.player.setStatusDuration('hallucinating',0);g.handleInspectAt(m.x,m.y);
    expect(g.inspectTarget!.sections.flatMap(s=>s.lines).find(l=>l.progress)!.progress).toEqual({value:13,max:20});
});

it('manual task does not countdown/install/spend slots during turns; natural death does not assign a task', () => {
    const g=scene(),m=pending(mob());m.isAlly=true;m.state=MonsterState.HUNTING;m.setStatusDuration('paralyzed',10);g.monsters=[m];
    const before=state(m);for(let i=0;i<3;i++)m.takeTurn(g,0);expect(state(m)).toEqual(before);expect(m.hasBehavior('MONST_FLIES')).toBe(false);
    const dead=mob('dragon');dead.loc={x:11,y:8};dead.hp=0;g.monsters.push(dead);m.targetCorpseLoc=null;m.isAbsorbing=false;const idle=state(m);
    (g as any).removeDeadMonsters();expect(state(m)).toEqual(idle);
});

it('a queued survivor entering a newly generated level retains its counter; it is not a cached resident restore', () => {
    const g=scene(),m=pending(mob());g.monsters=[m];g.mode='normal';m.falling=true;m.behaviorFlags.add('MONST_INVULNERABLE');const before=state(m);
    (g as any).monstersFall();g.depth++;(g as any).generateDepth(false);
    expect(g.monsters).toContain(m);expect(state(m)).toEqual({...before,targetCorpseLoc:null});expect(m.preplaced).toBe(false);
});
