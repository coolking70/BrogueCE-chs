/**
 * src/test/ui_2_protection.test.ts — UI-2（isProtected 其余三个 CE 消费点）验收
 *
 * 三件事（来源：i-1_report.md「遗留与登记」第 1/4 条；CE 均已逐字核对）：
 *   1. 武器降级（CE Combat.c:1432-1450）：玩家近战命中 MONST_DEFEND_DEGRADE_WEAPON
 *      防守方后，不带保护的武器附魔 -1 + "weakens" 消息 + 投掷武器 quiverNumber
 *      重掷；带保护完全跳过、无消息。web 落点：Game.resolvePlayerMeleeAttackOn
 *     （普通近战/鞭/矛几何共用的玩家结算出口，对应 CE attack() 命中支尾部）。
 *   2. 物品栏 } 括号（CE Items.c:3629/3641）：受保护物品闭括号 ) → }。
 *      web 落点：InventoryOverlay.vue 模板——无组件挂载基建，沿用 b_1a/ui_1 的
 *      readFileSync 静态守卫模式。
 *   3. 详情「不会被酸液腐蚀。」（CE Items.c:2394-2400）：受保护装备详情行；
 *      CE 该块在武器/护甲 if-else **之外**，两类装备都显示。
 *
 * 对抗性设计：每条 it 注释写明它打红的具体错误实现。
 * 必中配置：防守方 defense = -10000——defenseFraction = 0.987^d 对负防御指数
 * 爆炸、hitProbability 钳 100，对任意武器附魔（accuracyFraction = 1.065^e 恒正）
 * 都必中，不依赖掷骰。每条用例先断言"命中确实发生"（目标掉血），
 * 排除"豁免看似生效其实是没打中"的假绿（I-1 同款要求）。
 *
 * ⚠️ 下界口径：CE 字面是 `enchant1 >= -10`（含等号）——-10 仍会再降到 -11，
 * -11 才停。任务书测试条款②写"已降到 −10 的武器不再继续降"，与 CE 字面冲突，
 * 按验收反驳条款以 CE 为准（见 ui-2 报告「对任务书的反驳」）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import i18next from 'i18next';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import { TerrainType } from '../engine/Map/Grid';
import { Item, ItemCategory } from '../engine/Items/Item';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { CombatSystem } from '../engine/Combat/Combat';
import { generateItemDetail, generateMonsterDetail, type DetailInfo } from '../engine/UI/DetailGenerator';
import monsterDataJson from '../data/monsters.json';
import { logger } from '../engine/Systems/Logger';

// 与 src/test/harness.ts / DetailGenerator.test.ts 相同的最小 i18n 初始化（幂等）：
// 第 3 件用例不经 createHeadlessGame 直接 new Monster（构造器 translateName 需要）。
if (!i18next.isInitialized) {
    i18next.init({
        lng: 'en',
        fallbackLng: false,
        resources: {},
        initImmediate: false,
    });
}

const MONSTER_DATA = monsterDataJson as MonsterData[];

function monsterDataById(id: string): MonsterData {
    const row = MONSTER_DATA.find(m => m.id === id);
    if (!row) throw new Error(`monsters.json 中找不到 ${id}`);
    return row;
}

function priv(game: Game): any {
    return game as any;
}

/** 空房：玩家 (4,5)，地板 2..24 × 2..14（i-1 同款）。 */
function carveBigRoom(game: Game): void {
    game.monsters.length = 0;
    game.items.length = 0;
    for (let x = 1; x < 30; x++) {
        for (let y = 1; y < 20; y++) {
            game.grid.setTerrain(x, y, TerrainType.WALL, '#', 0x444444);
        }
    }
    for (let x = 2; x <= 24; x++) {
        for (let y = 2; y <= 14; y++) {
            game.grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
            const cell = game.grid.getCell(x, y);
            if (cell) cell.isVisible = true;
        }
    }
    game.player.loc.x = 4;
    game.player.loc.y = 5;
    game.player.hp = game.player.maxHp = 200;
}

/**
 * 武器降级靶子：acid_mound（monsters.json 中两个
 * MONST_DEFEND_DEGRADE_WEAPON 载体之一，无 MA_CLONE_SELF_ON_DEFEND，
 * 不会被分裂噪音污染断言）。保留既有默认夹具；CE 钳负防御为零，
 * 本次获裁决的四条用例在各自场景中显式设置 captive 必中。
 */
function spawnDegrader(game: Game, x: number, y: number): Monster {
    const mound = new Monster(x, y, monsterDataById('acid_mound'));
    mound.defense = -10000;
    mound.state = MonsterState.HUNTING;
    game.monsters.push(mound);
    return mound;
}

/** 造一把素剑并装到手上（生成器会掷附魔，这里显式覆盖，保证断言基线确定）。 */
function equipPlainSword(game: Game, enchantment: number): Item {
    const sword = ItemLoader.spawnWeapon('sword', game.player.loc.x, game.player.loc.y, game.depth)!;
    sword.enchantment = enchantment;
    sword.isProtected = false;
    game.player.equippedWeapon = sword;
    return sword;
}

function allTexts(): string {
    return logger.messages.map(m => m.text).join('\n');
}

function allLines(detail: DetailInfo): string[] {
    return detail.sections.flatMap((s) => s.lines.map((l) => l.text));
}

// ---------------------------------------------------------------------------
// 第 1 件：武器降级（CE Combat.c:1432-1450）
// ---------------------------------------------------------------------------
describe('UI-2 第 1 件：武器降级（CE Combat.c:1432-1450，web 落点 resolvePlayerMeleeAttackOn）', () => {
    it('不带保护的武器被酸怪命中后附魔 -1、有 "weakens" 消息（行为终点）', () => {
        // 打红的错误实现：①机制整体缺失（=本轮改前的 web）；②降级写成 -2 或
        // 写到 miss 分支；③消息键漏配。
        const game = createHeadlessGame(4201);
        carveBigRoom(game);
        const sword = equipPlainSword(game, 0);

        const mound = spawnDegrader(game, 5, 5); // 玩家 (4,5) 正右方
        priv(game).resolvePlayerMeleeAttackOn(mound);

        expect(mound.hp).toBeLessThan(mound.maxHp); // 命中确实发生（排除"没打中"假绿）
        expect(sword.enchantment).toBe(-1); // CE enchant1--，恰好一点
        expect(allTexts()).toContain('weakens'); // CE "your %s weakens!"（harness 走 defaultValue）
    });

    it('带保护的武器完全跳过：附魔不动、无消息，但命中照样发生', () => {
        // 打红的错误实现：①豁免条件缺失（带保护照样降）；②把豁免写反成
        // "只有带保护才降"；③用"没打中"冒充豁免生效（本条先断言掉血）。
        const game = createHeadlessGame(4202);
        carveBigRoom(game);
        const sword = equipPlainSword(game, 0);
        sword.isProtected = true;

        const mound = spawnDegrader(game, 5, 5);
        Object.assign(mound, { defense: 0, isCaged: true }); // CE MB_CAPTIVE：自动命中，不增加偷袭倍率。
        priv(game).resolvePlayerMeleeAttackOn(mound);

        expect(mound.hp).toBeLessThan(mound.maxHp); // 命中发生——豁免不是 miss
        expect(sword.enchantment).toBe(0); // CE：带保护完全跳过
        expect(allTexts()).not.toContain('weakens'); // 无任何消息
    });

    it('下界照 CE 字面 enchant1 >= -10：-10 仍降到 -11，-11 才停', () => {
        // 打红的错误实现：把下界写成 `> -10`（任务书条款②的误读——那样 -10
        // 就停，永远到不了 CE 允许的 -11）。
        // 场景 A：-10 → 再降一次到 -11
        const gameA = createHeadlessGame(4203);
        carveBigRoom(gameA);
        const swordA = equipPlainSword(gameA, -10);
        const moundA = spawnDegrader(gameA, 5, 5);
        Object.assign(moundA, { defense: 0, isCaged: true }); // CE captive 短路，不依赖负防御。
        priv(gameA).resolvePlayerMeleeAttackOn(moundA);
        expect(moundA.hp).toBeLessThan(moundA.maxHp);
        expect(swordA.enchantment).toBe(-11);

        // 场景 B：-11 → 不再降
        const gameB = createHeadlessGame(4204);
        carveBigRoom(gameB);
        const swordB = equipPlainSword(gameB, -11);
        const moundB = spawnDegrader(gameB, 5, 5);
        Object.assign(moundB, { defense: 0, isCaged: true });
        priv(gameB).resolvePlayerMeleeAttackOn(moundB);
        expect(moundB.hp).toBeLessThan(moundB.maxHp);
        expect(swordB.enchantment).toBe(-11);
    });

    it('quiverNumber 非零时重掷为 [1,60000]（CE :1436-1438，投掷武器的口径）', () => {
        // 打红的错误实现：①漏掉重掷；②重掷范围写错（如 [0,59999]）；
        // ③无条件重掷（quiverNumber 为 0/未定义的近战武器不该掷——CE 条件收在
        // `if (rogue.weapon->quiverNumber)` 里）。
        const game = createHeadlessGame(4205);
        carveBigRoom(game);
        const sword = equipPlainSword(game, 0);
        // 近战剑本无 quiverNumber，此处显式置值以驱动 CE 的重掷支
        //（机制本身按 CE 条件收在非零检查内，见下一方向的负例——徒手/零值不掷）。
        sword.quiverNumber = 999;

        const mound = spawnDegrader(game, 5, 5);
        Object.assign(mound, { defense: 0, isCaged: true }); // CE captive 短路，保留 quiver 重掷断言。
        priv(game).resolvePlayerMeleeAttackOn(mound);

        expect(mound.hp).toBeLessThan(mound.maxHp);
        expect(sword.quiverNumber).not.toBe(999);
        expect(sword.quiverNumber).toBeGreaterThanOrEqual(1);
        expect(sword.quiverNumber).toBeLessThanOrEqual(60000);
    });

    it('quiverNumber 为零值时不掷骰、保持未定义；徒手（无武器）不降级不炸', () => {
        // 打红的错误实现：把重掷写成无条件（近战武器也吃 RNG——白移交互期
        // 随机流）；以及 weapon 空守卫缺失（bare hands 直接崩或误降"手"）。
        const game = createHeadlessGame(4206);
        carveBigRoom(game);
        const sword = equipPlainSword(game, 0);
        sword.quiverNumber = undefined;

        const mound = spawnDegrader(game, 5, 5);
        // U03b: this tests the on-hit quiver gate, independent of generation RNG.
        Object.assign(mound, { defense: 0, isCaged: true });
        priv(game).resolvePlayerMeleeAttackOn(mound);
        expect(mound.hp).toBeLessThan(mound.maxHp);
        expect(sword.enchantment).toBe(-1);
        expect(sword.quiverNumber).toBeUndefined(); // 零值：CE 不进重掷支

        // 徒手：rogue.weapon 为空 → CE 整块跳过
        const game2 = createHeadlessGame(4207);
        carveBigRoom(game2);
        game2.player.equippedWeapon = null;
        const mound2 = spawnDegrader(game2, 5, 5);
        Object.assign(mound2, { defense: 0, isCaged: true });
        expect(() => priv(game2).resolvePlayerMeleeAttackOn(mound2)).not.toThrow();
        expect(mound2.hp).toBeLessThan(mound2.maxHp);
        expect(allTexts()).not.toContain('weakens');
    });

    it('目标被这一击打死时降级照常发生（CE 该块在命中支尾部，不吃目标存活条件）', () => {
        // 打红的错误实现：把降级挂进"目标存活"分支（CE 的降级只看命中，
        // 击杀不豁免—— inflictedDamage 在 attack() 内更早发生）。
        const game = createHeadlessGame(4208);
        carveBigRoom(game);
        const sword = equipPlainSword(game, 0);

        const mound = spawnDegrader(game, 5, 5);
        Object.assign(mound, { defense: 0, isCaged: true }); // CE captive 短路，保证进入击杀腐蚀分支。
        mound.hp = 1; // 保底一击毙命
        priv(game).resolvePlayerMeleeAttackOn(mound);

        expect(mound.hp).toBeLessThanOrEqual(0); // 确实死了
        expect(sword.enchantment).toBe(-1); // 歽杀照样降
        expect(allTexts()).toContain('weakens');
    });

    it('投掷路径不降级（CE 该块只在近战 attack()，hitMonsterWithProjectileWeapon 无此逻辑）', () => {
        // 打红的错误实现：把降级塞进共享命中核心/投掷结算——投掷物在 CE 里
        // 不因命中酸怪而磨损。
        const game = createHeadlessGame(4209);
        carveBigRoom(game);
        const sword = equipPlainSword(game, 0);

        const mound = spawnDegrader(game, 5, 5);
        const res = CombatSystem.resolveThrownWeapon(game.player, mound, sword);
        expect(res.hit).toBe(true); // defense -10000 必中
        expect(sword.enchantment).toBe(0); // 投掷不降
        expect(allTexts()).not.toContain('weakens');
    });
});

// ---------------------------------------------------------------------------
// 第 2 件：物品栏 } 括号（CE Items.c:3629/3641，静态守卫）
// ---------------------------------------------------------------------------
describe('UI-2 第 2 件：物品栏受保护物品闭括号 }（CE Items.c:3629/3641）', () => {
    const overlaySrc = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '..', 'components', 'InventoryOverlay.vue'),
        'utf-8'
    );

    it('闭括号按 isProtected 取 } / )（模板接线守卫）', () => {
        // 打红的错误实现：回退成硬编码 `)`（=本轮改前），或只写 } 丢掉未保护
        // 的 ) 分支（未保护物品也变 }）。
        expect(overlaySrc).toMatch(/entry\.item\.isProtected \? '\}' : '\)'/);
        // 旧形态退场守卫：不再存在 `{{ entry.letter }})` 硬编码
        expect(overlaySrc).not.toMatch(/\{\{ entry\.letter \}\}\)/);
    });
});

// ---------------------------------------------------------------------------
// 第 3 件：详情「不会被酸液腐蚀。」（CE Items.c:2394-2400）
// ---------------------------------------------------------------------------
describe('UI-2 第 3 件：受保护装备详情行（CE Items.c:2394-2400）', () => {
    it('受保护护甲详情含「不会被酸液腐蚀。」；未受保护不含（prompt 测试条款④）', () => {
        // 打红的错误实现：条件写反 / 忘接 isProtected（改前 web 无此行）。
        const armor = new Item('Leather Armor', '[', 0xffffff, ItemCategory.ARMOR);
        armor.armor = 3;
        armor.isProtected = true;
        const lines = allLines(generateItemDetail(armor, 12));
        const hit = lines.filter(t => t.includes('不会被酸液腐蚀。'));
        expect(hit).toHaveLength(1); // 恰一行
        expect(hit[0]).toContain(armor.displayName); // CE：theName + 不会被酸液腐蚀。

        armor.isProtected = false;
        expect(allLines(generateItemDetail(armor, 12)).some(t => t.includes('不会被酸液腐蚀。'))).toBe(false);
    });

    it('受保护武器同样显示（CE 该块在武器/护甲 if-else 之外，两类都出）', () => {
        // 打红的错误实现：只加进护甲段、漏武器段（CE 的 // protected? 块
        // 不在类别分支里——protect_weapon 卷轴保护的是武器）。
        const sword = new Item('Short Sword', '(', 0xffffff, ItemCategory.WEAPON);
        sword.damage = '2d6';
        sword.isProtected = true;
        const lines = allLines(generateItemDetail(sword, 12));
        expect(lines.some(t => t.includes('不会被酸液腐蚀。'))).toBe(true);
    });

    it('假文案清算：MONST_DEFEND_DEGRADE_WEAPON 的词条与机制一致——数据载体在详情面板有词条且恰两条', () => {
        // prompt 测试条款⑤（实现侧：保留文案）。打红的错误实现：①机制回了
        // 退但文案还在（面板承诺不存在的机制）；②monsters.json 丢载体导致
        // 词条与旗标脱钩。每只载体怪的面板必须显示"被击中时会腐蚀武器"，
        // 且全库恰两条载体（数据侧新增/删除时此断言应当被有意识地更新）。
        const carriers = MONSTER_DATA.filter(m =>
            (m.behaviorFlags as string[]).includes('MONST_DEFEND_DEGRADE_WEAPON'));
        expect(carriers.map(m => m.id)).toEqual(['acid_mound', 'acidic_jelly']);

        for (const row of carriers) {
            const mon = new Monster(1, 1, row);
            const text = allLines(generateMonsterDetail(mon, 100, 12, 0, null, 0, 0)).join('\n');
            expect(text).toContain('被击中时会腐蚀武器');
        }
    });
});
