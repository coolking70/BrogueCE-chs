import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import i18next from 'i18next';
import zhCN from '../locales/zh_CN.json';
import { Game } from '../engine/Core/Game';
import { ItemCategory as C } from '../engine/Items/Item';
import { ItemLoader } from '../engine/Items/ItemLoader';
import * as charm from '../engine/Items/CharmModel';
import { enchantArcana } from '../engine/Items/ArcanaEnchantment';
import { serializeItem, deserializeItem } from '../engine/Core/EntitySnapshot';
import { TerrainType as T, DungeonLayer as L } from '../engine/Map/Grid';
import { Monster, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { generateItemDetail } from '../engine/UI/DetailGenerator';
import { getDiscoveries } from '../engine/UI/Discoveries';
import { teleportCandidates } from '../engine/Movement/CreaturePlacement';
import { timeSystem } from '../engine/Systems/Time';
import { rng } from '../engine/Random';
import { createHeadlessGame } from './harness';

const ids = ['levitation', 'shattering', 'guardian', 'teleportation', 'recharging', 'negation'].map(k => `charm_of_${k}`);
const oracle = JSON.parse(fs.readFileSync(new URL('../../ai_docs/reports/x2e-evidence/ce-oracle.json', import.meta.url), 'utf8'));
type Kind = Parameters<typeof charm.charmRechargeDelay>[0];
afterEach(() => vi.restoreAllMocks());

function scene() {
    const g = createHeadlessGame(20260927, 'test');
    g.monsters = []; g.dormantMonsters = []; g.items = [];
    g.grid.impregnableCells.clear();
    for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
        g.grid.setTerrain(x, y, T.FLOOR);
        Object.assign(g.grid.getCell(x, y)!, { machineNumber: 0, hasDormantMonster: false, isPowered: false });
    }
    g.player.loc = { x: 10, y: 10 };
    g.player.inventory.items = [];
    g.animationEnabled = false;
    return g;
}
function give(g: Game, id: string, enchant = 1) {
    const item = ItemLoader.spawnCharm(id, -1, -1)!;
    expect(item).not.toBeNull();
    item.enchantment = enchant;
    g.player.inventory.addItem(item);
    return item;
}
function addMonster(g: Game, id: string, x: number, y: number) {
    const m = new Monster(x, y, (monsters as MonsterData[]).find(m => m.id === id)!);
    m.ticksUntilTurn = 10000;
    g.monsters.push(m);
    return m;
}

describe('X2e CE charm formulas and complete instances', () => {
    it('matches 624 compiled original C cases, including clamp and signed-short boundaries', () => {
        expect(oracle.cases).toHaveLength(624);
        for (const row of oracle.cases) {
            const id = row.id as Kind, e = row.enchant;
            expect(charm.isCharmKind(id), id).toBe(true);
            expect(charm.charmEffectDuration(id, e), `${id}/E${e}/duration`).toBe(row.duration);
            expect(charm.charmRechargeDelay(id, e), `${id}/E${e}/recharge`).toBe(row.recharge);
            const magnitude = id === 'charm_of_health' ? charm.charmHealing(e)
                : id === 'charm_of_protection' ? charm.charmProtection(e)
                : id === 'charm_of_shattering' ? charm.charmShattering(e)
                : id === 'charm_of_guardian' ? charm.charmGuardianLifespan(e)
                : id === 'charm_of_negation' ? charm.charmNegationRadius(e) : 0;
            expect(magnitude, `${id}/E${e}/magnitude`).toBe(row.magnitude);
        }
    });

    it('retains birth range/tail, identified state, cooldown, all own fields and zero-RNG enchanting for each new kind', () => {
        for (const id of ids) {
            const range = vi.spyOn(rng, 'randClumpedRange').mockReturnValue(2);
            const tail = vi.spyOn(rng, 'randPercent').mockReturnValueOnce(true).mockReturnValueOnce(false);
            const item = ItemLoader.spawnCharm(id, 6, 7)!;
            expect(range).toHaveBeenCalledExactlyOnceWith(1, 2, 1);
            expect(tail.mock.calls).toEqual([[7], [7]]);
            expect(item).toMatchObject({ enchantment: 3, identified: true, cooldownRemaining: 0, arcanaInstanceVersion: 2 });
            item.cooldownRemaining = 42;
            expect(deserializeItem(serializeItem(item))).toEqual(item);
            const before = rng.getState();
            expect(enchantArcana(item)).toBe(true);
            expect(rng.getState()).toEqual(before);
            expect(item).toMatchObject({ enchantment: 4, cooldownRemaining: 0, cooldownTurns: charm.charmRechargeDelay(id as Kind, 4) });
            vi.restoreAllMocks();
        }
    });

    it('uses the same formulas for current/enchant preview in Chinese and leaves the five CE Discoveries groups intact', () => {
        const g = scene();
        i18next.addResourceBundle('zh_CN', 'translation', zhCN, true, true);
        i18next.changeLanguage('zh_CN');
        const expected = [['悬浮 15 回合', '悬浮 19 回合'], ['碎墙半径 6 格', '碎墙半径 7 格'],
            ['持续 8 回合', '持续 10 回合'], ['随机传送', '随机传送'], ['充满背包内的法杖', '不影响魔杖和护符'], ['消魔范围 7 格', '消魔范围 10 格']];
        ids.forEach((id, i) => {
            const item = give(g, id, 2);
            item.cooldownRemaining = 7;
            const text = JSON.stringify(generateItemDetail(item, g.player.strength));
            for (const part of expected[i]!) expect(text).toContain(part);
            expect(text).toContain(`冷却回合: ${charm.charmRechargeDelay(id as Kind, 2)}`);
            expect(text).toContain(`冷却 ${charm.charmRechargeDelay(id as Kind, 3)} 回合`);
            expect(text).toContain('剩余冷却: 7');
            expect(item.displayName).toMatch(/[\u4e00-\u9fff]/);
            expect(text).not.toMatch(/charm_of_|Charm of|Unknown/);
        });
        expect(getDiscoveries().map(g => g.category)).toEqual([C.SCROLL, C.RING, C.POTION, C.STAFF, C.WAND]);
    });
});

describe('X2e real charm effects through inventory use', () => {
    it('overwrites levitation duration/maxStatus, frees seizure, and rejects cooling/foreign items without time or RNG', () => {
        const g = scene(), item = give(g, ids[0]!, 2);
        const end = vi.spyOn(g as any, 'playerTurnEnded').mockImplementation(() => {});
        g.player.setStatusDuration('levitating', 100); g.player.seized = true;
        const tick = timeSystem.currentTick;
        g.useArcanaItem(item);
        expect([g.player.getStatusDuration('levitating'), g.player.maxStatus.levitating, g.player.seized]).toEqual([15, 15, false]);
        expect(timeSystem.currentTick - tick).toBe(100);
        expect(item.cooldownRemaining).toBe(352);
        const before = rng.getState(), afterTick = timeSystem.currentTick;
        g.useArcanaItem(item);
        g.player.inventory.items = []; item.cooldownRemaining = 0; g.useArcanaItem(item);
        expect(end).toHaveBeenCalledTimes(1);
        expect(timeSystem.currentTick).toBe(afterTick); expect(rng.getState()).toEqual(before);
    });

    it('shatters through walls at CE radius, preserves outside/protected cells and invokes U15a exactly once', () => {
        const g = scene(), item = give(g, ids[1]!);
        vi.spyOn(g as any, 'playerTurnEnded').mockImplementation(() => {});
        const effect = vi.spyOn(g as any, 'crystalizeFromPlayer');
        for (const [x, y] of [[11, 10], [15, 10], [16, 10], [10, 14]]) g.grid.setTerrain(x!, y!, T.WALL);
        g.grid.impregnableCells.add(14 * g.grid.width + 10);
        g.useArcanaItem(item);
        expect(effect).toHaveBeenCalledExactlyOnceWith(5);
        expect(g.grid.getCell(15, 10)!.layers[L.DUNGEON]).toBe(T.FORCEFIELD);
        expect(g.grid.getCell(16, 10)!.terrain).toBe(T.WALL);
        expect(g.grid.getCell(10, 14)!.terrain).toBe(T.WALL);
        expect(item.cooldownRemaining).toBe(1499);
    });

    it('summons a grounded, fire-immune bound guardian with CE lifetime, turn delay, save and expiry', () => {
        const g = scene(), item = give(g, ids[2]!, 2);
        const end = vi.spyOn(g as any, 'playerTurnEnded').mockImplementation(() => {});
        for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) g.grid.setTerrain(x, y, T.WALL);
        g.grid.setTerrain(10, 10, T.FLOOR);
        g.grid.setTerrain(11, 10, T.LAVA);
        g.grid.setTerrain(9, 10, T.WATER_DEEP);
        g.grid.setTerrain(10, 9, T.CHASM);
        g.grid.setTerrain(10, 11, T.GAS_TRAP_POISON);
        g.useArcanaItem(item);
        const guardian = g.monsters[0]!;
        expect(guardian).toMatchObject({ typeId: 'guardian_spirit', isAlly: true, boundToPlayer: true,
            doesNotTrackLeader: true, leader: null, ticksUntilTurn: 101, hp: 1000, accuracy: 200,
            goldDropChance: 0, itemDropChance: 0, loc: { x: 11, y: 10 } });
        expect([guardian.getStatusDuration('lifespan_remaining'), guardian.maxStatus.lifespan_remaining]).toEqual([8, 8]);
        expect(guardian.hasBehavior('MONST_FLIES')).toBe(false);
        expect(guardian.isImmuneToWeapons()).toBe(true);
        expect(item.cooldownRemaining).toBe(360);
        end.mockRestore();
        const snap = JSON.parse(JSON.stringify(g.toSnapshot()));
        expect(g.loadSnapshot(snap)).toBe(true);
        const restored = g.monsters[0]!;
        expect(serializeItem(g.player.inventory.items[0]!)).toEqual(serializeItem(item));
        expect(restored).toMatchObject({ id: guardian.id, boundToPlayer: true, doesNotTrackLeader: true, ticksUntilTurn: 101 });
        for (let i = 0; i < 8; i++) g.handlePlayerAction('wait');
        expect(g.monsters).not.toContain(restored);
        expect(g.purgatory).not.toContain(restored);
        expect(g.items).toHaveLength(0);
    });

    it('keeps a no-space guardian attempt finite while still spending cooldown and a turn', () => {
        const g = scene(), item = give(g, ids[2]!);
        vi.spyOn(g as any, 'playerTurnEnded').mockImplementation(() => {});
        for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) g.grid.setTerrain(x, y, T.WALL);
        g.grid.setTerrain(10, 10, T.FLOOR);
        const tick = timeSystem.currentTick;
        g.useArcanaItem(item);
        expect(g.monsters).toHaveLength(0);
        expect(item.cooldownRemaining).toBe(507);
        expect(timeSystem.currentTick - tick).toBe(100);
    });

    it('uses CE terrain-aware teleport selection/commit, disentangles, retains seizure flags and spends once even without destinations', () => {
        const g = scene(), item = give(g, ids[3]!);
        vi.spyOn(g as any, 'playerTurnEnded').mockImplementation(() => {});
        for (let y = 0; y < g.grid.height; y++) g.grid.setTerrain(30, y, T.WALL);
        g.grid.setTerrain(50, 10, T.SACRED_GLYPH);
        expect(teleportCandidates(g, g.player)).toContainEqual({ x: 50, y: 10 });
        expect(teleportCandidates(g, g.player, true)).not.toContainEqual({ x: 50, y: 10 });
        const teleport = vi.spyOn(g as any, 'teleportCreature');
        g.player.seized = true; g.player.setStatusDuration('stuck', 7);
        g.useArcanaItem(item);
        expect(teleport).toHaveBeenCalledExactlyOnceWith(g.player, true);
        expect(g.player.x).toBeGreaterThan(30); expect(g.player.seized).toBe(true);
        expect(g.player.hasStatus('stuck')).toBe(false);
        expect(g.grid.getCell(g.player.x, g.player.y)!.isVisible).toBe(true);
        expect(item.cooldownRemaining).toBe(551);
        item.cooldownRemaining = 0;
        for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) g.grid.setTerrain(x, y, T.WALL);
        g.grid.setTerrain(g.player.x, g.player.y, T.FLOOR);
        const at = { ...g.player.loc }, tick = timeSystem.currentTick;
        g.useArcanaItem(item);
        expect(g.player.loc).toEqual(at); expect(item.cooldownRemaining).toBe(551);
        expect(timeSystem.currentTick - tick).toBe(100);
    });

    it('recharges every staff using W6 timers, excludes wands/other charms, and the scroll still charges all charms', () => {
        const g = scene(), item = give(g, ids[4]!), other = give(g, ids[0]!);
        vi.spyOn(g as any, 'playerTurnEnded').mockImplementation(() => {});
        const staffs = ItemLoader.genStaffs.map(s => ItemLoader.spawnStaff(s.id, -1, -1)!);
        const wand = ItemLoader.spawnWand('wand_of_negation', -1, -1)!;
        for (const staff of staffs) { staff.enchantment = staff.maxCharges = 3; staff.charges = 0; staff.staffRechargeRemaining = 9; }
        g.player.inventory.items.push(...staffs, wand); other.cooldownRemaining = 42;
        const wandCharge = wand.charges;
        g.useArcanaItem(item);
        for (const staff of staffs) {
            expect(staff.charges).toBe(3);
            expect(staff.staffRechargeRemaining).toBe(['staff_of_blinking', 'staff_of_obstruction'].includes(staff.identityId!) ? 3333 : 1666);
        }
        expect(wand.charges).toBe(wandCharge); expect(other.cooldownRemaining).toBe(42);
        expect(item.cooldownRemaining).toBe(5499);
        g.player.inventory.items = [wand];
        const all = ItemLoader.charms.map(c => give(g, c.id));
        for (const c of all) c.cooldownRemaining = 42;
        const scroll = ItemLoader.spawnScroll('scroll_of_recharging', -1, -1)!;
        g.player.inventory.items.push(scroll);
        g.readItem(scroll);
        expect(all.map(c => c.cooldownRemaining)).toEqual(all.map(() => 0));
        expect(wand.charges).toBe(wandCharge);
    });

    it('negates self, creatures and floor items at radius+1, with LOS/radius boundaries and inventory exclusion', () => {
        const g = scene(), item = give(g, ids[5]!);
        vi.spyOn(g as any, 'playerTurnEnded').mockImplementation(() => {});
        const atBoundary = addMonster(g, 'guardian_spirit', 15, 10);
        const outside = addMonster(g, 'guardian_spirit', 15, 11);
        const hidden = addMonster(g, 'guardian_spirit', 8, 10);
        g.grid.setTerrain(9, 10, T.WALL);
        const floor = ids.map((id, i) => ItemLoader.spawnCharm(id, 10, 11 + i % 3)!);
        g.items.push(...floor);
        const hiddenItem = ItemLoader.spawnCharm(ids[0]!, 8, 10)!;
        const outsideItem = ItemLoader.spawnCharm(ids[0]!, 15, 11)!;
        g.items.push(hiddenItem, outsideItem);
        const pack = give(g, ids[0]!); pack.cooldownRemaining = 19;
        g.player.setStatusDuration('hasted', 20);
        const effect = vi.spyOn(g as any, 'negationBlastFromPlayer');
        g.useArcanaItem(item);
        expect(effect.mock.calls[0]![1]).toBe(5);
        expect(g.player.hasStatus('hasted')).toBe(false);
        expect(atBoundary.hp).toBe(0); expect(outside.hp).toBe(1000); expect(hidden.hp).toBe(1000);
        for (const c of floor) expect(c.cooldownRemaining).toBe(charm.charmRechargeDelay(c.identityId as Kind, c.enchantment));
        expect([hiddenItem.cooldownRemaining, outsideItem.cooldownRemaining, pack.cooldownRemaining]).toEqual([0, 0, 19]);
        expect(item.cooldownRemaining).toBe(1499);
    });
});

describe('X2e CE pool restoration (run after effects stage)', () => {
    it('matches all twelve CE table rows in order and frequency, including category-only machine requests', () => {
        const ce = fs.readFileSync(new URL('../../../BrogueCE-master/src/variants/GlobalsBrogue.c', import.meta.url), 'utf8');
        const table = ce.split('itemTable charmTable_Brogue[] = {')[1]!.split('\n};')[0]!.replace(/\/\/[^\n]*/g, '');
        const rows = [...table.matchAll(/\{"([^"]+)",\s*"",\s*"",\s*(\d+),\s*(\d+)/g)].map(m => ({
            id: `charm_of_${m[1] === 'haste' ? 'speed' : m[1]!.replace(/ /g, '_')}`, frequency: Number(m[2]),
        }));
        expect(rows).toHaveLength(12);
        expect(ItemLoader.genCharms.map(c => ({ id: c.id, frequency: c.frequency }))).toEqual(rows);
        const api = Object.create(Game.prototype) as any;
        const chosen = vi.spyOn(ItemLoader, 'chooseKind');
        for (let i = 0; i < rows.length; i++) {
            chosen.mockReturnValue(i);
            const item = api.spawnBlueprintItem('CHARM', undefined, 7, 8, 1);
            expect(item.identityId).toBe(rows[i]!.id);
            expect(item.identified).toBe(true);
            expect(item.cooldownRemaining).toBe(0);
            expect(chosen).toHaveBeenLastCalledWith(rows.map(r => r.frequency));
        }
    });
});
