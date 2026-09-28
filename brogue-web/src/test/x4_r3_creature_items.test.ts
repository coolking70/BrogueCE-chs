import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import i18next from 'i18next';
import species from '../data/monsters.json';
import mutations from '../data/mutations.json';
import zhCN from '../locales/zh_CN.json';
import { Monster, MonsterState, type MonsterData, type MutationData } from '../entities/Monster';
import type { StatusId } from '../entities/Creature';
import { Grid, DungeonLayer, TerrainType as T } from '../engine/Map/Grid';
import { DF, DUNGEON_FEATURE_CATALOG } from '../engine/Map/DungeonFeatureCatalog';
import { catalogFeature, setDungeonFeatureEffects } from '../engine/Map/DungeonFeature';
import { creatureBloodFeature, creatureFeatureInfo, creatureFeatureChance, emitCreatureFeature,
    spawnCreatureBlood, PLAYER_BLOOD_TYPE } from '../engine/Combat/CreatureFeatures';
import { isIncendiaryDart, resolveIncendiaryDart } from '../engine/Items/IncendiaryDart';
import { applyAggravationScroll } from '../engine/Items/AggravationScroll';
import { prepareThrownItem } from '../engine/Items/ItemUseCoordinator';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { generateItemDetail } from '../engine/UI/DetailGenerator';
import { rng } from '../engine/Random';
import { logger } from '../engine/Systems/Logger';
import { createHeadlessGame } from './harness';
import { serializeMonster, restoreEntityGraph } from '../engine/Core/EntitySnapshot';

afterEach(() => vi.restoreAllMocks());
const ce = readFileSync(resolve('../BrogueCE-master/src/brogue/Globals.c'), 'utf8');
const header = readFileSync(resolve('../BrogueCE-master/src/brogue/Rogue.h'), 'utf8');
function enumNames(name: string): string[] {
    return header.match(new RegExp(`enum ${name}\\s*\\{([\\s\\S]*?)\\}`))![1]!
        .replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').split(',').map(s => s.trim().split('=')[0]!.trim()).filter(Boolean);
}
function monster(id: string): Monster {
    return new Monster(7, 7, species.find(row => row.id === id)! as MonsterData);
}
function floor(): Grid {
    const grid = new Grid(15, 15);
    for (let x = 0; x < 15; x++) for (let y = 0; y < 15; y++) grid.setTerrain(x, y, T.FLOOR);
    return grid;
}

describe('X4-R3 CE species blood and feature pipeline', () => {
    it('matches all 68 CE catalog rows and real DF enum IDs, including bloodless species', () => {
        const body = ce.split('creatureType monsterCatalog[NUMBER_MONSTER_KINDS] = {')[1]!.split('\n};')[0]!;
        const lines = body.split('\n').filter(line => /^\s*\{0,\s*"/.test(line));
        expect(lines).toHaveLength(68);
        const dfNames = enumNames('dungeonFeatureTypes');
        const dfID = (name: string) => name === '0' ? 0 : dfNames.indexOf(name) + 1;
        for (let i = 0; i < lines.length; i++) {
            const fields = lines[i]!.replace(/\{[^{}]*\}/, 'DAMAGE').split(',').map(s => s.trim());
            const expected = { bloodType: dfID(fields[11]!), DFChance: Number(fields[14]), DFType: dfID(fields[15]!) };
            if (i === 0) { expect(PLAYER_BLOOD_TYPE).toBe(expected.bloodType); continue; }
            const row = species[i - 1]!;
            expect(row.name.toLowerCase()).toBe(fields[1]!.replace(/"/g, '').toLowerCase());
            expect(row).toMatchObject(expected);
            const m = monster(row.id);
            expect({bloodType: m.bloodType, DFChance: m.DFChance, DFType: m.DFType}).toEqual(expected);
        }
        expect(monster('stone_guardian').bloodType).toBe(DF.DF_RUBBLE); // not RUBBLE_BLOOD
    });

    it('truncates both C divisions, caps by pre-hit HP and never mutates the catalog', () => {
        const original = JSON.stringify(DUNGEON_FEATURE_CATALOG);
        expect(creatureBloodFeature(DF.DF_RED_BLOOD, 3, 30)?.startProbability).toBe(19);
        expect(creatureBloodFeature(DF.DF_ACID_BLOOD, 999, 5)?.startProbability).toBe(44);
        expect(creatureBloodFeature(DF.DF_ROT_GAS_BLOOD, 3, 30)?.startProbability).toBe(200);
        expect(creatureBloodFeature(DF.DF_ROT_GAS_BLOOD, 999, 5)?.startProbability).toBe(200);
        for (const [blood, damage, hp, invulnerable] of [[0, 5, 30, false], [23, 0, 30, false],
            [23, -1, 30, false], [23, 5, 0, false], [23, 5, 30, true]] as const) {
            const state = rng.getState();
            expect(spawnCreatureBlood(floor(), {x:7,y:7}, blood, damage, hp, invulnerable)).toBeNull();
            expect(rng.getState()).toEqual(state);
        }
        expect(JSON.stringify(DUNGEON_FEATURE_CATALOG)).toBe(original);
    });

    it('lays each blood family through the real layered DF spread, with damage-dependent coverage', () => {
        for (const bloodType of new Set(species.map(row => row.bloodType).filter(Boolean))) {
            const grid = floor();
            spawnCreatureBlood(grid, {x:7,y:7}, bloodType, 8, 50);
            const expected = catalogFeature(bloodType as DF);
            expect(grid.getCell(7,7)!.layers[expected.layer]).toBe(expected.tile);
            expect(grid.getCell(7,7)!.layers[DungeonLayer.DUNGEON]).toBe(T.FLOOR);
        }
        vi.spyOn(rng, 'randPercent').mockImplementation(p => p >= 50);
        const small = spawnCreatureBlood(floor(), {x:7,y:7}, DF.DF_RED_BLOOD, 1, 100)!;
        const large = spawnCreatureBlood(floor(), {x:7,y:7}, DF.DF_RED_BLOOD, 80, 100)!;
        expect(large.builtCells.length).toBeGreaterThan(small.builtCells.length);
    });

    it('preserves zombie gas after shielding, on lethal hits, and in its objective puff', () => {
        const grid = floor(), zombie = monster('zombie');
        zombie.applyShield(40);
        zombie.takeDamage(3, false, grid);
        expect(grid.getCell(7,7)!.volume).toBe(0);
        zombie.takeDamage(4, false, grid); // remaining 10 shield -> 3 HP
        expect(grid.getCell(7,7)!.volume).toBe(200);
        zombie.hp = 5;
        zombie.takeDamage(100, true, grid);
        expect(zombie.hp).toBe(0);
        expect(grid.getCell(7,7)!.volume).toBe(400);
        const alive = monster('zombie'), random = {randPercent: vi.fn(() => true)};
        emitCreatureFeature(grid, alive, 'objective', random);
        expect(random.randPercent).toHaveBeenCalledExactlyOnceWith(100);
        expect(grid.getCell(7,7)!.volume).toBe(415);
    });

    it.each([
        ['rat', 1, T.URINE], ['jackal', 1, T.URINE], ['monkey', 1, T.URINE],
        ['naga', 100, T.PUDDLE], ['salamander', 100, T.EMBERS],
        ['phantom', 2, T.ECTOPLASM], ['flamedancer', 100, T.FLAMEDANCER_FIRE], ['unicorn', 1, T.UNICORN_POOP],
    ] as const)('%s emits its CE objective feature while asleep/paralyzed/submerged', (id, chance, tile) => {
        const m = monster(id), grid = floor(), random = {randPercent: vi.fn(() => true)};
        m.state = MonsterState.ASLEEP; m.submerged = true; m.applyStatus('paralyzed', 10);
        expect(creatureFeatureChance(m, 'objective')).toBe(chance);
        emitCreatureFeature(grid, m, 'objective', random);
        expect(random.randPercent).toHaveBeenCalledExactlyOnceWith(chance);
        expect(grid.getCell(7,7)!.layers[DungeonLayer.SURFACE]).toBe(tile);
        emitCreatureFeature(grid, m, 'activation', random);
        expect(random.randPercent).toHaveBeenCalledTimes(1);
    });

    it.each(['stone_guardian', 'winged_guardian', 'mirrored_totem'])('%s emits only in activation and uses existing one-time DF messages', id => {
        const m = monster(id), grid = floor(), random = {randPercent: vi.fn(() => true)};
        const describe = vi.fn(() => true);
        setDungeonFeatureEffects(grid, {describe});
        emitCreatureFeature(grid, m, 'objective', random);
        expect(random.randPercent).not.toHaveBeenCalled();
        m.applyStatus('paralyzed', 10);
        emitCreatureFeature(grid, m, 'activation', random);
        emitCreatureFeature(grid, m, 'activation', random);
        expect(random.randPercent).toHaveBeenCalledTimes(2);
        expect(grid.getCell(7,7)!.layers[DungeonLayer.SURFACE]).toBe(T.GUARDIAN_GLOW);
        expect(describe).toHaveBeenCalledTimes(id === 'winged_guardian' ? 0 : 1);
    });

    it('preserves RNG for DF_NONE, skips dormant/dead/zero chance and respects unsuccessful rolls', () => {
        const random = {randPercent: vi.fn(() => true)}, grid = floor();
        for (const id of ['guardian_spirit', 'Warden_of_Yendor']) expect(emitCreatureFeature(grid, monster(id), 'objective', random)).toBeNull();
        expect(random.randPercent).toHaveBeenCalledTimes(2);
        const m = monster('naga'); m.isDormant = true;
        emitCreatureFeature(grid, m, 'objective', random); m.isDormant = false; m.hp = 0;
        emitCreatureFeature(grid, m, 'objective', random);
        emitCreatureFeature(grid, monster('eel'), 'objective', random);
        expect(random.randPercent).toHaveBeenCalledTimes(2);
        expect(emitCreatureFeature(grid, monster('unicorn'), 'objective', {randPercent: () => false})).toBeNull();
        expect(grid.getCell(7,7)!.layers[DungeonLayer.SURFACE]).toBe(T.NOTHING);
    });

    it('derives feature state through mutation, info reset and saved species without adding a timer', () => {
        const m = monster('zombie');
        m.mutate(mutations.find(row => row.id === 'explosive')! as MutationData);
        expect(m.DFChance).toBe(0); expect(m.DFType).toBe(DF.DF_MUTATION_EXPLOSION);
        m.abilityFlags.delete('MA_DF_ON_DEATH'); // negation does not restore info
        expect(m.DFChance).toBe(0);
        m.mutate(mutations.find(row => row.id === 'agile')! as MutationData);
        expect([m.DFChance,m.DFType]).toEqual([0,DF.DF_MUTATION_EXPLOSION]);
        m.deathDFType = 0; expect(m.DFChance).toBe(100); expect(m.DFType).toBe(0);
        delete m.deathDFType; m.mutation = undefined; m.typeId = 'phantom';
        expect([m.bloodType, m.DFChance, m.DFType]).toEqual([DF.DF_ECTOPLASM_BLOOD, 2, DF.DF_ECTOPLASM_DROPLET]);
        expect(creatureFeatureInfo('unrecognized')).toEqual({bloodType:0, DFChance:0, DFType:0});
    });

    it.each(['explosive','infested'])('retains %s DF info through real negation, graph round-trip and resurrection reset', id => {
        const g = createHeadlessGame(73510), m = monster('zombie');
        g.monsters = [m];
        m.mutate(mutations.find(row => row.id === id)! as MutationData);
        const df = m.DFType;
        (g as any).negateCreatureMagic(m);
        expect(m.mutation).toBeUndefined(); expect(m.hasAbility('MA_DF_ON_DEATH')).toBe(false);
        expect([m.DFChance,m.DFType]).toEqual([0,df]);
        const saved = JSON.parse(JSON.stringify(serializeMonster(m))), before = rng.getState();
        const restored = restoreEntityGraph([saved]).monsters.get(m.id)!;
        expect(rng.getState()).toEqual(before);
        expect([restored.bloodType,restored.DFChance,restored.DFType]).toEqual([m.bloodType,0,df]);
        const random={randPercent:vi.fn(() => true)};
        emitCreatureFeature(floor(),restored,'objective',random);
        expect(random.randPercent).not.toHaveBeenCalled();
        const vampire=monster('vampire');
        vampire.mutate(mutations.find(row => row.id === id)! as MutationData);
        vampire.restoreSummonerForm(species.find(row=>row.id==='vampire')! as MonsterData);
        expect(vampire.mutation?.id).toBe(id);
        expect([vampire.bloodType,vampire.DFChance,vampire.DFType]).toEqual([DF.DF_RED_BLOOD,0,DF.DF_BLOOD_EXPLOSION]);
    });
});

describe('X4-R3 incendiary darts and aggravation scroll R6 ports', () => {
    it('burns empty impact cells and consumes exactly the detached unit; ordinary darts decline', () => {
        const game = createHeadlessGame(73401), grid = floor();
        const stack = ItemLoader.spawnWeapon('incendiary_dart', -1, -1)!; stack.quantity = 3;
        game.player.inventory.addItem(stack);
        const thrown = prepareThrownItem(game.player, stack, game.player.loc, false);
        expect(stack.quantity).toBe(2); expect(thrown.quantity).toBe(1);
        const world = {grid, creatureAt: vi.fn(() => undefined), exposeToFire: vi.fn()};
        const state = rng.getState();
        expect(isIncendiaryDart(thrown)).toBe(true);
        expect(resolveIncendiaryDart(thrown, {x:7,y:7}, world)).toBe(true);
        expect(grid.getCell(7,7)!.layers[DungeonLayer.SURFACE]).toBe(T.DART_EXPLOSION);
        expect(rng.getState()).toEqual(state); // no attack/damage/spread roll
        expect(world.exposeToFire).not.toHaveBeenCalled();
        expect(game.player.inventory.items).not.toContain(thrown);
        expect(game.items).not.toContain(thrown);
        expect(resolveIncendiaryDart(ItemLoader.spawnWeapon('dart', 0, 0)!, {x:1,y:1}, world)).toBe(false);
    });

    it('uses real fire exposure after the DF, including immunity, water, submerged and thrower cases', () => {
        const g = createHeadlessGame(73402);
        for (let x = 5; x <= 9; x++) for (let y = 5; y <= 9; y++) g.grid.setTerrain(x,y,T.FLOOR);
        const dart = ItemLoader.spawnWeapon('incendiary_dart', 0, 0)!;
        for (const variant of ['normal', 'immune', 'submerged', 'water', 'levitating', 'player']) {
            g.grid.setTerrain(7,7,T.FLOOR);
            const target = variant === 'player' ? g.player : monster('rat'); target.loc = {x:7,y:7};
            target.setStatusDuration('burning' as StatusId, 0);
            if (variant === 'immune') target.applyStatus('immune_fire', 20);
            if (variant === 'submerged') (target as Monster).submerged = true;
            if (variant === 'water' || variant === 'levitating') g.grid.setTerrain(7,7,T.WATER_SHALLOW);
            if (variant === 'levitating') target.applyStatus('levitating', 20);
            const hp = target.hp;
            expect(resolveIncendiaryDart(dart, {x:7,y:7}, {grid:g.grid,
                creatureAt: () => target, exposeToFire: c => {
                    expect(g.grid.getCell(7,7)!.layers[DungeonLayer.SURFACE]).toBe(T.DART_EXPLOSION);
                    g.exposeCreatureToFire(c as Monster);
                }})).toBe(true);
            expect(target.hasStatus('burning' as StatusId)).toBe(['normal','levitating','player'].includes(variant));
            expect(target.hp).toBe(hp); // no explosive/physical instant damage
        }
    });

    it('registers the missing CE scroll in generation, polarity, metering, names and detail text', () => {
        const row = ItemLoader.genScrolls.find(s => s.id === 'scroll_of_aggravate_monsters')!;
        expect(row).toMatchObject({frequency:15, effect:'aggravate_monsters'});
        expect(ItemLoader.genScrolls).toHaveLength(14);
        const item = ItemLoader.spawnScroll(row.id, 0, 0)!;
        expect(ItemLoader.itemMagicPolarity(item)).toBe(-1);
        expect(zhCN['name.Scroll of Aggravate Monsters']).toBe('激怒怪物卷轴');
        ItemLoader.identifiedItems.add(row.id);
        expect(JSON.stringify(generateItemDetail(item, 12))).toContain('唤醒本层怪物');
        const entries = ItemLoader.CE_METERED_ITEMS_TABLE;
        expect(entries.find(e => e.ceKind === 'SCROLL_AGGRAVATE_MONSTER')).toMatchObject({webId:row.id, initialFrequency:0});
        const variants = readFileSync(resolve('../BrogueCE-master/src/variants/GlobalsBrogue.c'), 'utf8');
        const scrollRows = variants.split('itemTable scrollTable_Brogue[] = {')[1]!.split('\n};')[0]!
            .split('\n').filter(line => /^\s*\{"/.test(line));
        const weights = scrollRows.map(line => Number(line.split(',')[3]!.trim()));
        expect(weights).toHaveLength(14); expect(weights.reduce((sum,n)=>sum+n,0)).toBe(158);
        expect(entries.filter(e=>e.category==='SCROLL').map(e=>ItemLoader.genScrolls.find(s=>s.id===e.webId)!.frequency)).toEqual(weights);
        for (const category of ['SCROLL','POTION'] as const) {
            const names = enumNames(category === 'SCROLL' ? 'scrollKind' : 'potionKind');
            expect(entries.filter(e => e.category === category).map(e => e.ceKind)).toEqual(names);
        }
    });

    it('calls the existing CE alarm at width+height and retains waking, pursuit, scent and player status', () => {
        const g = createHeadlessGame(73403);
        for (let x = 3; x < 12; x++) for (let y = 3; y < 12; y++) g.grid.setTerrain(x,y,T.FLOOR);
        g.player.loc = {x:5,y:5};
        const enemy = monster('goblin'), ally = monster('goblin'); ally.loc={x:8,y:7}; ally.isAlly=true;
        enemy.state=MonsterState.ASLEEP; ally.state=MonsterState.WANDERING;
        enemy.behaviorFlags.add('MONST_MAINTAINS_DISTANCE'); ally.behaviorFlags.add('MONST_MAINTAINS_DISTANCE');
        g.monsters=[enemy,ally];
        const port = vi.fn((radius: number, origin: {x:number;y:number}) => (g as any).aggravateMonsters(radius, origin));
        const log=vi.spyOn(logger,'log');
        applyAggravationScroll({width:g.grid.width,height:g.grid.height,playerLoc:g.player.loc,aggravate:port});
        expect(port).toHaveBeenCalledExactlyOnceWith(g.grid.width+g.grid.height,g.player.loc);
        expect(enemy.state).not.toBe(MonsterState.ASLEEP); expect(ally.state).toBe(MonsterState.WANDERING);
        expect(enemy.behaviorFlags.has('MONST_MAINTAINS_DISTANCE')).toBe(false);
        expect(enemy.abilityFlags.has('MA_AVOID_CORRIDORS')).toBe(false);
        expect(ally.behaviorFlags.has('MONST_MAINTAINS_DISTANCE')).toBe(true);
        expect(g.player.hasStatus('aggravating')).toBe(true);
        expect(g.waypoints.coordinates[0]).toEqual(g.player.loc);
        expect(log).toHaveBeenLastCalledWith(i18next.t('scroll.aggravate', {defaultValue:'the scroll emits a piercing shriek that echoes throughout the dungeon!'}), '#aaaaaa');
    });
});
