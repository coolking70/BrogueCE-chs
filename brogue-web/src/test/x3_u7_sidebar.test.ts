import { getTerrainDescription } from '../engine/UI/TerrainTextCatalog';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { Player } from '../entities/Player';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import monstersData from '../data/monsters.json';
import { Grid, TerrainType, DungeonLayer } from '../engine/Map/Grid';
import { TERRAIN_FLAGS, TM_LIST_IN_SIDEBAR } from '../engine/Map/TerrainCatalog';
import { Item, ItemCategory } from '../engine/Items/Item';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { rng } from '../engine/Random';
import { sidebarEntityRows, visibleMonsterRows, monsterBehaviorLabel, sidebarPlayerStats, sidebarTerrainName } from '../engine/UI/MonsterSidebar';
import { createHeadlessGame } from './harness';
import zhCN from '../locales/zh_CN.json';

beforeEach(async () => {
    await i18next.init({ lng: 'en', fallbackLng: false, resources: { zh_CN: { translation: zhCN } }, initImmediate: false });
});
afterEach(() => vi.restoreAllMocks());

function scene() {
    const player = new Player(10, 10), grid = new Grid(24, 24);
    const monsters: Monster[] = [], items: Item[] = [];
    const visible = (x: number, y: number, sensed = false) => {
        grid.setTerrain(x, y, TerrainType.FLOOR);
        const cell = grid.getCell(x, y)!;
        cell.isVisible = true;
        cell.isClairvoyantVisible = sensed;
        return cell;
    };
    visible(10, 10);
    const monster = (x: number, y: number, sensed = false) => {
        const m = new Monster(x, y, (monstersData as MonsterData[]).find(m => m.id === 'rat')!);
        m.state = MonsterState.HUNTING;
        monsters.push(m); visible(x, y, sensed); return m;
    };
    const item = (x: number, y: number, sensed = false) => {
        const item = new Item('food', ':', 0xffff00, ItemCategory.FOOD);
        item.loc = { x, y }; items.push(item); visible(x, y, sensed); return item;
    };
    const terrain = (x: number, y: number, sensed = false) => {
        visible(x, y, sensed); grid.setTerrain(x, y, TerrainType.STAIRS_DOWN); return `${x},${y}`;
    };
    return { player, grid, monsters, items, visible, monster, item, terrain,
        rows: (focus: { x: number; y: number } | null = null) => sidebarEntityRows(player, grid, monsters, items, focus) };
}

describe('X3-U7 CE sidebar ordering and knowledge', () => {
    it('keeps feet/focus first, then direct monsters/items/terrain, then sensed groups; squared Euclidean within each', () => {
        const s = scene();
        const farDiagonal = s.monster(13, 13); // Chebyshev 3, squared 18
        const nearAxis = s.monster(14, 10); // Chebyshev 4, squared 16: must come first
        const sensedMonster = s.monster(11, 10, true);
        const farItem = s.item(13, 7), nearItem = s.item(10, 6);
        const sensedItem = s.item(10, 11, true);
        const farTerrain = s.terrain(7, 7), nearTerrain = s.terrain(6, 10);
        const sensedTerrain = s.terrain(9, 10, true);
        const feet = s.item(10, 10), focus = s.item(20, 20, true);
        expect(s.rows(focus.loc).map(r => r.id)).toEqual([feet.id, focus.id, nearAxis.id, farDiagonal.id,
            nearItem.id, farItem.id, nearTerrain, farTerrain, sensedMonster.id, sensedItem.id, sensedTerrain]);
        expect(s.rows(focus.loc).filter(r => r.focused).map(r => r.id)).toEqual([focus.id]);
        expect(s.monsters).toEqual([farDiagonal, nearAxis, sensedMonster]); // no in-place engine sort
        expect(visibleMonsterRows(s.player, s.grid, s.monsters).map(r => r.id)).toEqual([nearAxis.id, farDiagonal.id, sensedMonster.id]);
    });

    it('focuses a monster or terrain, clears focus, and resolves a shared tile creature > item > terrain once', () => {
        const s = scene(), near = s.monster(11, 10), far = s.monster(18, 10);
        const t = s.terrain(10, 12);
        expect(s.rows(far.loc)[0]!.id).toBe(far.id);
        expect(s.rows({ x: 10, y: 12 })[0]!.id).toBe(t);
        expect(s.rows()[0]!.id).toBe(near.id);
        s.item(18, 10); s.terrain(18, 10);
        expect(s.rows(far.loc).filter(r => r.loc.x === 18 && r.loc.y === 10).map(r => r.kind)).toEqual(['monster']);
        s.terrain(10, 10); const feet = s.item(10, 10);
        expect(s.rows(s.player.loc).filter(r => r.loc.x === 10 && r.loc.y === 10).map(r => r.id)).toEqual([feet.id]);
    });

    it('does not list corpses, dormant/invisible/submerged identities, unlisted monsters, or remembered/mapped entities', () => {
        const s = scene();
        s.monster(11, 10).hp = 0;
        s.monster(12, 10).isDormant = true;
        s.monster(13, 10).setStatusDuration('invisible', 10);
        const submerged = s.monster(14, 10); submerged.submerged = true;
        s.grid.setTerrain(14, 10, TerrainType.WATER_DEEP);
        const unlisted = s.monster(15, 10); unlisted.behaviorFlags.add('MONST_NOT_LISTED_IN_SIDEBAR');
        const hiddenItem = s.item(16, 10); hiddenItem.magicDetected = true;
        s.terrain(16, 10);
        Object.assign(s.grid.getCell(16, 10)!, { isVisible: false, hasMemory: true, isMagicMapped: true });
        s.player.setStatusDuration('telepathy', 10);
        expect(s.rows()).toEqual([]);
        expect(s.rows(unlisted.loc)).toEqual([]);
        expect(s.rows(hiddenItem.loc)).toEqual([]);
    });

    it('uses telepathy only for known monster identity, never to reveal its item or terrain', () => {
        const s = scene(), distant = s.monster(18, 10); s.item(18, 10); s.terrain(18, 10);
        s.grid.getCell(18, 10)!.isVisible = false;
        expect(s.rows(distant.loc)).toEqual([]);
        s.player.setStatusDuration('telepathy', 10);
        expect(s.rows(distant.loc).map(r => [r.kind, r.id, r.direct])).toEqual([['monster', distant.id, false]]);
    });

    it('lists a clairvoyant item/terrain without ordinary visibility; feet item needs no visibility', () => {
        const s = scene(), item = s.item(18, 10, true); s.terrain(18, 11, true);
        s.grid.getCell(18, 10)!.isVisible = false; s.grid.getCell(18, 11)!.isVisible = false;
        const feet = s.item(10, 10); s.grid.getCell(10, 10)!.isVisible = false;
        expect(s.rows().map(r => r.id)).toEqual([feet.id, item.id, '18,11']);
    });

    it('uses the first flagged terrain layer, not the top drawn layer; covers every listed kind through the CE text catalog', async () => {
        const s = scene(); s.visible(11, 10);
        s.grid.setTerrain(11, 10, TerrainType.STAIRS_DOWN);
        s.grid.setTerrainLayer(11, 10, DungeonLayer.SURFACE, TerrainType.PLAIN_FIRE);
        expect(s.rows()[0]!.name).toBe(getTerrainDescription(TerrainType.STAIRS_DOWN));
        const listed = Object.values(TerrainType).filter((t): t is TerrainType => typeof t === 'number'
            && !!(TERRAIN_FLAGS[t].mechFlags & TM_LIST_IN_SIDEBAR));
        expect(listed.length).toBeGreaterThan(40);
        for (const t of listed) expect(sidebarTerrainName(t)).not.toBe('the floor');
        await i18next.changeLanguage('zh_CN');
        for (const t of listed) expect(sidebarTerrainName(t)).toMatch(/[\u4e00-\u9fff]/);
    });

    it('uses displayName for unidentified floor items without disclosing their true kind/enchantment', () => {
        const s = scene();
        ItemLoader.identifiedItems.delete('potion_of_strength');
        ItemLoader.potionFlavorMap.set('potion_of_strength', { name: 'crimson', color: 0xff0000 });
        const item = new Item('Potion of Strength', '!', 0xffffff, ItemCategory.POTION);
        item.consumableId = 'potion_of_strength'; item.loc = { x: 11, y: 10 }; s.visible(11, 10); s.items.push(item);
        expect(s.rows()[0]!.name).toBe(item.displayName);
        expect(s.rows()[0]!.name).not.toContain('Strength');
    });
});

describe('X3-U7 CE behavior labels and negation', () => {
    it.each([
        ['Captive', (m: Monster) => { m.isCaged = true; m.isAlly = true; }],
        ['Helpless', (m: Monster) => { m.behaviorFlags.add('MONST_RESTRICTED_TO_LIQUID'); m.state = MonsterState.ASLEEP; }],
        ['Sleeping', (m: Monster) => { m.state = MonsterState.ASLEEP; }],
        ['Ally', (m: Monster) => { m.isAlly = true; m.state = MonsterState.WANDERING; }],
        ['Fleeing', (m: Monster) => { m.state = MonsterState.FLEEING; }],
        ['Wandering', (m: Monster) => { m.state = MonsterState.WANDERING; }],
        ['Off balance', (m: Monster) => { m.ticksUntilTurn = 101; }],
        ['Hunting', (m: Monster) => { m.ticksUntilTurn = 100; }],
    ] as const)('%s uses live state and CE precedence', (label, setup) => {
        const s = scene(), m = s.monster(11, 10); s.player.ticksUntilTurn = -50; s.player.movementSpeed = 100;
        setup(m);
        expect(monsterBehaviorLabel(s.player, s.grid, m)).toBe(`(${label})`);
    });

    it('follows immobile/captive leaders only when wandering, with worship taking priority over guarding', () => {
        const s = scene(), m = s.monster(11, 10), leader = s.monster(12, 10);
        m.leader = leader; leader.isCaged = true; m.state = MonsterState.WANDERING;
        expect(monsterBehaviorLabel(s.player, s.grid, m)).toBe('(Guarding)');
        leader.behaviorFlags.add('MONST_IMMOBILE');
        expect(monsterBehaviorLabel(s.player, s.grid, m)).toBe('(Worshiping)');
        m.state = MonsterState.FLEEING;
        expect(monsterBehaviorLabel(s.player, s.grid, m)).toBe('(Fleeing)');
    });

    it('uses submerging capability across layers and the exact off-balance threshold', () => {
        const s = scene(), m = s.monster(11, 10); m.behaviorFlags.add('MONST_RESTRICTED_TO_LIQUID');
        s.grid.setTerrainLayer(11, 10, DungeonLayer.LIQUID, TerrainType.WATER_DEEP);
        s.player.ticksUntilTurn = 50; s.player.movementSpeed = 50; m.ticksUntilTurn = 100;
        expect(monsterBehaviorLabel(s.player, s.grid, m)).toBe('(Hunting)');
        m.ticksUntilTurn++;
        expect(monsterBehaviorLabel(s.player, s.grid, m)).toBe('(Off balance)');
    });

    it('negation requires wasNegated and equal power counts; inanimate hides behavior, hallucination hides real labels/statuses', () => {
        const s = scene(), m = s.monster(11, 10); m.wasNegated = true;
        m.setStatusDuration('slowed', 5); m.behaviorFlags.add('MONST_INANIMATE');
        const row = () => visibleMonsterRows(s.player, s.grid, [m])[0]!;
        expect(row().negated).toBe(true); expect(row().behavior).toBe('');
        m.totalPowerCount = 1; expect(row().negated).toBe(false);
        m.newPowerCount = 1; expect(row().negated).toBe(true);
        m.wasNegated = false; expect(row().negated).toBe(false);
        m.wasNegated = true; m.behaviorFlags.delete('MONST_INANIMATE');
        s.player.setStatusDuration('hallucinating', 5);
        expect(row()).toMatchObject({ negated: false, behavior: '', statuses: [] });
    });
});

describe('X3-U7 player numbers and display purity', () => {
    it('uses effective/base strength, known armor rounding, donning, gold and exact supplied stealth', () => {
        const player = new Player(10, 10);
        expect(sidebarPlayerStats(player, 0, 14)).toEqual({ strength: 12, maxStrength: 12, armor: '0', gold: 0, stealthRange: 14 });
        player.strength = 16; player.weaknessAmount = 3;
        const armor = new Item('Leather Armor', '[', 0xffffff, ItemCategory.ARMOR);
        armor.armor = 3; armor.strengthRequired = 10; armor.enchantment = 2; player.equippedArmor = armor;
        player.setStatusDuration('donning', 1);
        expect(sidebarPlayerStats(player, 317, 1)).toEqual({ strength: 13, maxStrength: 16, armor: '4', gold: 317, stealthRange: 1 });
    });

    it('unknown armor uses kind estimate with ?, ignores rolled armor/enchantment, honors weakness/donning and never leaks unknown kinds', () => {
        const player = new Player(10, 10), armor = new Item('Leather Armor', '[', 0xffffff, ItemCategory.ARMOR);
        Object.assign(armor, { identityId: 'leather_armor', identified: false, armor: 99, enchantment: 37, strengthRequired: 10 });
        player.equippedArmor = armor; player.strength = 14; player.setStatusDuration('donning', 1);
        expect(sidebarPlayerStats(player, 0, 7).armor).toBe('3?');
        armor.enchantment = -10; armor.armor = 1;
        expect(sidebarPlayerStats(player, 0, 7).armor).toBe('3?');
        player.weaknessAmount = 6;
        expect(sidebarPlayerStats(player, 0, 7).armor).toBe('0?');
        armor.identityId = 'unknown_kind'; expect(sidebarPlayerStats(player, 0, 7).armor).toBe('?');
        armor.identified = true; expect(sidebarPlayerStats(player, 0, 7).armor).toBe('0');
    });

    it('polling and focusing consume no RNG, commands or saved state; stealth is the existing live calculation', () => {
        const g = createHeadlessGame(33007, 'test');
        g.player.setStatusDuration('invisible', 5);
        // Freeze metadata time; compare the entire snapshot, including savedAt.
        vi.spyOn(Date, 'now').mockReturnValue(33007);
        const snapshot = g.toSnapshot(), random = rng.getState(), recording = g.exportRecording();
        for (let i = 0; i < 5; i++) {
            sidebarEntityRows(g.player, g.grid, g.monsters, g.items, i % 2 ? g.player.loc : null);
            expect(sidebarPlayerStats(g.player, g.stats.gold, g['calculateStealthRange']()).stealthRange).toBe(1);
        }
        expect(rng.getState()).toEqual(random);
        expect(g.toSnapshot()).toEqual(snapshot);
        expect(g.exportRecording()).toEqual(recording);
    });
});
