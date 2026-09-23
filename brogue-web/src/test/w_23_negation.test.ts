import fs from 'node:fs';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../engine/Core/Game';
import { Grid, TerrainType as T, DCOLS, DROWS } from '../engine/Map/Grid';
import { EnvironmentManager } from '../engine/Environment/Gas';
import { FOVSys } from '../engine/Lighting/FOV';
import { LightMap } from '../engine/Lighting/LightMap';
import { Monster, MonsterState, specificallyValidBoltTarget, type MonsterData } from '../entities/Monster';
import { Player } from '../entities/Player';
import type { Creature, StatusId } from '../entities/Creature';
import { NEGATABLE_TRAITS, NON_NEGATABLE_ABILITIES, negationWillAffectMonster, negateBolts } from '../engine/Combat/Negation';
import { BoltEffect, type BoltConfig } from '../engine/Combat/Bolt';
import { CE_BOLT_CATALOG, CEBoltType, CEBoltFlags } from '../engine/Combat/BoltCatalog';
import { arcanaTargetCandidates } from '../engine/Combat/BoltTargeting';
import { Item, ItemCategory } from '../engine/Items/Item';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { generateMonsterDetail } from '../engine/UI/DetailGenerator';
import { rng } from '../engine/Random';
import { logger } from '../engine/Systems/Logger';
import monsters from '../data/monsters.json';
import mutations from '../data/mutations.json';
import { createHeadlessGame } from './harness';
const data = (id: string) => (monsters as MonsterData[]).find(d => d.id === id)!;
function install(g: Game) {
    g.grid = new Grid(DCOLS, DROWS);
    for (let x = 0; x < DCOLS; x++) for (let y = 0; y < DROWS; y++) {
        g.grid.setTerrain(x, y, x > 0 && x < DCOLS - 1 && y > 0 && y < DROWS - 1 ? T.FLOOR : T.WALL);
        Object.assign(g.grid.getCell(x, y)!, { isVisible: true, hasMemory: true, isDiscovered: true });
    }
    g.player = new Player(4, 5); g.monsters = []; g.dormantMonsters = []; g.items = [];
    g.environment = new EnvironmentManager(g.grid); g.fov = new FOVSys(g.grid); g.lightMap = new LightMap(g.grid);
    g.spawnFloatingText = vi.fn(); g.stats = { kills: 0, gold: 0, turns: 0, maxDepth: 1 };
    return g;
}
const scene = () => { const g = install(Object.create(Game.prototype)); (g as any).updateVision = vi.fn(); return g; };
const live = () => install(createHeadlessGame(2323, 'test'));
function mob(g: Game, id = 'rat', x = 9, y = 5) {
    const m = new Monster(x, y, data(id)); m.state = MonsterState.HUNTING; m.ticksUntilTurn = 100000; g.monsters.push(m); return m;
}
const negate = (g: Game, c: Creature): boolean => (g as any).negateCreatureMagic(c);
const bolt: BoltConfig = { id: 'test_negation', name: 'negation', ceType: CEBoltType.NEGATION, effect: BoltEffect.NEGATION,
    magnitude: 10, char: '*', color: 0xff88cc, maxRange: 0, piercing: false, selfTargeting: false };
const wand = () => Object.assign(new Item('explicit negation', '/', 0xff88cc, ItemCategory.WAND), { identityId: 'wand_of_negation', charges: 2 });
const cast = (g: Game, m: Creature) => g.zapBoltFromPlayer(bolt, wand(), m.loc);
const statuses = { weakened: 2, telepathy: 3, hallucinating: 4, levitating: 5, slowed: 6, hasted: 7, confused: 8,
    burning: 9, paralyzed: 10, poisoned: 11, discordant: 14, immune_fire: 15, entranced: 21, shielded: 24, invisible: 25 };
beforeEach(() => { if (!i18next.isInitialized) i18next.init({ lng: 'en', resources: {}, initImmediate: false }); vi.restoreAllMocks(); rng.seedRandomGenerator(2323); ItemLoader.identifiedItems.clear(); logger.messages = []; });

describe('W-23 separate CE eligibility and actual effect contracts', () => {
    it.each([false, true])('matches original compiled CE status rows (player=%s)', player => {
        const rows = fs.readFileSync('ai_docs/reports/w-23-evidence/ce-negation.txt', 'utf8').split('\n').filter(s => s.startsWith(`status ${+player} `));
        const g = scene();
        for (const [id, index] of Object.entries(statuses)) for (const duration of [1, 7]) {
            const expected = rows.find(s => s.startsWith(`status ${+player} ${index} ${duration} `))!.split(' ').slice(1).map(Number);
            const m = mob(g); g.player.statusDurations = {}; const c = player ? g.player : m;
            c.setStatusDuration(id as StatusId, duration);
            if (!player) expect(negationWillAffectMonster(m), id).toBe(!!expected[3]);
            expect(negate(g, c), id).toBe(!!expected[4]);
            expect(c.getStatusDuration(id as StatusId), id).toBe(expected[5]);
            if (!player) expect(m.wasNegated, id).toBe(false);
        }
    });
    it.each(['telepathy', 'hallucinating'] as const)('%s is not eligible for known auto-target but DOES autoID on manual hit', status => {
        const g = scene(), m = mob(g), item = wand(); m.setStatusDuration(status, 9);
        expect(negationWillAffectMonster(m)).toBe(false); ItemLoader.identifiedItems.add('wand_of_negation');
        expect(arcanaTargetCandidates(g.player, g.grid, g.monsters, item)).toEqual([]);
        ItemLoader.identifiedItems.clear(); expect(arcanaTargetCandidates(g.player, g.grid, g.monsters, item)).toEqual([m]);
        expect(cast(g, m).outcome?.autoID).toBe(true); expect(m.hasStatus(status)).toBe(false);
    });
    it('plain target is unchanged, returns false and emits no stripped message; count reset alone is not an effect', () => {
        const g = scene(), m = mob(g); m.totalPowerCount = 3;
        expect(cast(g, m).outcome?.autoID).toBe(false); expect(m.newPowerCount).toBe(3); expect(m.wasNegated).toBe(false);
        expect(logger.messages).toEqual([]);
    });
    it('autoID uses visibility after clearing invisibility; hidden offscreen remains unobserved', () => {
        const g = scene(), m = mob(g, 'phantom'); expect(cast(g, m).outcome?.autoID).toBe(true);
        expect(m.hasBehavior('MONST_INVISIBLE')).toBe(false); m.bolts = ['SPARK']; g.grid.getCell(m.x, m.y)!.isVisible = false;
        expect(cast(g, m).outcome?.autoID).toBe(false); expect(m.bolts).toEqual([]);
    });
    it('poison dose, paralysis, weakness, ordinary burning and web regeneration survive; shield and magical states clear', () => {
        const g = scene(), m = mob(g); m.statusDurations = { poisoned: 9, paralyzed: 8, weakened: 7, regenerating: 6, discordant: 4, entranced: 3, hasted: 2 };
        (m.statusDurations as any).burning = 5; (m.statusDurations as any).explosion_immunity = 5; m.poisonAmount = 4; m.applyShield(130);
        negate(g, m); expect(m.statusDurations).toEqual({ poisoned: 9, paralyzed: 8, weakened: 7, regenerating: 6, burning: 5, explosion_immunity: 5 });
        expect(m.poisonAmount).toBe(4); expect(m.maxShield).toBe(0); expect(m.wasNegated).toBe(false);
    });
    it('player one-turn safety lasts until the normal expiry tick; negation does not create absent protection', () => {
        const g = scene(); for (const id of ['telepathy', 'levitating', 'immune_fire'] as const) g.player.setStatusDuration(id, 8);
        g.grid.setTerrain(4, 5, T.CHASM); negate(g, g.player); expect((g as any).playerFalling).not.toBe(true);
        expect(g.player.statusDurations).toEqual({ telepathy: 1, levitating: 1, immune_fire: 1 });
        g.player.tickStatuses(); (g as any).applyEnvironmentalEffects(g.player); expect((g as any).playerFalling).toBe(true);
    });
});

describe('W-23 flag/mutation/bolt stripping and CE branch ordering', () => {
    it.each([...NEGATABLE_TRAITS])('permanently removes %s with wasNegated', flag => {
        const g = scene(), m = mob(g); m.behaviorFlags.add(flag); m.behaviorFlags.add('MONST_NEVER_SLEEPS');
        expect(negate(g, m)).toBe(true); expect(m.hasBehavior(flag)).toBe(false); expect(m.hasBehavior('MONST_NEVER_SLEEPS')).toBe(true); expect(m.wasNegated).toBe(true);
    });
    it('retains four physical geometry abilities, removes all other MA flags including death DF before death', () => {
        const g = scene(), m = mob(g); m.abilityFlags = new Set([...NON_NEGATABLE_ABILITIES, 'MA_SEIZES', 'MA_DF_ON_DEATH', 'MA_REFLECT_100', 'MA_CAST_SUMMON']);
        m.seizing = m.seized = true; negate(g, m); expect([...m.abilityFlags]).toEqual([...NON_NEGATABLE_ABILITIES]);
        expect(m.seizing).toBe(false); expect(m.seized).toBe(true); expect(m.wasNegated).toBe(true);
        m.abilityFlags.add('MA_DF_ON_DEATH'); m.behaviorFlags.add('MONST_DIES_IF_NEGATED'); negate(g, m); expect(m.hasAbility('MA_DF_ON_DEATH')).toBe(false); expect(m.hp).toBe(0);
    });
    it('invulnerability rejects automatic targets but direct negate still removes abilities/grip before its gate', () => {
        const g = scene(), m = mob(g, 'Warden_of_Yendor'); m.abilityFlags.add('MA_SEIZES'); m.setStatusDuration('hasted', 10); m.seizing = true; m.totalPowerCount = 4;
        expect(negationWillAffectMonster(m, false)).toBe(false); expect(negate(g, m)).toBe(true);
        expect(m.hasAbility('MA_SEIZES')).toBe(false); expect(m.seizing).toBe(false); expect(m.hasStatus('hasted')).toBe(true); expect(m.newPowerCount).toBe(0);
    });
    it('reflect-all only excludes bolt eligibility; blast kills it and reflected beam negates the player', () => {
        const g = scene(), m = mob(g, 'stone_guardian'); expect(negationWillAffectMonster(m, true)).toBe(false); expect(negationWillAffectMonster(m, false)).toBe(true);
        g.player.addPoison(8, 3); g.player.setStatusDuration('hasted', 8); const r = cast(g, m);
        expect(r.reflections.length).toBeGreaterThan(0); expect(g.player.hasStatus('hasted')).toBe(false); expect(g.player.poisonAmount).toBe(3); expect(m.hp).toBe(m.maxHp);
        (g as any).negationBlastFromPlayer('scroll'); expect(m.hp).toBe(0);
    });
    it.each(mutations.map(m => m.id))('mutation %s: clear only CE-negatable identity, never reverse numeric changes', id => {
        const g = scene(), m = mob(g); m.mutate(structuredClone(mutations.find(v => v.id === id)!));
        const before = [m.maxHp, m.hp, m.moveSpeed, m.attackSpeed, m.damageString, m.defense, m.accuracy];
        negate(g, m); expect([m.maxHp, m.hp, m.moveSpeed, m.attackSpeed, m.damageString, m.defense, m.accuracy]).toEqual(before);
        expect(!!m.mutation).toBe(['agile', 'juggernaut'].includes(id));
    });
    it('all shipped bolts, including arrows/darts/web/vines/blink, are negatable regardless of learnability', () => {
        expect(Object.values(CE_BOLT_CATALOG).filter(b => b.flags & CEBoltFlags.NOT_NEGATABLE)).toEqual([]);
        const g = scene(), m = mob(g, 'centaur'); m.bolts = ['DISTANCE_ATTACK', 'POISON_DART', 'SPIDERWEB', 'ANCIENT_SPIRIT_VINES', 'BLINKING'];
        expect(negationWillAffectMonster(m)).toBe(true); negate(g, m); expect(m.bolts).toEqual([]); expect(m.wasNegated).toBe(true);
    });
    it('synthetic non-negatable bolts follow backup sentinel and CE surviving-tail behavior, restoring catalog afterwards', () => {
        const whip = CE_BOLT_CATALOG[CEBoltType.WHIP], arrow = CE_BOLT_CATALOG[CEBoltType.DISTANCE_ATTACK];
        const wf = whip.flags, af = arrow.flags;
        try {
            (whip as any).flags |= CEBoltFlags.NOT_NEGATABLE; (arrow as any).flags |= CEBoltFlags.NOT_NEGATABLE;
            expect(negateBolts(['NEGATION', 'WHIP', 'DISTANCE_ATTACK'])).toEqual(['WHIP', 'DISTANCE_ATTACK', 'DISTANCE_ATTACK']);
            expect(negateBolts(['NEGATION', 'NONE', 'WHIP'])).toEqual([]);
            expect(negateBolts(Array(21).fill('WHIP'))).toHaveLength(20);
        } finally { (whip as any).flags = wf; (arrow as any).flags = af; }
    });
    it('speed-only and grip-only effects do not set wasNegated; learned count restoration is inside living/non-invulnerable branch', () => {
        const g = scene(), m = mob(g); m.moveSpeed = 20; m.seizing = true; m.totalPowerCount = 4;
        expect(negate(g, m)).toBe(true); expect(m.moveSpeed).toBe(100); expect(m.seizing).toBe(false); expect(m.wasNegated).toBe(false); expect(m.newPowerCount).toBe(4);
    });
    it.each(['air', 'inanimate', 'living'])('die-if-negated %s message, bypass shield and skip states/counts/tile', kind => {
        const g = scene(), m = mob(g); m.behaviorFlags.add('MONST_DIES_IF_NEGATED'); if (kind === 'air') m.setStatusDuration('levitating', 1000); if (kind === 'inanimate') m.behaviorFlags.add('MONST_INANIMATE');
        m.applyShield(5000); m.totalPowerCount = 5; const tile = vi.spyOn(g as any, 'applyEnvironmentalEffects');
        expect(negate(g, m)).toBe(true); expect(m.hp).toBe(0); expect(m.maxShield).toBe(5000); expect(m.newPowerCount).toBe(0); expect(m.wasNegated).toBe(false); expect(tile).not.toHaveBeenCalled();
        expect(logger.messages[logger.messages.length - 1]?.text).toContain(kind === 'air' ? 'dissipates' : kind === 'inanimate' ? 'shatters' : 'lifeless');
    });
});

describe('W-23 live consumers and persistence', () => {
    it.each([T.LAVA, T.CHASM])('loss of flight immediately evaluates terrain %s without waiting', tile => {
        const g = scene(), m = mob(g, 'vampire_bat'); g.grid.setTerrain(m.x, m.y, tile); negate(g, m);
        expect(m.hasStatus('levitating')).toBe(false); expect(m.hasBehavior('MONST_FLIES')).toBe(false);
        if (tile === T.LAVA) expect(m.hp).toBe(0); else expect(m.falling).toBe(true);
    });
    it('fiery trait removal extinguishes, but no automatic rederivation; repeated negation stays inert', () => {
        const g = scene(), m = mob(g); m.behaviorFlags.add('MONST_FIERY'); (m.statusDurations as any).burning = 1000;
        negate(g, m); expect(m.getStatusDuration('burning' as StatusId)).toBe(0); m.tickStatuses(); expect(negate(g, m)).toBe(false);
    });
    it('AI selects weapon-immune or magical enemies and terrain vulnerabilities, cures discordant actual teammates', () => {
        const g = scene(), caster = mob(g, 'dar_priestess', 6), m = mob(g, 'rat'); m.isAlly = true;
        expect(specificallyValidBoltTarget(caster, m, 'NEGATION', g)).toBe(false); m.behaviorFlags.add('MONST_IMMUNE_TO_WEAPONS');
        expect(specificallyValidBoltTarget(caster, m, 'NEGATION', g)).toBe(true); g.castMonsterBolt(caster, m, 'NEGATION'); expect(m.isImmuneToWeapons()).toBe(false);
        m.setStatusDuration('levitating', 5); g.grid.setTerrain(m.x, m.y, T.WATER_DEEP); expect(specificallyValidBoltTarget(caster, m, 'NEGATION', g)).toBe(true);
        g.grid.setTerrain(m.x, m.y, T.FLOOR); m.statusDurations = { discordant: 9 }; caster.isAlly = true;
        expect(specificallyValidBoltTarget(caster, m, 'NEGATION', g)).toBe(true); g.castMonsterBolt(caster, m, 'NEGATION'); expect(m.hasStatus('discordant')).toBe(false);
    });
    it('real scroll entry preserves poison, removes caster bolts and traits, and does not undo domination/empowerment', () => {
        const g = live(), m = mob(g, 'dar_priestess'); m.isAlly = true; m.dominated = true; m.empower(); m.newPowerCount = 0; m.addPoison(9, 2); m.setStatusDuration('entranced', 8);
        const hp = m.maxHp; const scroll = ItemLoader.spawnScroll('scroll_of_negation', -1, -1)!;
        g.player.inventory.addItem(scroll); g.readItem(scroll); expect(g.player.inventory.items).not.toContain(scroll);
        expect(m.bolts).toEqual([]); expect(m.dominated && m.isAlly).toBe(true); expect(m.maxHp).toBe(hp); expect(m.poisonAmount).toBe(2); expect(m.hasStatus('entranced')).toBe(false); expect(m.newPowerCount).toBe(1);
    });
    it('active/dormant JSON, reset, clone and old saves preserve stripping and mutation removal without rebuilding species', () => {
        const g = live(), m = mob(g, 'dar_priestess'); m.mutate(structuredClone(mutations[0]!)); m.empower(); negate(g, m);
        const c = g.cloneMonster(m)!; c.isDormant = true; g.monsters = [m]; g.dormantMonsters = [c];
        const saved = JSON.parse(JSON.stringify(g.toSnapshot())); expect(g.loadSnapshot(saved)).toBe(true);
        for (const v of [g.monsters[0]!, g.dormantMonsters[0]!, (g as any).createMonsterFromSnapshot(saved.monsters[0])]) {
            expect(v.wasNegated).toBe(true); expect(v.bolts).toEqual([]); expect(v.mutation).toBeUndefined(); expect(v.newPowerCount).toBe(1); expect(v.hasAbility('MA_DF_ON_DEATH')).toBe(false);
        }
        delete saved.monsters[0].wasNegated; delete saved.monsters[0].newPowerCount; delete saved.monsters[0].totalPowerCount;
        g.loadSnapshot(saved); expect(g.monsters[0]!.wasNegated).toBe(false); expect(g.monsters[0]!.newPowerCount).toBe(0); expect(g.monsters[0]!.bolts).toEqual([]);
    });
    it('description reads wasNegated AND count equality; polymorph clears it and clone copies it', () => {
        const g = scene(), m = mob(g, 'dar_priestess'); negate(g, m); expect(m.copyForClone().wasNegated).toBe(true);
        const detail = () => generateMonsterDetail(m, 30, 12, 0, null, 0, 12).sections.flatMap(s => s.lines.map(l => l.text)).join('\n');
        expect(detail()).toContain('特殊能力已被消除'); m.totalPowerCount = 1; expect(detail()).not.toContain('特殊能力已被消除');
        m.polymorph(() => {}); expect(m.wasNegated).toBe(false);
    });
    it('plain-floor negation has no RNG; no negation item added to generation', () => {
        const g = scene(), m = mob(g, 'dar_priestess'), before = rng.randomNumbersGenerated; negate(g, m); expect(rng.randomNumbersGenerated).toBe(before);
        expect(ItemLoader.spawnWand('wand_of_negation', -1, -1)).toBeNull();
    });
});
