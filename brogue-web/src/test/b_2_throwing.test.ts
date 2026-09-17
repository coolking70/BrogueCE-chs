/**
 * src/test/b_2_throwing.test.ts — B-2 投掷弹道/命中/落地/药水细分/交互期哨兵
 *
 * 对抗性断言的"具体错误实现"对照（每条都能在对应错误下失败）：
 *   T1  投掷仍是"瞬移到目标格"，无逐格弹道（弹道中间的怪被无视）
 *   T2  命中必中（没掷命中骰；强制掷骰结果为 miss 仍造成伤害）
 *   T3  未命中不落地 / 落到错误的格（投掷物凭空消失或瞬移目标格）
 *   T4  墙体不阻挡弹道（穿墙命中墙后目标 / 落在墙格）
 *   T5  药水自亮没细分（非功能性药水也亮；heal_full 自创投掷残留）
 *   T6  功能性药水投掷链缺失（麻痹无气体 / 坠门无洞）
 *   T7  幻觉药水特例缺失（detect magic 照过仍不亮 / 无条件亮）
 *   T8  堆叠递减丢失（整包落地 / 整包消失）
 *   T9  射程上限缺失（无 maxDistance，投到多远都瞬移到位）
 *   S1  交互期 RNG 哨兵（零掷骰路径 / 恰 1 掷 / 恰 2 掷三条口径）
 *   W1  投掷击杀不计入武器熟悉度（CE 原样的留痕钉子——反驳 B-1a 登记①，
 *       见 b_2_throwing_report.md §与预设不符：CE hitMonsterWithProjectileWeapon
 *       根本不调 decrementWeaponAutoIDTimer，临时换手只包住 attackHit）
 *   K1  t 键引擎侧动作（throw_item 打开背包、瘫痪时被拦、不移动玩家）
 *
 * CE 权威出处：Items.c:6771-6860（命中层）/ 6862-7066（弹道层）/
 * 7072-7169（命令层）；Combat.c:149-158（attackHit）；Rogue.h:1183（THROW_KEY）。
 */
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import i18next from 'i18next';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { Item, ItemCategory } from '../engine/Items/Item';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import { TerrainType } from '../engine/Map/Grid';
import { GasType } from '../engine/Environment/Gas';
import { rng } from '../engine/Random';
import monsterDataJson from '../data/monsters.json';

const MONSTER_DATA = monsterDataJson as MonsterData[];

beforeAll(() => {
    // 与 harness 同款空资源初始化：文案走 defaultValue（英文）。
    if (!i18next.isInitialized) {
        i18next.init({
            lng: 'en',
            fallbackLng: false,
            resources: {},
            initImmediate: false,
        });
    }
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** 把 [x0,y0]..[x1,y1] 铺成 FLOOR，玩家放 (cx,cy)，清空场地怪物。 */
function prepareField(game: Game, x0: number, y0: number, x1: number, y1: number, cx: number, cy: number): void {
    for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
            game.grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
        }
    }
    game.player.loc = { x: cx, y: cy };
    game.monsters = game.monsters.filter(m => m.hasBehavior('MONST_INANIMATE'));
    game.items.length = 0; // 场地清空（背包不受影响）
    game.player.hp = game.player.maxHp;
}

function makeMonster(game: Game, id: string, x: number, y: number): Monster {
    const data = MONSTER_DATA.find(m => m.id === id);
    if (!data) throw new Error(`monsters.json 中无 ${id}`);
    const m = new Monster(x, y, data);
    game.monsters.push(m);
    return m;
}

/** 地面上的第 id 件物品（背包里的不算）。 */
function floorItem(game: Game, predicate: (i: Item) => boolean): Item | undefined {
    return game.items.find(i => predicate(i));
}

/**
 * 读怪物状态：绕开 TS 的属性收窄。T1 在 92 行 `blocker.state = ASLEEP` 之后
 * 直接写 `blocker.state === HUNTING` 会报 TS2367——TS 把属性窄成了 ASLEEP
 * 字面量，而 throwItemAt 内部（Game.ts 的 aggro 置位）对 state 的运行时改动
 * 它看不见。这是收窄假象，断言本身是对的（16/16 全绿可证）；经函数中转，
 * 返回类型还原为完整 MonsterState 联合，断言强度一字不动。
 */
function stateOf(m: Monster): MonsterState {
    return m.state;
}

describe('B-2 弹道：逐格推进，不是瞬移', () => {
    it('T1: 弹道中间的怪被命中/激怒，投掷物到不了目标格', () => {
        const game = createHeadlessGame(42, 'test');
        prepareField(game, 2, 2, 12, 8, 5, 5);
        const dart = ItemLoader.spawnWeapon('dart', -1, -1)!;
        dart.quantity = 5;
        game.player.inventory.addItem(dart);
        // 挡在 (5,5)→(9,5) 弹道正中：高血量老鼠，未瘫痪（命中骰正常掷）。
        // Monster 构造默认 ASLEEP——投掷的 aggro（CE Items.c:6791-6801，掷骰
        // 前置、miss 也激怒）必须把它推进 HUNTING。
        const blocker = makeMonster(game, 'rat', 6, 5);
        blocker.hp = 999;
        blocker.state = MonsterState.ASLEEP; // 前置：起始熟睡满血，否则 engaged 断言不具对抗性

        game.throwItemAt(dart, 9, 5);

        // 瞬移错误实现：投掷物落在 (9,5)、挡路怪毫无反应——两者都被抓
        const engaged = blocker.hp < 999 || stateOf(blocker) === MonsterState.HUNTING;
        expect(engaged, '弹道穿过了挡路怪物（无逐格推进）').toBe(true);
        expect(floorItem(game, i => i.loc.x === 9 && i.loc.y === 5),
            '投掷物瞬移到了目标格').toBeUndefined();
    });

    it('T4: 墙挡弹道——投掷物停在墙前一格，不穿墙、不落墙格', () => {
        const game = createHeadlessGame(42, 'test');
        prepareField(game, 2, 2, 12, 8, 5, 5);
        game.grid.setTerrain(7, 5, TerrainType.WALL, '#', 0x666666);
        const sword = ItemLoader.spawnWeapon('sword', -1, -1)!;
        game.player.inventory.addItem(sword);

        game.throwItemAt(sword, 9, 5);

        const landed = floorItem(game, i => i.id === sword.id);
        expect(landed, '未命中墙的剑凭空消失了').toBeDefined();
        expect([landed!.loc.x, landed!.loc.y]).toEqual([6, 5]);
    });
});

describe('B-2 命中：掷骰、未中落地', () => {
    it('T2: 命中骰存在——强制 miss 时零伤害（必中实现翻红）', () => {
        const game = createHeadlessGame(42, 'test');
        prepareField(game, 2, 2, 12, 8, 5, 5);
        const dart = ItemLoader.spawnWeapon('dart', -1, -1)!;
        dart.quantity = 5;
        game.player.inventory.addItem(dart);
        const rat = makeMonster(game, 'rat', 8, 5);
        rat.hp = 999;
        rat.defense = 50; // 防御>0 → 命中率 <100，命中骰有意义

        // 第一次 randRange 强制 99：randPercent(p<100) 必为 false → miss。
        // 弹道/落地不掷骰（S1a 口径），所以第一次就是命中骰。
        const spy = vi.spyOn(rng, 'randRange').mockReturnValueOnce(99);

        game.throwItemAt(dart, 8, 5);

        expect(spy).toHaveBeenCalled();
        expect(rat.hp, '强制 miss 仍造成伤害——命中必中，没掷命中骰').toBe(999);
    });

    it('T3: 未命中 → 投掷物落地可拾回（堆叠 -1，落地件数量 1）', () => {
        const game = createHeadlessGame(42, 'test');
        prepareField(game, 2, 2, 12, 8, 5, 5);
        const dart = ItemLoader.spawnWeapon('dart', -1, -1)!;
        dart.quantity = 5;
        game.player.inventory.addItem(dart);
        const rat = makeMonster(game, 'rat', 8, 5);
        rat.hp = 999;
        rat.defense = 50; // 命中率 <100

        vi.spyOn(rng, 'randRange').mockReturnValueOnce(99); // 强制 miss

        game.throwItemAt(dart, 8, 5);

        // 未命中的飞镖落在怪物所在格的合格落点（CE Items.c:6921 break +
        // 7058 getQualifyingLocNear；怪格本身合格时恰好落回怪格）
        expect(dart.quantity, '背包堆叠未递减').toBe(4);
        const landed = floorItem(game, i => i.category === ItemCategory.WEAPON
            && Math.abs(i.loc.x - 8) <= 1 && Math.abs(i.loc.y - 5) <= 1);
        expect(landed, '未命中的投掷物没有落地').toBeDefined();
        expect(landed!.quantity, '落地件应为单件').toBe(1);
    });
});

describe('B-2 药水：功能性细分与幻觉特例', () => {
    it('T5: 非功能性药水碎裂不亮、无效果（heal_full 满血残留分支翻红）', () => {
        const game = createHeadlessGame(42, 'test');
        prepareField(game, 2, 2, 12, 8, 5, 5);
        const potion = ItemLoader.spawnPotion('potion_of_life', -1, -1)!;
        game.player.inventory.addItem(potion);
        const rat = makeMonster(game, 'rat', 6, 5);
        rat.hp = 3; // 若 heal_full 残留分支还在，满血会救活它

        game.throwItemAt(potion, 8, 5);

        // CE Items.c:6951-7046：healing 类不在功能性 7 种里——碎裂无害、不自亮
        expect(ItemLoader.identifiedItems.has('potion_of_life'),
            '非功能性药水碎裂被识别（"全部亮"简化未反转）').toBe(false);
        expect(rat.hp, 'heal_full 投掷残留分支仍在（CE 无此投掷效果）').toBe(3);
        expect(floorItem(game, i => i.category === ItemCategory.POTION),
            '碎裂的药水不应留在地上').toBeUndefined();
    });

    it('T6: 麻痹药水碎裂亮种类 + 麻痹气云；坠门药水碎裂亮种类 + 铺洞', () => {
        const game = createHeadlessGame(42, 'test');
        prepareField(game, 2, 2, 12, 8, 5, 5);
        const para = ItemLoader.spawnPotion('potion_of_paralysis', -1, -1)!;
        game.player.inventory.addItem(para);
        game.throwItemAt(para, 8, 5);
        expect(ItemLoader.identifiedItems.has('potion_of_paralysis'),
            '功能性药水（麻痹）碎裂未 autoIdentify').toBe(true);
        const gas = game.environment.gasGrid[8]?.[5];
        expect(gas?.density ?? 0, '麻痹气云未铺到碎裂点').toBeGreaterThan(0);
        expect(gas?.type, '铺的不是麻痹气').toBe(GasType.PARALYSIS);

        const game2 = createHeadlessGame(42, 'test');
        prepareField(game2, 2, 2, 12, 8, 5, 5);
        const descent = ItemLoader.spawnPotion('potion_of_descent', -1, -1)!;
        game2.player.inventory.addItem(descent);
        game2.throwItemAt(descent, 8, 5);
        expect(ItemLoader.identifiedItems.has('potion_of_descent'),
            '功能性药水（坠门）碎裂未 autoIdentify').toBe(true);
        const cell = game2.grid.getCell(8, 5)!;
        expect([TerrainType.HOLE_EDGE, TerrainType.HOLE]).toContain(cell.terrain);
    });

    it('T7: 幻觉药水特例——默认不亮；实例被 detect magic 照过则亮', () => {
        const game = createHeadlessGame(42, 'test');
        prepareField(game, 2, 2, 12, 8, 5, 5);
        const hall1 = ItemLoader.spawnPotion('potion_of_hallucination', -1, -1)!;
        game.player.inventory.addItem(hall1);
        game.throwItemAt(hall1, 8, 5);
        expect(ItemLoader.identifiedItems.has('potion_of_hallucination'),
            '幻觉药水未达成特例也被亮（应 splashes harmlessly）').toBe(false);

        const game2 = createHeadlessGame(42, 'test');
        prepareField(game2, 2, 2, 12, 8, 5, 5);
        const hall2 = ItemLoader.spawnPotion('potion_of_hallucination', -1, -1)!;
        hall2.magicDetected = true; // CE ITEM_MAGIC_DETECTED（B-1c 字段）
        game2.player.inventory.addItem(hall2);
        game2.throwItemAt(hall2, 8, 5);
        expect(ItemLoader.identifiedItems.has('potion_of_hallucination'),
            'detect magic 照过的幻觉药水碎裂应 autoIdentify').toBe(true);
    });

    it('登记钉子：POTION_DARKNESS 在 web 无载体（b_2 报告载体盘点表）', () => {
        expect(ItemLoader.potions.find(p => p.id === 'potion_of_darkness')).toBeUndefined();
    });
});

describe('B-2 数量与射程', () => {
    it('T8: 堆叠投掷递减 1，不得整包消失/整包落地', () => {
        const game = createHeadlessGame(42, 'test');
        prepareField(game, 2, 2, 12, 8, 5, 5);
        const dart = ItemLoader.spawnWeapon('dart', -1, -1)!;
        dart.quantity = 15;
        game.player.inventory.addItem(dart);

        game.throwItemAt(dart, 8, 5); // 空地，未命中任何怪 → 落地

        expect(dart.quantity, '堆叠应只剩 14').toBe(14);
        expect(game.player.inventory.items.includes(dart), '背包件不得被移出').toBe(true);
        const landed = floorItem(game, i => i.id !== dart.id && i.category === ItemCategory.WEAPON);
        expect(landed, '落地件缺失').toBeDefined();
        expect(landed!.quantity).toBe(1);
    });

    it('T9: 射程上限 maxDistance——力 12 射 16 格，超远程目标够不着', () => {
        const game = createHeadlessGame(42, 'test');
        prepareField(game, 2, 2, 34, 9, 5, 5);
        expect(game.player.strength).toBe(12); // maxDistance = 12+2*max(12-12,2) = 16
        const dart = ItemLoader.spawnWeapon('dart', -1, -1)!;
        dart.quantity = 100;
        game.player.inventory.addItem(dart);

        game.throwItemAt(dart, 30, 5); // 直线距离 25 > 16

        // 弹道第 16 格是 (21,5)：投掷物必须停在其附近，绝不能到 (30,5)
        expect(floorItem(game, i => i.loc.x === 30 && i.loc.y === 5),
            '投掷物无视射程上限瞬移到目标格').toBeUndefined();
        const landed = floorItem(game, i => i.category === ItemCategory.WEAPON && i.id !== dart.id);
        expect(landed, '投掷物消失了').toBeDefined();
        expect(landed!.loc.x, '落点应被 maxDistance 截在 16 格内').toBeLessThanOrEqual(22);
    });
});

describe('B-2 熟悉度（CE 反驳的留痕钉子，W1）', () => {
    it('W1: 投掷击杀不消耗任何武器熟悉度（CE hitMonsterWithProjectileWeapon 不调 decrementWeaponAutoIDTimer）', () => {
        const game = createHeadlessGame(42, 'test');
        prepareField(game, 2, 2, 12, 8, 5, 5);
        // 装备剑：1 杀即亮（熟悉度计数 1）——若错误实现把投掷击杀接进
        // decrementWeaponAutoIDTimer（B-1a 登记①），这一下就会翻红
        const sword = ItemLoader.spawnWeapon('sword', -1, -1)!;
        sword.charges = 1;
        sword.identified = false;
        game.player.equip(sword);
        game.player.inventory.addItem(sword);
        // 投掷物：飞镖堆也带熟悉度计数（CE Items.c:275）
        const dart = ItemLoader.spawnWeapon('dart', -1, -1)!;
        dart.quantity = 5;
        dart.charges = 20;
        game.player.inventory.addItem(dart);
        const rat = makeMonster(game, 'rat', 6, 5);
        rat.hp = 1; // 投掷必杀（伤害 2-4）

        game.throwItemAt(dart, 6, 5);

        expect(rat.hp, '测试前提：投掷应已击杀').toBeLessThanOrEqual(0);
        expect(sword.charges, '装备武器的熟悉度被投掷击杀消耗（CE 无此机制）').toBe(1);
        expect(sword.identified, '装备武器因投掷击杀被亮（CE 无此机制）').toBe(false);
        expect(dart.charges, '投掷物自己的熟悉度被消耗（CE 无此机制）').toBe(20);
    });
});

describe('B-2 键位引擎侧（K1）', () => {
    it('K1: throw_item 动作打开背包；不移动玩家', () => {
        const game = createHeadlessGame(42, 'test');
        prepareField(game, 2, 2, 9, 9, 5, 5);
        expect(game.isInventoryOpen).toBe(false);

        game.handlePlayerAction('throw_item', undefined, 'system');

        expect(game.isInventoryOpen, 'throw_item 未打开背包（接错动作）').toBe(true);
        expect(game.player.loc).toEqual({ x: 5, y: 5 });
    });

    it('K1b: 瘫痪时 throw_item 被拦（CE 瘫痪不能投掷）', () => {
        const game = createHeadlessGame(42, 'test');
        prepareField(game, 2, 2, 9, 9, 5, 5);
        game.player.setStatusDuration('paralyzed', 3);

        game.handlePlayerAction('throw_item', undefined, 'system');

        expect(game.isInventoryOpen, '瘫痪时仍打开了投掷入口').toBe(false);
    });
});

describe('S1: 交互期 RNG 哨兵（B-2 §四硬门禁）', () => {
    /**
     * 口径（project_conventions「generation_baseline 对交互期掷骰是盲的」）：
     * generation_baseline 只覆盖建局+生成期；投掷是交互期行为，另立增量哨兵。
     * 场地手工构造（prepareField/spawnWeapon 在计数起点之前完成所有 setup
     * 掷骰），增量只对"投掷路径本身消耗了几颗骰子"敏感：
     *   S1a 药水碎裂路径：全程 0 掷（无命中骰、无伤害骰、无血迹骰）；
     *   S1b 麻痹目标自动命中（attackHit 免掷）：恰 2 掷 = 伤害骰 + 血迹骰
     *       （spawnBlood 的 randPercent(60) 掷在 SUBSTANTIVE 流上）；
     *   S1c 防御 0 的正常目标（命中率恒 100，结果确定不用 mock）：恰 3 掷 =
     *       命中骰 + 伤害骰 + 血迹骰。
     * 教训（本轮实测）：不能用 vi.spyOn(...).mockReturnValueOnce 强造命中——
     * mock 替换掉真实实现后那次调用【不计数】，会把口径悄悄弄脏。
     * 反向验证见报告 RV4：往弹道循环注入一次 randPercent 即翻红。
     */
    it('S1a: 药水投掷碎裂全程零掷骰', () => {
        const game = createHeadlessGame(42, 'test');
        prepareField(game, 2, 2, 12, 8, 5, 5);
        const potion = ItemLoader.spawnPotion('potion_of_life', -1, -1)!;
        game.player.inventory.addItem(potion);

        const c0 = rng.randomNumbersGenerated;
        game.throwItemAt(potion, 8, 5);
        expect(rng.randomNumbersGenerated - c0,
            '药水投掷路径多消耗了掷骰（CE 全程 0 掷）').toBe(0);
    });

    it('S1b: 麻痹目标（自动命中）恰消耗 2 掷——伤害骰+血迹骰', () => {
        const game = createHeadlessGame(42, 'test');
        prepareField(game, 2, 2, 12, 8, 5, 5);
        const dart = ItemLoader.spawnWeapon('dart', -1, -1)!;
        dart.quantity = 5;
        game.player.inventory.addItem(dart);
        const rat = makeMonster(game, 'rat', 6, 5);
        rat.hp = 1; // 一击毙命：死怪不行动，怪的回合零掷骰，口径纯净
        rat.setStatusDuration('paralyzed', 5);

        const c0 = rng.randomNumbersGenerated;
        game.throwItemAt(dart, 6, 5);
        // 口径组成：伤害骰 1（auto-hit 免命中骰）+ spawnBlood 的 randPercent(60) 1
        //（web 命中反馈掷在 SUBSTANTIVE 流上）。mock 不参与计数窗口。
        expect(rng.randomNumbersGenerated - c0,
            '自动命中路径应恰消耗伤害骰+血迹骰共 2 颗（多掷=流位移，少掷=骰丢失）').toBe(2);
    });

    it('S1c: 正常目标（必中）恰消耗 3 掷——命中骰+伤害骰+血迹骰', () => {
        const game = createHeadlessGame(42, 'test');
        prepareField(game, 2, 2, 12, 8, 5, 5);
        const dart = ItemLoader.spawnWeapon('dart', -1, -1)!;
        dart.quantity = 5;
        game.player.inventory.addItem(dart);
        const rat = makeMonster(game, 'rat', 6, 5);
        rat.hp = 1; // 一击毙命，同 S1b
        rat.defense = 0; // defenseFraction(0)=1 → 命中率恒 100：掷骰必中、结果确定

        const c0 = rng.randomNumbersGenerated;
        game.throwItemAt(dart, 6, 5);
        // 口径组成：命中骰 1（randPercent(100) 也消耗）+ 伤害骰 1 + 血迹骰 1。
        // 不用 mock 强制命中——被 mock 的调用不走真实实现、不计数，会把口径弄脏。
        expect(rng.randomNumbersGenerated - c0,
            '正常命中路径应恰消耗命中骰+伤害骰+血迹骰共 3 颗').toBe(3);
    });
});

