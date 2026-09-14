/**
 * src/test/scroll_effects.test.ts — 5 个占位卷轴实装的验收测试
 *
 * 覆盖（CE 出处见 ai_docs/scroll_effects_report.md）：
 *   1. teleport_random   → 玩家落到合法可站立格（Items.c:7803）
 *   2. protect_weapon    → isProtected + 单件解咒（Items.c:7922）
 *   3. protect_armor     → 同上（Items.c:7906）
 *   4. isProtected 存读档往返 + 旧存档回落 false
 *   5. summon_monsters   → 邻格新增 1-3 只 HUNTING 怪（Items.c:7977-7990）
 *   6. discord_burst     → 视野内怪获 discordant；discordant 怪攻击相邻怪物
 *                          （Items.c:8011 → discordBlast Items.c:4883-4902）
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { ItemCategory, Item } from '../engine/Items/Item';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import { TerrainType } from '../engine/Map/Grid';
import monsterDataJson from '../data/monsters.json';
import { logger } from '../engine/Systems/Logger';

const MONSTER_DATA = monsterDataJson as MonsterData[];

/** 造一张指定卷轴塞进玩家背包（落在背包内，loc 无意义） */
function giveScroll(game: Game, id: string): Item {
    const scroll = ItemLoader.spawnScroll(id, -1, -1)!;
    expect(game.player.inventory.addItem(scroll)).toBe(true);
    return scroll;
}

/** 读取背包中的一张卷轴（等价玩家使用），返回 true 表示卷轴被消耗 */
function readScroll(game: Game, id: string): boolean {
    const scroll = game.player.inventory.items.find(
        i => i.category === ItemCategory.SCROLL && (i as any).consumableId === id
    );
    if (!scroll) return false;
    game.readItem(scroll);
    return true;
}

/** 断言玩家位于合法可站立格：界内、可通行、无怪物、不在墙里 */
function expectPlayerOnValidTile(game: Game): void {
    const { x, y } = game.player.loc;
    const cell = game.grid.getCell(x, y);
    expect(cell).not.toBeNull();
    expect(cell!.isPassable).toBe(true);
    expect(game.getMonsterAt(x, y)).toBeUndefined();
}

describe('teleport_random 卷轴（Items.c:7803）', () => {
    it('读卷轴后玩家坐标改变，且新位置合法可站立、卷轴被消耗', () => {
        const game = createHeadlessGame(20260914);
        const before = { x: game.player.loc.x, y: game.player.loc.y };

        giveScroll(game, 'scroll_of_teleportation');
        expect(readScroll(game, 'scroll_of_teleportation')).toBe(true);

        // teleportPlayerRandom 排除玩家当前格，坐标必须改变
        const after = { x: game.player.loc.x, y: game.player.loc.y };
        expect(after.x === before.x && after.y === before.y).toBe(false);
        expectPlayerOnValidTile(game);

        // 卷轴照常消耗（readItem 开头 removeItem）
        expect(game.player.inventory.items.some(
            i => i.category === ItemCategory.SCROLL && (i as any).consumableId === 'scroll_of_teleportation'
        )).toBe(false);
    });
});

describe('protect_weapon / protect_armor 卷轴（Items.c:7922 / 7906）', () => {
    it('protect_weapon：装备 isProtected=true；原诅咒则解除并额外打 malevolent 消息', () => {
        const game = createHeadlessGame(20260914);
        const weapon = game.player.equippedWeapon!;
        expect(weapon).not.toBeNull();
        weapon.isCursed = true;
        weapon.enchantment = -2; // CE uncurse 不动负附魔

        giveScroll(game, 'scroll_of_protect_weapon');
        expect(readScroll(game, 'scroll_of_protect_weapon')).toBe(true);

        expect(weapon.isProtected).toBe(true);
        expect(weapon.isCursed).toBe(false);
        expect(weapon.enchantment).toBe(-2); // 只清诅咒标志，负附魔保持

        const texts = logger.messages.map(m => m.text).join('\n');
        expect(texts).toContain('golden light');
        expect(texts).toContain('malevolent force');
    });

    it('protect_armor：装备 isProtected=true，未诅咒时无 malevolent 消息', () => {
        const game = createHeadlessGame(20260914);
        const armor = game.player.equippedArmor!;
        expect(armor).not.toBeNull();
        expect(armor.isCursed).toBe(false);

        giveScroll(game, 'scroll_of_protect_armor');
        expect(readScroll(game, 'scroll_of_protect_armor')).toBe(true);

        expect(armor.isProtected).toBe(true);
        const texts = logger.messages.map(m => m.text).join('\n');
        expect(texts).toContain('golden light');
        expect(texts).not.toContain('malevolent force');
    });

    it('无对应装备时：不崩、卷轴照常消耗、打 "quickly disperses" 消息', () => {
        const game = createHeadlessGame(20260914);
        game.player.equippedWeapon = null;

        giveScroll(game, 'scroll_of_protect_weapon');
        expect(readScroll(game, 'scroll_of_protect_weapon')).toBe(true);

        const texts = logger.messages.map(m => m.text).join('\n');
        expect(texts).toContain('quickly disperses');
        expect(game.player.inventory.items.some(
            i => i.category === ItemCategory.SCROLL && (i as any).consumableId === 'scroll_of_protect_weapon'
        )).toBe(false);
    });
});

describe('isProtected 存读档往返', () => {
    it('toSnapshot → loadSnapshot 往返后装备 isProtected 保持 true', () => {
        const game = createHeadlessGame(20260914);
        game.player.equippedWeapon!.isProtected = true;

        const snapshot = game.toSnapshot();
        const weaponInSnapshot = snapshot.player.inventory.find(
            s => s.category === ItemCategory.WEAPON && s.isProtected === true
        );
        expect(weaponInSnapshot).toBeDefined();

        const reloaded = createHeadlessGame(1); // 状态会被 loadSnapshot 完整覆盖
        expect(reloaded.loadSnapshot(snapshot)).toBe(true);
        expect(reloaded.player.equippedWeapon!.isProtected).toBe(true);
    });

    it('旧存档兼容：快照缺 isProtected 字段时读入回落为 false', () => {
        const game = createHeadlessGame(20260914);
        game.player.equippedWeapon!.isProtected = true;
        const snapshot = game.toSnapshot();

        // 模拟旧版本存档：删掉所有物品快照的 isProtected 字段
        for (const s of snapshot.player.inventory) {
            delete s.isProtected;
        }
        expect(snapshot.player.inventory.some(s => 'isProtected' in s)).toBe(false);

        const reloaded = createHeadlessGame(1);
        expect(reloaded.loadSnapshot(snapshot)).toBe(true);
        for (const item of reloaded.player.inventory.items) {
            expect(item.isProtected).toBe(false);
        }
    });
});

describe('summon_monsters 卷轴（Items.c:7977-7990）', () => {
    it('读卷轴后玩家周围新增 1-3 只怪物，均为 HUNTING', () => {
        const game = createHeadlessGame(20260914);
        const before = game.monsters.length;

        giveScroll(game, 'scroll_of_summon_monsters');
        expect(readScroll(game, 'scroll_of_summon_monsters')).toBe(true);

        const added = game.monsters.length - before;
        expect(added).toBeGreaterThanOrEqual(1);
        expect(added).toBeLessThanOrEqual(3);

        // 均为 HUNTING（CE wakeUp），且不与玩家重叠、彼此不重叠
        const newcomers = game.monsters.slice(before);
        for (const m of newcomers) {
            expect(m.state).toBe(MonsterState.HUNTING);
            expect(m.hp).toBeGreaterThan(0);
        }
        const occupied = new Set(newcomers.map(m => `${m.loc.x},${m.loc.y}`));
        expect(occupied.size).toBe(newcomers.length);
        expect(game.getMonsterAt(game.player.loc.x, game.player.loc.y)).toBeUndefined();
    });
});

/** 在 (x,y) 铺地板并放置一只指定 id 的怪物（已从数据表查找） */
function placeMonster(game: Game, id: string, x: number, y: number): Monster {
    const data = MONSTER_DATA.find(m => m.id === id);
    if (!data) throw new Error(`monsters.json 中无 ${id}`);
    game.grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
    const mon = new Monster(x, y, data);
    game.monsters.push(mon);
    return mon;
}

describe('discord_burst 卷轴（Items.c:8011 → discordBlast）', () => {
    it('视野内怪物获得 discordant（30 回合）；无生命怪豁免', () => {
        const game = createHeadlessGame(20260914);
        // 场地完全受控：整片铺平成地板，玩家 (5,5)，普通怪 (5,7)，
        // 无生命怪 goblin_totem（MONST_INANIMATE）(5,8)
        for (let x = 2; x <= 9; x++) {
            for (let y = 2; y <= 10; y++) {
                game.grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
            }
        }
        game.player.loc = { x: 5, y: 5 };
        const goblin = placeMonster(game, 'goblin', 5, 7);
        const totem = placeMonster(game, 'goblin_totem', 5, 8);

        giveScroll(game, 'scroll_of_discord');
        expect(readScroll(game, 'scroll_of_discord')).toBe(true);

        expect(goblin.hasStatus('discordant')).toBe(true);
        expect(goblin.getStatusDuration('discordant')).toBe(29)  // P2-3 起 eatItem/readItem 为完整回合：施加效果后同一动作的客观块随即递减 1（CE 同构）。;
        // CE Items.c:4896：MONST_INANIMATE（无生命）豁免 discord
        expect(totem.hasStatus('discordant')).toBe(false);
    });

    it('AI 侧生效：discordant 怪物把相邻的其他怪物选为攻击目标', () => {
        const game = createHeadlessGame(20260914);
        game.player.loc = { x: 5, y: 5 };
        const attacker = placeMonster(game, 'goblin', 5, 7);
        const victim = placeMonster(game, 'jackal', 5, 8);

        attacker.state = MonsterState.HUNTING;
        attacker.setStatusDuration('discordant', 30);
        const victimHpBefore = victim.hp;

        attacker.takeTurn(game, 8);

        // 无论命中与否，都会产生 "turns on / misses the <victim>" 的攻击日志；
        // 若命中则 victim 掉血。二者必居其一，证明目标选择已转向相邻怪物。
        const texts = logger.messages.map(m => m.text).join('\n');
        const attacked = texts.includes(victim.name) &&
            (texts.includes('turns on') || texts.includes('misses the'));
        expect(attacked).toBe(true);
        if (victim.hp < victimHpBefore) {
            expect(victim.hp).toBeLessThan(victimHpBefore);
        }
    });

    it('AI 目标选择覆盖全部 8 个相邻方向（回归：右下 [1,1] 曾缺失）', () => {
        // 组合断言：这 8 个位移互不相同、且恰好铺满 {-1,0,1}² 去掉原点 (0,0)
        const dirs: Array<[number, number]> = [
            [0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, 1], [-1, 1], [1, -1],
        ];
        const keys = new Set(dirs.map(([dx, dy]) => `${dx},${dy}`));
        expect(keys.size).toBe(8);
        for (const [dx, dy] of dirs) {
            expect(
                Math.abs(dx!) <= 1 && Math.abs(dy!) <= 1 && (dx !== 0 || dy !== 0)
            ).toBe(true);
        }

        // 行为断言：每个方向单独构造场景——discordant 怪在中心，
        // 仅该方向相邻格有一只怪，takeTurn 后必须把它选为攻击目标
        //（命中 "turns on" 或未命中 "misses the" 都算"选为目标"）。
        for (const [dx, dy] of dirs) {
            const game = createHeadlessGame(20260914);
            for (let x = 2; x <= 8; x++) {
                for (let y = 2; y <= 8; y++) {
                    game.grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
                }
            }
            game.player.loc = { x: 2, y: 2 };
            const attacker = placeMonster(game, 'goblin', 5, 5);
            attacker.state = MonsterState.HUNTING;
            attacker.setStatusDuration('discordant', 30);
            const victim = placeMonster(game, 'jackal', 5 + dx!, 5 + dy!);

            attacker.takeTurn(game, 8);

            const texts = logger.messages.map(m => m.text).join('\n');
            const targeted = texts.includes(victim.name) &&
                (texts.includes('turns on') || texts.includes('misses the'));
            if (!targeted) {
                throw new Error(
                    `discordant 怪未把方向 (${dx},${dy}) 上的相邻怪选为攻击目标`
                );
            }
        }
    });
});
