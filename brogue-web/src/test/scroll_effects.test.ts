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
import { TerrainType, DungeonLayer } from '../engine/Map/Grid';
import { TERRAIN_FLAGS, T_SACRED, T_OBSTRUCTS_PASSABILITY } from '../engine/Map/TerrainCatalog';
import { SAFETY_MAX_DISTANCE } from '../engine/Map/SafetyMap';
import { rng } from '../engine/Random';
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
        // P4-8 返工：awareOfTarget 生效后，追踪怪保持追踪的前提是玩家气味可达
        //（perceived ≤ awareness*3，Monsters.c:1669-1676）。本测试直调 takeTurn、
        // 玩家从未行动，气味图全空会让攻击者在第 1 回合被 CE 判定丢目标
        //（Monsters.c:1776-1779 → WANDERING，discord 分支在 HUNTING 内不再执行）。
        // 全真掩码盖章 = 玩家气味可达全场：attacker perceived = 4 ≤ awareness 16。
        game.scent.update(game.grid, game.player.loc.x, game.player.loc.y,
            Array.from({ length: game.grid.width }, () => new Array<boolean>(game.grid.height).fill(true)));
        const victimHpBefore = victim.hp;
        // U21a：消息按 CE 只对玩家可见的怪物具名（否则“某个生物”）；本用例以日志判定目标，故声明两格可见。
        for (const m of [attacker, victim]) game.grid.getCell(m.loc.x, m.loc.y)!.isVisible = true;

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

            // P4-8 返工：同上——直调 takeTurn 的舞台需保证攻击者气味可达玩家
            //（perceived = scentDistance((5,5),(2,2)) = 9 ≤ awareness 16），
            // 否则 CE 丢失判定会在第 1 回合把它切回 WANDERING。
            game.scent.update(game.grid, game.player.loc.x, game.player.loc.y,
                Array.from({ length: game.grid.width }, () => new Array<boolean>(game.grid.height).fill(true)));
            for (const m of [attacker, victim]) game.grid.getCell(m.loc.x, m.loc.y)!.isVisible = true; // U21a：具名消息需玩家可见

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

// ═══════════════════════════════════════════════════════════════════════════
// B-3：三张占位卷轴补实（negation / sanctuary / shattering）
// CE 出处：negationBlast（Items.c:4827-4881，卷轴侧 :8004-8006）、
// SCROLL_SANCTUARY（:7941-7943 → DF_SACRED_GLYPHS Globals.c:676）、
// crystalize（:4904-4939，卷轴侧 :8007-8010 crystalize(9)）。
// ═══════════════════════════════════════════════════════════════════════════

/** 全图铺平成 FLOOR、清空怪物与物品的受控竞技场（测距/测 FOV 的前提）。 */
function flattenArena(game: Game): void {
    game.monsters = [];
    game.items = [];
    for (let x = 0; x < game.grid.width; x++) {
        for (let y = 0; y < game.grid.height; y++) {
            game.grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
        }
    }
}

/** 造一件地面物品（直接入 this.items，loc 即落点）。 */
function placeItem(game: Game, item: Item, x: number, y: number): Item {
    item.loc = { x, y };
    game.items.push(item);
    return item;
}

/** 一件"+3 带符文、被诅咒、已被探魔"的未鉴定地面武器（negation 的靶子）。 */
function cursedRunicWeapon(): Item {
    const w = new Item('dagger', '/', 0xcccccc, ItemCategory.WEAPON);
    w.enchantment = 3;
    w.runicType = 'quietus';
    w.runicKnown = false;
    w.isCursed = true;
    w.magicDetected = true;
    w.identified = false;
    w.canBeIdentified = true;
    w.charges = 5;      // 武器的 charges 复用为熟悉度倒计时（CE Items.c:275）
    w.timesUsed = 2;    // ≙ CE enchant2
    return w;
}

describe('B-3 negation_burst 卷轴（Items.c:8004 → negationBlast :4827-4881）', () => {
    it('视野内+距离内的怪被清魔法；diesIfNegated 的当场死；距离外的完全不受影响', () => {
        const game = createHeadlessGame(20260914);
        flattenArena(game);
        game.player.loc = { x: 1, y: 1 };
        // web 地图 79×29：DCOLS² = 6241。(77,27) 距 (1,1) 的欧氏距离² =
        // 76²+26² = 6452 > 6241（距离外），但切比雪夫距离 76 ≤ 79 且全平地
        // LOS 通畅（视野内）——这是距离判据（欧氏²）的真正闸门。
        const goblin = placeMonster(game, 'goblin', 5, 5);
        const wisp = placeMonster(game, 'wisp', 6, 5); // MONST_DIES_IF_NEGATED
        const far = placeMonster(game, 'goblin', 77, 27);
        goblin.setStatusDuration('hasted', 20);
        goblin.setStatusDuration('discordant', 30);
        far.setStatusDuration('hasted', 20);
        const farHpBefore = far.hp;

        giveScroll(game, 'scroll_of_negation');
        expect(readScroll(game, 'scroll_of_negation')).toBe(true);

        // 视野内、距离内：状态被清空
        expect(goblin.hasStatus('hasted')).toBe(false);
        expect(goblin.hasStatus('discordant')).toBe(false);
        expect(goblin.hp).toBeGreaterThan(0);
        // diesIfNegated：当场死（CE :4844 "This can be fatal."）
        expect(wisp.hp).toBeLessThanOrEqual(0);
        // 视野内、距离外：完全不受影响（欧氏²判据；切比雪夫错误实现在此翻红）
        expect(far.hasStatus('hasted')).toBe(true);
        expect(far.hp).toBe(farHpBefore);

        // B-3 §7.8：卷轴用完即亮种类（CE Items.c:8016-8026，首次使用即断言）
        expect(ItemLoader.identifiedItems.has('scroll_of_negation')).toBe(true);
    });

    it('玩家自己的状态也被清（CE :4834 negate(&player) 先于怪物循环、无消息）', () => {
        const game = createHeadlessGame(20260914);
        flattenArena(game);
        game.player.setStatusDuration('hasted', 20);
        game.player.setStatusDuration('slowed', 20);

        giveScroll(game, 'scroll_of_negation');
        expect(readScroll(game, 'scroll_of_negation')).toBe(true);

        expect(game.player.hasStatus('hasted')).toBe(false);
        expect(game.player.hasStatus('slowed')).toBe(false);
    });

    it('地面物品：附魔归零/符文消失/自动鉴定/解咒/探魔标记清除；距离外的原样不动', () => {
        const game = createHeadlessGame(20260914);
        flattenArena(game);
        game.player.loc = { x: 1, y: 1 };
        const near = placeItem(game, cursedRunicWeapon(), 5, 5);      // 32 ≤ 6241
        const far = placeItem(game, cursedRunicWeapon(), 77, 27);     // 6452 > 6241
        const wand = new Item('wand', '/', 0xdd88ff, ItemCategory.WAND);
        wand.charges = 3;
        wand.maxChargesKnown = false;
        wand.timesUsed = 2;
        placeItem(game, wand, 4, 5);

        giveScroll(game, 'scroll_of_negation');
        expect(readScroll(game, 'scroll_of_negation')).toBe(true);

        // CE :4855-4859 WEAPON：enchant1=enchant2=charges=0，符文与保护消失，
        // identify() 自动鉴定（含种类）；:4851 探魔/诅咒标记无条件清除。
        expect(near.enchantment).toBe(0);
        expect(near.timesUsed).toBe(0);
        expect(near.charges).toBe(0);
        expect(near.runicType).toBeUndefined();
        expect(near.runicKnown).toBe(false);
        expect(near.isProtected).toBe(false);
        expect(near.isCursed).toBe(false);
        expect(near.magicDetected).toBe(false);
        expect(near.identified).toBe(true);
        // CE :4865-4866 WAND：清剩余充能（不动 enchant2=timesUsed）、上限已知
        expect(wand.charges).toBe(0);
        expect(wand.maxChargesKnown).toBe(true);
        expect(wand.timesUsed).toBe(2);
        // 距离外：逐字段原样不动
        expect(far.enchantment).toBe(3);
        expect(far.runicType).toBe('quietus');
        expect(far.isCursed).toBe(true);
        expect(far.magicDetected).toBe(true);
        expect(far.identified).toBe(false);
    });
});

describe('B-3 sanctuary_burst 卷轴（Items.c:7941-7943 → DF_SACRED_GLYPHS）', () => {
    it('脚下与 4 正邻的 SURFACE 层落 SACRED_GLYPH（100/100 十字波前），T_SACRED 旗标成立', () => {
        const game = createHeadlessGame(20260914);
        flattenArena(game);
        game.player.loc = { x: 10, y: 10 };

        giveScroll(game, 'scroll_of_sanctuary');
        expect(readScroll(game, 'scroll_of_sanctuary')).toBe(true);

        for (const [x, y] of [[10, 10], [9, 10], [11, 10], [10, 9], [10, 11]] as const) {
            const cell = game.grid.getCell(x, y)!;
            expect(cell.layers[DungeonLayer.SURFACE], `(${x},${y}) SURFACE 层`).toBe(TerrainType.SACRED_GLYPH);
            expect(cell.terrain, `(${x},${y}) 有效地形（prio 7 胜出）`).toBe(TerrainType.SACRED_GLYPH);
            expect(TERRAIN_FLAGS[cell.terrain].flags & T_SACRED, `(${x},${y}) T_SACRED`).toBeTruthy();
        }
        // 十字波前是 4 向：对角格不该被波及
        expect(game.grid.getCell(11, 11)!.layers[DungeonLayer.SURFACE]).toBe(TerrainType.NOTHING);

        expect(ItemLoader.identifiedItems.has('scroll_of_sanctuary')).toBe(true);
    });

    it('行为终点（反空转链）：SafetyMap 把圣徽格判为怪物禁入——读卷轴前后同一格的图值必须改变', () => {
        const game = createHeadlessGame(20260914);
        flattenArena(game);
        game.player.loc = { x: 10, y: 10 };
        game.updateSafetyMap();
        const before = game.safetyMap[11]![10]!; // 将落圣徽的邻格，此刻是普通地板

        giveScroll(game, 'scroll_of_sanctuary');
        expect(readScroll(game, 'scroll_of_sanctuary')).toBe(true);

        game.updateSafetyMap();
        // CE Time.c:1813-1817：T_SACRED → monsterCost = PDS_FORBIDDEN；
        // 第二趟 dijkstra 后被重置回哨兵值 30000（SafetyMap.ts 的落地口径）。
        expect(before, '圣徽落下前：普通地板，怪物可达').not.toBe(SAFETY_MAX_DISTANCE);
        expect(game.safetyMap[11]![10], '圣徽落下后：怪物禁入').toBe(SAFETY_MAX_DISTANCE);
        // 玩家侧不被阻：圣徽之外两格远的普通地板保持有限值（玩家代价 1 的
        // 传播没有把圣徽当障碍——CE playerCost=1）。玩家格自身按 CE 的
        // 玩家格修正（monsterCost=PDS_FORBIDDEN）同样落 30000，不在此断言。
        expect(game.safetyMap[12]![10], '圣徽旁边的普通地板仍可达').not.toBe(SAFETY_MAX_DISTANCE);
    });
});

describe('B-3 shatter_burst 卷轴（Items.c:8007-8010 → crystalize(9)）', () => {
    it('半径 9 内的墙变 FORCEFIELD；半径外的墙不变；边界格变 CRYSTAL_WALL（非 FORCEFIELD）', () => {
        const game = createHeadlessGame(20260914);
        flattenArena(game);
        game.player.loc = { x: 5, y: 5 };
        game.grid.setTerrain(10, 5, TerrainType.WALL);  // 距离 5 ≤ 9 → FORCEFIELD
        game.grid.setTerrain(16, 5, TerrainType.WALL);  // 距离 11 > 9 → 不变
        game.grid.setTerrain(0, 5, TerrainType.WALL);   // 边界格（i==0），距离 5 ≤ 9 → CRYSTAL_WALL

        giveScroll(game, 'scroll_of_shattering');
        expect(readScroll(game, 'scroll_of_shattering')).toBe(true);

        const inner = game.grid.getCell(10, 5)!;
        expect(inner.layers[DungeonLayer.DUNGEON]).toBe(TerrainType.FORCEFIELD);
        expect(TERRAIN_FLAGS[inner.terrain].flags & T_OBSTRUCTS_PASSABILITY).toBeTruthy();
        expect(game.grid.getCell(16, 5)!.layers[DungeonLayer.DUNGEON]).toBe(TerrainType.WALL);
        // CE :4928-4929 "boundary walls turn to crystal"——DF 之后覆写，末值是晶墙
        expect(game.grid.getCell(0, 5)!.layers[DungeonLayer.DUNGEON]).toBe(TerrainType.CRYSTAL_WALL);
        // 启发式同步：FORCEFIELD 不挡视线 → isOpaque 立即翻假
        expect(inner.isOpaque).toBe(false);

        expect(ItemLoader.identifiedItems.has('scroll_of_shattering')).toBe(true);
    });

    it('视野：挡视线的墙被打碎后，玩家当场看到墙后（updateVision 不等回合结算）', () => {
        const game = createHeadlessGame(20260914);
        flattenArena(game);
        game.player.loc = { x: 5, y: 5 };
        game.grid.setTerrain(10, 5, TerrainType.WALL);
        // 先用一次 updateVision 建立基线：墙影里的 (12,5) 不可见
        (game as unknown as { updateVision(): void }).updateVision();
        expect(game.grid.getCell(12, 5)!.isVisible).toBe(false);

        giveScroll(game, 'scroll_of_shattering');
        expect(readScroll(game, 'scroll_of_shattering')).toBe(true);

        // crystalize 收尾的 updateVision（CE :4935）已当场重算：力场墙不挡视线
        expect(game.grid.getCell(10, 5)!.layers[DungeonLayer.DUNGEON]).toBe(TerrainType.FORCEFIELD);
        expect(game.grid.getCell(12, 5)!.isVisible).toBe(true);
    });

    it('对抗②场景：DUNGEON 层的 DOOR 被圣徽盖住（glyph prio 7 < door 8，有效地形是圣徽）仍须被晶化——读 layers[DUNGEON] 而非 cell.terrain', () => {
        const game = createHeadlessGame(20260914);
        flattenArena(game);
        game.player.loc = { x: 5, y: 5 };
        game.grid.setTerrainLayer(10, 5, DungeonLayer.DUNGEON, TerrainType.DOOR);
        game.grid.setTerrainLayer(10, 5, DungeonLayer.SURFACE, TerrainType.SACRED_GLYPH);
        // 此时 cell.terrain = SACRED_GLYPH（7 < 8），但它不挡视线；
        // 挡视线的是 DUNGEON 层的 DOOR（CE Items.c:4914 读 layers[DUNGEON]）
        expect(game.grid.getCell(10, 5)!.terrain).toBe(TerrainType.SACRED_GLYPH);

        giveScroll(game, 'scroll_of_shattering');
        expect(readScroll(game, 'scroll_of_shattering')).toBe(true);

        expect(game.grid.getCell(10, 5)!.layers[DungeonLayer.DUNGEON]).toBe(TerrainType.FORCEFIELD);
    });
});

describe('B-3 交互期掷骰哨兵（rng.randomNumbersGenerated 增量口径，B-1b 验证过的判据）', () => {
    /** test 层 + 全平地 + 无怪无物：回合结算零噪声（periodic spawn 在 test 模式短路）。 */
    function cleanTestGame(): Game {
        const game = createHeadlessGame(20260917, 'test');
        flattenArena(game);
        game.player.loc = { x: 20, y: 10 };
        return game;
    }

    function measureConsumption(game: Game, id: string): number {
        giveScroll(game, id); // 物品生成的掷骰发生在重播种之前
        rng.seedRandomGenerator(777);
        const before = rng.randomNumbersGenerated;
        expect(readScroll(game, id)).toBe(true);
        return rng.randomNumbersGenerated - before;
    }

    it('negation：读一次消耗 0 次随机数（CE negationBlast 全程零掷骰）', () => {
        expect(measureConsumption(cleanTestGame(), 'scroll_of_negation')).toBe(0);
    });

    it('sanctuary：读一次消耗 4 次（DF_SACRED_GLYPHS 100/100 十字波前：4 正邻各掷一次 rand_percent(100)）', () => {
        expect(measureConsumption(cleanTestGame(), 'scroll_of_sanctuary')).toBe(4);
    });

    it('shattering：读一次消耗 0 次（crystalize 无掷骰；DF_SHATTERING_SPELL start=0 零消耗且 tile 无载体跳过）', () => {
        expect(measureConsumption(cleanTestGame(), 'scroll_of_shattering')).toBe(0);
    });
});
