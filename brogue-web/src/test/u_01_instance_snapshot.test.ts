import fs from 'node:fs';
import ts from 'typescript';
import { beforeEach, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { Game } from '../engine/Core/Game';
import { ITEM_FIELDS, CREATURE_FIELDS, MONSTER_FIELDS, PLAYER_FIELDS, collectEntityGraph } from '../engine/Core/EntitySnapshot';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { Creature, allocateEntityId, resetEntityIds } from '../entities/Creature';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import { Player } from '../entities/Player';
import { rng } from '../engine/Random';
import { Grid, TerrainType as T, DCOLS, DROWS } from '../engine/Map/Grid';
import { EnvironmentManager } from '../engine/Environment/Gas';
import { FOVSys } from '../engine/Lighting/FOV';
import { LightMap } from '../engine/Lighting/LightMap';
import monsters from '../data/monsters.json';
import mutations from '../data/mutations.json';
import { createHeadlessGame } from './harness';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const data = (id = 'rat') => (monsters as MonsterData[]).find(m => m.id === id)!;
const codec = () => Object.create(Game.prototype) as any;
const registered = {
    Item: [...ITEM_FIELDS],
    Creature: [...CREATURE_FIELDS, 'statusImmunities'],
    Monster: [...MONSTER_FIELDS, 'statusImmunities', 'abilities', 'behaviorFlags', 'abilityFlags',
        'baseMoveSpeed', 'baseAttackSpeed', 'leader', 'carriedItem', 'carriedMonster'],
    Player: [...PLAYER_FIELDS, 'statusImmunities', 'inventory', 'equippedWeapon', 'equippedArmor',
        'ringLeft', 'ringRight', 'hungerTransition'],
};
function declarations(path: string, name: string): string[] {
    const source = ts.createSourceFile(path, fs.readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const node = source.statements.find(s => ts.isClassDeclaration(s) && s.name?.text === name) as ts.ClassDeclaration;
    return node.members.filter(ts.isPropertyDeclaration).filter(n => !n.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword))
        .map(n => n.name.getText(source));
}
// This oracle reads the actual instance, not the serializer's field list.
function ownState(value: any): any {
    if (value instanceof Set) return [...value].map(ownState);
    if (Array.isArray(value)) return value.map(ownState);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k,
        ['leader', 'carriedItem', 'carriedMonster', 'equippedWeapon', 'equippedArmor', 'ringLeft', 'ringRight'].includes(k)
            ? value[k]?.id ?? null : ownState(value[k])]));
}
function graphState(g: Game) {
    const graph = collectEntityGraph([...g.monsters, ...g.dormantMonsters], [...g.items, ...g.player.inventory.items]);
    return { player: ownState(g.player), active: g.monsters.map(m => m.id), dormant: g.dormantMonsters.map(m => m.id),
        ground: g.items.map(i => i.id), monsters: graph.monsters.map(ownState).sort((a,b) => a.id-b.id),
        items: graph.items.map(ownState).sort((a,b) => a.id-b.id) };
}
function scene() {
    const g = createHeadlessGame(4101, 'test');
    g.grid = new Grid(DCOLS, DROWS);
    for (let x=0; x<DCOLS; x++) for (let y=0; y<DROWS; y++) g.grid.setTerrain(x,y,
        x>0 && y>0 && x<DCOLS-1 && y<DROWS-1 ? T.FLOOR : T.WALL);
    g.player = new Player(4,5); g.monsters=[]; g.dormantMonsters=[]; g.items=[];
    g.environment=new EnvironmentManager(g.grid); g.fov=new FOVSys(g.grid); g.lightMap=new LightMap(g.grid);
    g.animationEnabled=false;
    return g;
}
function mob(g: Game, id='rat', x=10, y=5) { const m=new Monster(x,y,data(id)); g.monsters.push(m); return m; }
function rich(m: Monster) {
    m.mutate(json(mutations[0]!));
    Object.assign(m,{ticksUntilTurn:37,machineHome:17,seized:true,seizing:true,spawnLoc:{x:12,y:9},
        givenUpOnScent:true,targetWaypointIndex:2,waypointAlreadyVisited:[false,true,false],safetySnapshot:[[3,7],[8,2]],
        regenCounter:9,poisonAmount:4,maxShield:300,statusDurations:{poisoned:5,shielded:231},
        movementSpeed:37,attackSpeed:43,deathEffectTriggered:true,falling:true,preplaced:true});
    m.statusImmunities.add('confused');m.statusResistTurns={slowed:4};
    return m;
}
beforeEach(() => { vi.restoreAllMocks(); rng.seedRandomGenerator(4101); });

it('field coverage: declarations (including private/optional) AND runtime own fields are all registered', () => {
    const files = { Item:'src/engine/Items/Item.ts', Creature:'src/entities/Creature.ts', Monster:'src/entities/Monster.ts', Player:'src/entities/Player.ts' };
    for (const name of Object.keys(files) as (keyof typeof files)[]) {
        const fields = declarations(files[name],name);
        const all = name==='Monster'||name==='Player' ? [...declarations(files.Creature,'Creature'),...fields] : fields;
        expect([...registered[name]].sort(),name).toEqual(all.sort());
    }
    const entities = {Item:ItemLoader.spawnStaff('staff_of_fire',0,0)!,Creature:new Creature(0,0,'c','c',1),Monster:rich(new Monster(0,0,data())),Player:new Player(0,0)};
    for (const name of Object.keys(entities) as (keyof typeof entities)[]) {
        expect(Object.keys(entities[name]).filter(k => !(registered[name] as readonly string[]).includes(k)),name).toEqual([]);
    }
    // An undeclared dynamically installed field also fails the own-field audit.
    Object.assign(entities.Monster,{unregisteredFutureField:1});
    expect(Object.keys(entities.Monster).filter(k => !(registered.Monster as readonly string[]).includes(k))).toEqual(['unregisteredFutureField']);
});

it('every declared Item value, nested key binding, flags and absent/false/zero values round-trip without aliasing or RNG', () => {
    const g=codec();
    const item=ItemLoader.spawnWeapon('spear',2,3)!;
    Object.assign(item,{quiverNumber:771,vorpalEnemy:'ogre',originDepth:4,keyLoc:[{loc:{x:7,y:8},machine:17,disposableHere:false}],
        description:'instance text',charges:0,timesUsed:0,identified:undefined,staffRechargeRemaining:-20});
    const before=ownState(item), random=JSON.stringify(rng),saved=g.serializeItem(reactive(item));
    const restored=g.deserializeItem(json(saved));
    expect(ownState(restored)).toEqual(before);expect(JSON.stringify(rng)).toBe(random);
    restored.flags.push('changed');restored.keyLoc[0].loc.x=99;
    expect(ownState(item)).toEqual(before);expect(saved.keyLoc[0].loc.x).toBe(7);
});

it.each(['ordinary','polymorph','clone','dormant','player clone'] as const)('%s uses the complete graph contract, including private base speeds', kind => {
    const g=scene();let m=rich(mob(g));
    if(kind==='polymorph') { m.polymorph(()=>{});m.ticksUntilTurn=37; }
    if(kind==='clone') m=g.cloneMonster(m)!;
    if(kind==='player clone') m=g.cloneMonster(g.player)!;
    if(kind==='dormant') g.toggleMonsterDormancy(m);
    const payload=rich(new Monster(0,0,data('phoenix'))), key=ItemLoader.spawnKey('iron_key',-1,-1)!;
    key.id=900000;key.originDepth=g.depth;key.keyLoc=[{loc:{x:5,y:5},machine:17,disposableHere:false}];
    m.carriedMonster=payload;payload.leader=m;payload.carriedMonster=m;m.carriedItem=key;payload.carriedItem=key;
    const peer=mob(g,'kobold',20,10);peer.leader=payload;m.leader=peer;g.items.push(key); // shared identity, no ownership repair (U05a)
    g.player.statusImmunities.add('confused');g.player.seized=true;g.player.seizing=true;g.player.ticksUntilTurn=29;
    g.player.nutrition=151;g.player.tickNutrition();g.player.regenCarry=.67;g.player.inventory.capacity=31;
    const before=graphState(g), saved=json(g.toSnapshot());
    expect(g.loadSnapshot(saved)).toBe(true);expect(graphState(g)).toEqual(before);
    const restored=[...g.monsters,...g.dormantMonsters].find(v=>v.id===m.id)!;
    expect(restored.carriedMonster!.carriedMonster).toBe(restored);
    expect(restored.carriedItem).toBe(restored.carriedMonster!.carriedItem);expect(restored.carriedItem).toBe(g.items[0]);
    expect(allocateEntityId()).toBeGreaterThan(900000);
    restored.refreshSpeeds();m.refreshSpeeds();expect([restored.moveSpeed,restored.attackSpeed]).toEqual([m.moveSpeed,m.attackSpeed]);
    restored.carriedMonster!.safetySnapshot![0]![0]=999;expect(payload.safetySnapshot![0]![0]).toBe(3);
});

it('naturally generated D1-D3 ordinary/ground/pack entities deeply round-trip, without deriving from catalog', () => {
    const g=createHeadlessGame(424242);let count=0;
    for (let depth=1;depth<=3;depth++) {
        if(depth>1){g.depth=depth;(g as any).generateDepth(false,false);}
        count+=g.monsters.length+g.items.length;
        const before=graphState(g);expect(g.loadSnapshot(json(g.toSnapshot()))).toBe(true);expect(graphState(g)).toEqual(before);
    }
    expect(count).toBeGreaterThan(10);
});

it('standalone/test-room graph codec preserves cycles, null/undefined and zero RNG/ID allocation', () => {
    const g=codec(), m=rich(new Monster(0,0,data())), p=new Monster(2,2,data('kobold'));
    m.carriedMonster=p;p.leader=m;m.leader=p;
    const before=JSON.stringify(rng), nextId=allocateEntityId();const saved=json(g.serializeMonster(m));
    const restored=g.createMonsterFromSnapshot(saved) as Monster;
    expect(ownState(restored)).toEqual(ownState(m));expect(restored.carriedMonster!.leader).toBe(restored);
    expect(JSON.stringify(rng)).toBe(before);expect(allocateEntityId()).toBe(nextId+1);
});

it.each(['spear','rapier'])('%s next attack keeps penetration/lunge, damage and action cost', weapon => {
    const g=scene(), item=ItemLoader.spawnWeapon(weapon,-1,-1)!;
    item.enchantment=0;item.runicType=undefined;g.player.strength=item.strengthRequired!;
    g.player.inventory.items=[item];g.player.equip(item);
    const a=mob(g,'rat',weapon==='rapier'?6:5,5), b=mob(g,'rat',6,5);
    if(weapon==='rapier') b.loc={x:8,y:8};
    for(const m of [a,b]){m.hp=m.maxHp=200;m.state=MonsterState.ASLEEP;m.ticksUntilTurn=10000;}
    const saved=json(g.toSnapshot());
    const act=()=>{rng.seedRandomGenerator(73);g.handlePlayerAction('move',{x:1,y:0});return {graph:graphState(g),gate:g.ticksTillUpdateEnvironment};};
    const next=act();expect(a.hp).toBeLessThan(200);if(weapon==='spear')expect(b.hp).toBeLessThan(200);
    expect(g.loadSnapshot(saved)).toBe(true);expect(act()).toEqual(next);
});

it.each([false,true])('next unlock preserves disposableHere=%s and origin-depth rejection', disposable => {
    const g=scene(),key=ItemLoader.spawnKey('iron_key',-1,-1)!;
    key.originDepth=g.depth;key.keyLoc=[{loc:{x:5,y:5},machine:17,disposableHere:disposable}];
    g.player.inventory.items=[key];g.grid.setTerrain(5,5,T.LOCKED_DOOR);g.grid.getCell(5,5)!.machineNumber=17;
    const saved=json(g.toSnapshot());
    const act=()=>{rng.seedRandomGenerator(73);g.handlePlayerAction('move',{x:1,y:0});return {graph:graphState(g),layers:[...g.grid.getCell(5,5)!.layers]};};
    const next=act();expect(g.player.inventory.items.includes(key)).toBe(!disposable);expect(next.layers).not.toContain(T.LOCKED_DOOR);
    g.loadSnapshot(saved);expect(act()).toEqual(next);
    saved.player.inventory[0]!.originDepth=g.depth+1;g.loadSnapshot(saved);act();expect(g.grid.getCell(5,5)!.layers).toContain(T.LOCKED_DOOR);
});

it('next scheduler action retains 37 tick wait; dormant carrier never acts; next death drops the same payload once', () => {
    const g=scene(), m=mob(g,'rat',10,5), d=mob(g,'rat',15,5);
    m.state=MonsterState.HUNTING;m.ticksUntilTurn=37;g.toggleMonsterDormancy(d);
    m.carriedItem=ItemLoader.spawnWeapon('spear',-1,-1)!;
    g.player.applyStatus('hasted',50);g.player.lastMoveDirection=null;
    const saved=json(g.toSnapshot());
    const act=()=>{rng.seedRandomGenerator(73);g.handlePlayerAction('wait');return graphState(g);};
    const next=act();expect(m.ticksUntilTurn).toBe(87);expect(d.loc).toEqual({x:15,y:5});
    g.loadSnapshot(saved);expect(act()).toEqual(next);
    const current=json(g.toSnapshot());
    const die=()=>{g.monsters[0]!.hp=0;(g as any).removeDeadMonsters();(g as any).removeDeadMonsters();return graphState(g);};
    const dropped=die();expect(g.items).toHaveLength(1);g.loadSnapshot(current);expect(die()).toEqual(dropped);
});

it('player hunger event, cached speeds, direction, status immunity and inventory/equipment identity survive the next consumers', () => {
    const g=scene();g.player.nutrition=151;g.player.tickNutrition();g.player.seized=g.player.seizing=true;
    g.player.movementSpeed=37;g.player.attackSpeed=43;g.player.statusImmunities.add('confused');
    g.player.lastMoveDirection=3;const item=ItemLoader.spawnWeapon('rapier',-1,-1)!;g.player.inventory.items=[item];g.player.equip(item);
    const before=ownState(g.player), saved=json(g.toSnapshot());g.loadSnapshot(saved);expect(ownState(g.player)).toEqual(before);
    expect(g.player.consumeHungerTransition()).toBe('weak');expect(g.player.consumeHungerTransition()).toBeNull();
    expect(g.player.equippedWeapon).toBe(g.player.inventory.items[0]);g.player.applyStatus('confused',5);expect(g.player.hasStatus('confused')).toBe(false);
});

it('version boundary rejects v1 before changing the live world; detached/player high IDs are reserved', () => {
    const g=scene();g.player.id=1900000;const m=mob(g);m.carriedMonster=new Monster(0,0,data());m.carriedMonster.id=2100000;
    const saved=json(g.toSnapshot()),before=graphState(g);expect(g.loadSnapshot({...saved,version:1})).toBe(false);expect(graphState(g)).toEqual(before);
    resetEntityIds();g.loadSnapshot(saved);expect(allocateEntityId()).toBeGreaterThan(2100000);
});


it('all natural ItemLoader categories preserve their entire instance shape', () => {
    const g=codec();
    for(const [table,spawn] of [
        ['weapons','spawnWeapon'],['armors','spawnArmor'],['wands','spawnWand'],['staffs','spawnStaff'],
        ['rings','spawnRing'],['charms','spawnCharm'],['keys','spawnKey'],
        ['potions','spawnPotion'],['scrolls','spawnScroll'],['food','spawnFood'],
    ]) {
        const rows=(ItemLoader as any)[table!];expect(rows.length,table).toBeGreaterThan(0);
        for(const row of rows) {
            const item=(ItemLoader as any)[spawn!](row.id,2,3);expect(item,row.id).toBeTruthy();
            expect(Object.keys(item).filter(k => !(registered.Item as readonly string[]).includes(k))).toEqual([]);
            expect(ownState(g.deserializeItem(json(g.serializeItem(item))))).toEqual(ownState(item));
        }
    }
});
