/**
 * src/test/b_1_weapon_specials.test.ts — B-1：匕首背刺 / 刺剑突进与双速 / 连枷移动攻击
 *
 * 对照 CE 源码（见 ai_docs/b_1_weapon_specials_report.md）：
 *   - 旗标赋予      Items.c:209-236（DAGGER→SNEAK_ATTACK_BONUS，
 *                   RAPIER→QUICKLY|LUNGE，FLAIL→PASS）
 *   - 偷袭倍率      Combat.c:1190-1196（四触发源：sneakAttack=WANDERING 目标 /
 *                   asleep / paralyzed / lungeAttack；MONST_INANIMATE 清零）+
 *                   Combat.c:1239（触发集整体自动命中）+ Combat.c:1259-1268
 *                   （匕首 ×5，否则通用 ×3；只乘一次）
 *   - 符文翻倍集    Combat.c:1419-1421（只收 sneakAttack||asleep||paralyzed，
 *                   不含 lungeAttack）
 *   - 攻速分支      Time.c:2439-2452（STAGGER 且命中 > QUICKLY > 普通）
 *   - 突进          Movement.c:1368-1391（只看移动方向两格之外那一格）+
 *                   :1480-1492（先移动后攻击，hitList[0] 非空才收攻击恢复）
 *   - 连枷          buildFlailHitList Movement.c:1025-1048（★与移动前、移动后
 *                   两格都相邻；distanceBetween = Chebyshev，Monsters.c:1341-1343）
 *
 * 对抗性测试与"能捕获的具体错误实现"逐条标注在每个 it() 前的注释里；
 * 反向验证（真实改坏代码、跑出失败、贴输出、再还原）见报告。
 *
 * 确定性口径（沿用 p4_7）：玩家力量=武器需求 → netEnchant=0；敌人 defense=0
 * 时玩家 100 accuracy 必中；defense=300 时命中率 ≈ 2.2%（0.9874^300），
 * 用于自动命中的强断言。武器伤害骰经 rng 种子确定：
 *   dagger  1d2+2 → raw 3..4（×5 → 15/20；若误 ×3 → 9/12）
 *   rapier  1d3+2 → raw 3..5（×3 → 9/12/15；若误 ×5 → 15/20/25）
 *   sword   1d3+6 → raw 7..9（×3 → 21/24/27；若误 ×5 → 35/40/45）
 *   sword×3 的 21/24/27 与 dagger×5 的 15/20 均 ∉ 对方集合——伤害值域互相钳制。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import { TerrainType } from '../engine/Map/Grid';
import { logger } from '../engine/Systems/Logger';
import { timeSystem } from '../engine/Systems/Time';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { Item, ItemCategory } from '../engine/Items/Item';
import weaponsDataJson from '../data/weapons.json';
import monsterDataJson from '../data/monsters.json';

const WEAPONS = weaponsDataJson as Array<{
    id: string;
    flags?: string[];
    strengthRequired: number;
    damage: string;
    weight: number;
}>;

const MONSTER_DATA = monsterDataJson as MonsterData[];

function monsterDataById(id: string): MonsterData {
    const row = MONSTER_DATA.find(m => m.id === id);
    if (!row) throw new Error(`monsters.json 中找不到 ${id}`);
    return row;
}

function clearToOpenRoom(game: Game): void {
    game.monsters.length = 0;
    game.items.length = 0;
    for (let x = 1; x < 30; x++) {
        for (let y = 1; y < 20; y++) {
            game.grid.setTerrain(x, y, TerrainType.WALL, '#', 0x444444);
        }
    }
    for (let x = 2; x <= 16; x++) {
        for (let y = 2; y <= 12; y++) {
            game.grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
            const cell = game.grid.getCell(x, y);
            if (cell) cell.isVisible = true;
        }
    }
    game.player.loc.x = 4;
    game.player.loc.y = 5;
    game.player.maxHp = 500;
    game.player.hp = 500;
    game.player.equippedArmor = null;
}

/** 经真实装载链路（spawnWeapon）装备武器并清随机附魔/符文；力量=需求 → 必中。 */
function equip(game: Game, id: string): void {
    const row = WEAPONS.find(w => w.id === id);
    if (!row) throw new Error(`weapons.json 中找不到 ${id}`);
    const item = ItemLoader.spawnWeapon(id, -1, -1);
    if (!item) throw new Error(`spawnWeapon(${id}) 失败`);
    item.enchantment = 0;
    item.isCursed = false;
    item.runicType = undefined;
    game.player.equippedWeapon = item;
    game.player.strength = row.strengthRequired;
}

/** 手工 crafting 一把多旗标武器（测试分支优先级用，数据里不存在双旗标武器）。 */
function equipCrafted(game: Game, flags: string[]): void {
    const item = new Item('Test Blade', ')', 0xcccccc, ItemCategory.WEAPON);
    item.damage = '1d1';
    item.strengthRequired = 0;
    item.enchantment = 0;
    item.flags = [...flags];
    game.player.equippedWeapon = item;
    game.player.strength = 12;
}

function spawnEnemy(game: Game, id: string, x: number, y: number, patch: Partial<MonsterData> = {}): Monster {
    const det = { accuracy: 200, damage: '1d1', hp: 500, defense: 0 } as Partial<MonsterData>;
    const m = new Monster(x, y, { ...monsterDataById(id), ...det, ...patch } as MonsterData);
    m.state = MonsterState.HUNTING;
    game.monsters.push(m);
    return m;
}

function spawnAlly(game: Game, id: string, x: number, y: number, patch: Partial<MonsterData> = {}): Monster {
    const m = spawnEnemy(game, id, x, y, { accuracy: 0, ...patch });
    m.isAlly = true;
    return m;
}

function move(game: Game, dx: number, dy: number): void {
    game.handlePlayerAction('move', { x: dx, y: dy }, 'system');
}

function countHitsYou(baseline: number): number {
    return logger.messages.slice(baseline).filter(m => m.text.includes('hits you')).length;
}

/**
 * 窃取 playerRecoversFromAttacking 的恢复量（private 方法，测试只观察不绕过：
 * 包装后仍调原实现，记录调用后 ticksUntilTurn 的瞬时值——攻击前恒为 0，
 * 瞬时值即本次恢复量）。用于攻速分支的逐 tick 精确断言。
 */
function spyRecovery(game: Game): number[] {
    const rec: number[] = [];
    const orig = (game as any).playerRecoversFromAttacking.bind(game);
    (game as any).playerRecoversFromAttacking = (hit: boolean) => {
        orig(hit);
        rec.push(game.player.ticksUntilTurn);
    };
    return rec;
}

// ---------------------------------------------------------------------------
// 匕首：ITEM_SNEAK_ATTACK_BONUS —— 偷袭触发集 ×5，否则通用 ×3
// ---------------------------------------------------------------------------
describe('B-1 匕首背刺（ITEM_SNEAK_ATTACK_BONUS）', () => {
    it('对抗性【匕首偷袭写成 ×3】：熟睡目标挨匕首必须 ×5 —— 5 个种子的伤害全部' +
        '∈ {15,20}（raw 3/4）。写成 ×3 的实现在 raw=3 的种子上给 9 → 在这里翻车。', () => {
        const damages: number[] = [];
        for (const seed of [8801, 8802, 8803, 8804, 8805]) {
            const game = createHeadlessGame(seed);
            clearToOpenRoom(game);
            equip(game, 'dagger');
            const foe = spawnEnemy(game, 'rat', 5, 5);
            foe.state = MonsterState.ASLEEP;
            const fBefore = foe.hp;
            move(game, 1, 0);
            expect(foe.hp).toBeLessThan(fBefore);      // 偷袭自动命中
            damages.push(fBefore - foe.hp);
        }
        // 关键断言：每一击都是 ×5。raw∈{3,4} → ×5 = {15,20}；×3 = {9,12}。
        for (const d of damages) {
            expect(d, `种子伤害 ${d} 不是匕首 ×5（允许 15/20）`).toBeOneOf([15, 20]);
        }
        expect(damages).toContain(15);                 // 两种 raw 都出现过，钳死倍率
        expect(damages).toContain(20);
    });

    it('对抗性【普通武器也 ×5 / 匕首无差别 ×5】：匕首打清醒 HUNTING 目标必须' +
        '零倍率 —— 伤害恰为 raw {3,4}；"×5 全局生效"的实现给 15/20 → 在这里翻车。', () => {
        for (const seed of [8811, 8812, 8813, 8814, 8815]) {
            const game = createHeadlessGame(seed);
            clearToOpenRoom(game);
            equip(game, 'dagger');
            const foe = spawnEnemy(game, 'rat', 5, 5); // HUNTING：无任何偷袭触发
            const fBefore = foe.hp;
            move(game, 1, 0);
            expect(foe.hp).toBeLessThan(fBefore);
            const d = fBefore - foe.hp;
            expect(d, `种子伤害 ${d} 应为匕首 raw 伤害 3/4（清醒目标无倍率）`)
                .toBeOneOf([3, 4]);
        }
    });

    it('对照组【普通武器熟睡目标仍 ×3】：剑打熟睡目标伤害 ∈ {21,24,27} 且都' +
        '不被 5 整除 —— 匕首旗标泄漏到普通武器（×5）的实现给 35/40/45 → 在这里翻车。', () => {
        const damages: number[] = [];
        // 验收方 C-2 后扩样：原为 5 个连号种子，C-2 移动生成期 RNG 流后它们
        // 恰好全部给出同一伤害值，第 201 行"至少 2 种取值"的多样性辅助断言翻红。
        // 核心断言（∈{21,24,27} 且不被 5 整除）始终成立——这是取样脆弱，不是回归。
        for (const seed of [8821, 8822, 8823, 8824, 8825,
                            8831, 8832, 8833, 8834, 8835,
                            8841, 8842, 8843, 8844, 8845]) {
            const game = createHeadlessGame(seed);
            clearToOpenRoom(game);
            equip(game, 'sword');
            const foe = spawnEnemy(game, 'rat', 5, 5);
            foe.state = MonsterState.ASLEEP;
            const fBefore = foe.hp;
            move(game, 1, 0);
            expect(foe.hp).toBeLessThan(fBefore);
            const d = fBefore - foe.hp;
            expect(d, `种子伤害 ${d} 应为通用偷袭 ×3（21/24/27）`).toBeOneOf([21, 24, 27]);
            expect(d % 5, `伤害 ${d} 被 5 整除——×5 泄漏到普通武器`).not.toBe(0);
            damages.push(d);
        }
        // raw 骰随种子波动，至少覆盖两个不同值（证明是 7..9 的 ×3 区间而非常量）
        expect(new Set(damages).size).toBeGreaterThanOrEqual(2);
    });

    it('对抗性【WANDERING 不在偷袭触发集】：剑打游荡（WANDERING）目标必须自动' +
        '命中且 ×3 —— 防御 300 下命中率仅 ≈2.2%，10 个种子全中的实现才可能做到；' +
        '漏掉 WANDERING 触发的实现里游荡目标照常掷命中 → 几乎必 miss → 在这里翻车。' +
        '对照组：同一只怪 HUNTING 态 10 种子必出 miss。', () => {
        const wanderHits: number[] = [];
        let huntingMissed = false;
        for (const seed of [8831, 8832, 8833, 8834, 8835, 8836, 8837, 8838, 8839, 8840]) {
            // WANDERING：自动命中 + ×3
            const g1 = createHeadlessGame(seed);
            clearToOpenRoom(g1);
            equip(g1, 'sword');
            const foe1 = spawnEnemy(g1, 'rat', 5, 5, { defense: 300 });
            foe1.state = MonsterState.WANDERING;
            const fBefore1 = foe1.hp;
            move(g1, 1, 0);
            expect(foe1.hp, `seed=${seed}：WANDERING 目标必须被自动命中`).toBeLessThan(fBefore1);
            const d = fBefore1 - foe1.hp;
            expect(d, `seed=${seed}：伤害 ${d} 应为通用偷袭 ×3（21/24/27）`)
                .toBeOneOf([21, 24, 27]);
            wanderHits.push(d);

            // 对照组：HUNTING 同防御 → 命中率 2.2%，10 种子至少 1 次 miss
            const g2 = createHeadlessGame(seed);
            clearToOpenRoom(g2);
            equip(g2, 'sword');
            const foe2 = spawnEnemy(g2, 'rat', 5, 5, { defense: 300 });
            const fBefore2 = foe2.hp;
            move(g2, 1, 0);
            if (foe2.hp === fBefore2) huntingMissed = true;
        }
        expect(huntingMissed, '10 个种子 HUNTING（命中率 2.2%）应至少 1 次 miss——' +
            '若全中说明命中公式被改动，前置失效').toBe(true);
        expect(wanderHits.length).toBe(10);
    });
});

// ---------------------------------------------------------------------------
// 刺剑：ITEM_LUNGE_ATTACKS（突进）+ ITEM_ATTACKS_QUICKLY（双速）
// ---------------------------------------------------------------------------
describe('B-1 刺剑突进（ITEM_LUNGE_ATTACKS）', () => {
    it('对抗性【突进漏实现 / 只打相邻】：正东方 2 格外的敌人必须在玩家移动后' +
        '挨打且玩家进到中间格 —— 没实现突进、或把它写成"打相邻敌人"的实现里' +
        '2 格外的敌人毫发无损 → 在这里翻车。', () => {
        const game = createHeadlessGame(8851);
        clearToOpenRoom(game);
        equip(game, 'rapier');
        const foe = spawnEnemy(game, 'rat', 6, 5);     // 两格之外
        const fBefore = foe.hp;
        move(game, 1, 0);
        expect(game.player.loc.x).toBe(5);             // 玩家移动了（突进随移动结算）
        expect(game.player.loc.y).toBe(5);
        expect(foe.hp).toBeLessThan(fBefore);          // 关键断言：两格外也挨打
    });

    it('对抗性【突进波及相邻斜角】：移动方向斜前方的相邻敌人不挨打 —— 突进只看' +
        '两格之外那一格；"移动时顺手打所有相邻"的实现 → 在这里翻车。', () => {
        const game = createHeadlessGame(8852);
        clearToOpenRoom(game);
        equip(game, 'rapier');
        const diag = spawnEnemy(game, 'rat', 5, 4);    // 目标格东北斜角（相邻）
        const dBefore = diag.hp;
        move(game, 1, 0);
        expect(game.player.loc.x).toBe(5);
        expect(diag.hp).toBe(dBefore);                 // 关键断言：相邻不挨打
    });

    it('对抗性【突进无自动命中 / 倍率写错】：防御 300（命中率 ≈2.2%）的两格外' +
        '敌人，突进必须 5 种子全中且伤害 ∈ {9,12,15}（raw 3..5 的 ×3）—— 漏自动' +
        '命中的实现几乎必 miss；写成 ×5 的实现给 15/20/25 → 都在这里翻车。', () => {
        const damages: number[] = [];
        for (const seed of [8853, 8854, 8855, 8856, 8857]) {
            const game = createHeadlessGame(seed);
            clearToOpenRoom(game);
            equip(game, 'rapier');
            const foe = spawnEnemy(game, 'rat', 6, 5, { defense: 300 });
            foe.state = MonsterState.HUNTING;          // 隔离：触发源只有 lungeAttack
            const fBefore = foe.hp;
            move(game, 1, 0);
            expect(foe.hp, `seed=${seed}：突进必须自动命中`).toBeLessThan(fBefore);
            const d = fBefore - foe.hp;
            expect(d, `seed=${seed}：伤害 ${d} 应为突进 ×3（9/12/15）`)
                .toBeOneOf([9, 12, 15]);
            damages.push(d);
        }
        expect(damages).toContain(9);
        expect(damages).toContain(15);
    });

    it('对照组【普通剑无突进】：剑朝两格外的敌人移动只是走一格，敌人不掉血 ——' +
        '突进传染到普通武器的实现 → 在这里翻车。', () => {
        const game = createHeadlessGame(8858);
        clearToOpenRoom(game);
        equip(game, 'sword');
        const foe = spawnEnemy(game, 'rat', 6, 5);
        const fBefore = foe.hp;
        move(game, 1, 0);
        expect(game.player.loc.x).toBe(5);             // 走了
        expect(foe.hp).toBe(fBefore);                  // 关键断言：没挨打
    });
});

describe('B-1 刺剑双速（ITEM_ATTACKS_QUICKLY）', () => {
    // 行动时序推演（敌人 patch moveSpeed=150 → 初始 ticksUntilTurn=150，
    // Monsters.c:116 initializeMonster 口径；贴身反击是攻击动作，耗时
    // attackSpeed=100，P2-2 口径——故首次行动在 t=150、之后周期 100）：
    //   剑：6 击 × 100 tick = 600 tick 窗口 → 敌人行动于 150/250/350/450/550
    //   （首击后周期 100）→ 反击 5 次；刺剑：6 击 × 50 tick = 300 tick →
    //   行动于 150/300 → 反击 2 次。
    it('对抗性【QUICKLY 分支漏实现】：同样打 6 击，刺剑放出来的敌人行动窗口是' +
        '剑的一半——刺剑吃 2 次反击、剑吃 5 次；漏 QUICKLY 分支的刺剑按 100 tick' +
        '恢复 → 反击 5 次 → 在这里翻车。', () => {
        const runSixAttacks = (seed: number, weapon: string): number => {
            const game = createHeadlessGame(seed);
            clearToOpenRoom(game);
            equip(game, weapon);
            spawnEnemy(game, 'rat', 5, 5, { moveSpeed: 150 });  // 贴脸，站桩反击
            const baseline = logger.messages.length;
            for (let i = 0; i < 6; i++) move(game, 1, 0);
            return countHitsYou(baseline);
        };
        const rapierHits = runSixAttacks(8859, 'rapier');
        const swordHits = runSixAttacks(8859, 'sword');
        expect(rapierHits).toBe(2);                    // 关键断言：恢复 50 tick/击
        expect(swordHits).toBe(5);                     // 对照组：恢复 100 tick/击
    });

    it('对抗性【恢复量写错（attackSpeed 而非 attackSpeed/2）】：窃取攻击恢复量 ——' +
        '刺剑一次攻击的恢复恰为 50 tick（Time.c:2445-2446 的 attackSpeed/2）；' +
        '写成整段 attackSpeed 的实现记录到 100 → 在这里翻车。', () => {
        const game = createHeadlessGame(8860);
        clearToOpenRoom(game);
        equip(game, 'rapier');
        spawnEnemy(game, 'rat', 5, 5);                 // 贴脸，走攻击分支
        const rec = spyRecovery(game);
        move(game, 1, 0);
        expect(rec).toEqual([50]);                     // 关键断言：恰为 attackSpeed/2

        // 对照组：剑走普通分支恢复 100
        const game2 = createHeadlessGame(8860);
        clearToOpenRoom(game2);
        equip(game2, 'sword');
        spawnEnemy(game2, 'rat', 5, 5);
        const rec2 = spyRecovery(game2);
        move(game2, 1, 0);
        expect(rec2).toEqual([100]);
    });

    it('对抗性【分支优先级写反（钝器命中反而走 QUICKLY）】：双旗标武器（STAGGER+' +
        'QUICKLY，数据中不存在，专测分支序）命中时必须走 STAGGER 支恢复 200 tick' +
        '（Time.c:2442-2444 先判）——优先级倒置的实现走 QUICKLY 支记 50 → 在这里' +
        '翻车。行为镜像：敌 moveSpeed=150、身后墙，200-tick 窗口吃 1 次反击' +
        '（QUICKLY 误判时 50-tick 窗口为 0 次）。', () => {
        const game = createHeadlessGame(8861);
        clearToOpenRoom(game);
        equipCrafted(game, ['ITEM_ATTACKS_STAGGER', 'ITEM_ATTACKS_QUICKLY']);
        const foe = spawnEnemy(game, 'rat', 5, 5, { moveSpeed: 150 });
        game.grid.setTerrain(6, 5, TerrainType.WALL, '#', 0x444444); // 身后墙：无处可推
        const rec = spyRecovery(game);
        move(game, 1, 0);
        expect(foe.hp).toBeLessThan(500);              // 命中了（anAttackHit=true）
        expect(rec).toEqual([200]);                    // 关键断言：STAGGER 支胜出

        // 行为镜像：恢复量差 → 敌人反击窗口差
        const game2 = createHeadlessGame(8861);
        clearToOpenRoom(game2);
        equipCrafted(game2, ['ITEM_ATTACKS_STAGGER', 'ITEM_ATTACKS_QUICKLY']);
        spawnEnemy(game2, 'rat', 5, 5, { moveSpeed: 150 });
        game2.grid.setTerrain(6, 5, TerrainType.WALL, '#', 0x444444);
        const baseline2 = logger.messages.length;
        move(game2, 1, 0);
        expect(countHitsYou(baseline2)).toBe(1);       // 200-tick 窗口含 t=150
    });
});

// ---------------------------------------------------------------------------
// 连枷：ITEM_PASS_ATTACKS —— 移动前后双相邻判据
// ---------------------------------------------------------------------------
describe('B-1 连枷（ITEM_PASS_ATTACKS）', () => {
    it('对抗性【判据写成"所有相邻敌人" / "所有落格相邻"】：向东移动一格 —— 只有' +
        '同时与 (4,5)、(5,5) 两格相邻的敌人（(5,4)）挨打；移动前独有的 (3,5) 与' +
        '移动后独有的 (6,5) 都毫发无损。三种错误判据在这里各有翻车点。', () => {
        const game = createHeadlessGame(8862);
        clearToOpenRoom(game);
        equip(game, 'flail');
        const arc = spawnEnemy(game, 'rat', 5, 4);     // 双相邻 ✓
        const oldOnly = spawnEnemy(game, 'rat', 3, 5); // 仅移动前相邻
        const newOnly = spawnEnemy(game, 'rat', 6, 5); // 仅移动后相邻
        const aBefore = arc.hp;
        const oBefore = oldOnly.hp;
        const nBefore = newOnly.hp;
        move(game, 1, 0);
        expect(game.player.loc.x).toBe(5);             // 玩家移动了
        expect(arc.hp).toBeLessThan(aBefore);          // 双相邻挨打
        expect(oldOnly.hp).toBe(oBefore);              // 关键断言①：旧格独有不挨打
        expect(newOnly.hp).toBe(nBefore);              // 关键断言②：新格独有不挨打
    });

    it('对抗性【对角移动漏判 / 只看直线】：向东南斜走一格 (4,5)→(5,6) —— 双相邻' +
        '格是 (5,5) 与 (4,6) 两格，两只敌人都要挨打；仅与移动前相邻的 (3,6) 不挨' +
        '打。对角双相邻集合与直线不同，"只对直线移动生效"或"打满所有旧邻"的' +
        '实现都在这里翻车。', () => {
        const game = createHeadlessGame(8863);
        clearToOpenRoom(game);
        equip(game, 'flail');
        const a = spawnEnemy(game, 'rat', 5, 5, { hp: 1 });   // 南（双相邻）
        const b = spawnEnemy(game, 'rat', 4, 6, { hp: 1 });   // 西（双相邻）
        const oldOnly = spawnEnemy(game, 'rat', 3, 6);        // 仅移动前相邻
        const aBefore = a.hp, bBefore = b.hp, oBefore = oldOnly.hp;
        move(game, 1, 1);
        expect(game.player.loc.x).toBe(5);
        expect(game.player.loc.y).toBe(6);
        expect(a.hp).toBeLessThanOrEqual(0);           // 双相邻①被甩死
        expect(b.hp).toBeLessThanOrEqual(0);           // 双相邻②被甩死
        expect(oldOnly.hp).toBe(oBefore);              // 关键断言：旧格独有不挨打
        expect(aBefore).toBe(1);
        expect(bBefore).toBe(1);
    });

    it('留痕（本轮明确不做：CE abortAttack 确认提示）+ 盟友不进 hitList：连枷弧线' +
        '上站着盟友、双相邻格上有敌人时——整回合一次走完（无任何确认回合，' +
        'currentTick 恰好 +attackSpeed），盟友毫发无损、敌人挨打；CE 需要确认的' +
        '酸怪场景 web 照打（同一条 hitList 路径）。', () => {
        const game = createHeadlessGame(8864);
        clearToOpenRoom(game);
        equip(game, 'flail');
        const ally = spawnAlly(game, 'rat', 5, 4);     // 弧线上的盟友
        const foe = spawnEnemy(game, 'rat', 5, 6);     // 双相邻的敌人
        const aBefore = ally.hp;
        const fBefore = foe.hp;
        const t0 = timeSystem.currentTick;
        move(game, 1, 0);
        expect(game.player.loc.x).toBe(5);
        expect(ally.hp).toBe(aBefore);                 // 盟友绝不被误甩
        expect(foe.hp).toBeLessThan(fBefore);          // 敌人正常挨打
        // 关键断言：整回合恰好 +100（attackSpeed），不存在额外确认回合
        expect(timeSystem.currentTick - t0).toBe(100);
    });
});

// ---------------------------------------------------------------------------
// 数据留痕：weapons.json 旗标与数值冻结
// ---------------------------------------------------------------------------
describe('B-1 数据留痕', () => {
    it('weapons.json 旗标照 CE Items.c:209-236 补齐：dagger/rapier/flail 三件，' +
        '且经 spawnWeapon 流入 Item；其余武器的既有数值（damage/strengthRequired/' +
        'weight）一个都不许动。', () => {
        const expectFlags = (id: string, ...flags: string[]) => {
            const w = WEAPONS.find(x => x.id === id);
            expect(w, `weapons.json 应存在 ${id}`).toBeDefined();
            expect(w!.flags ?? [], `${id} 的 flags`).toEqual(flags);
        };
        expectFlags('dagger', 'ITEM_SNEAK_ATTACK_BONUS');
        expectFlags('rapier', 'ITEM_ATTACKS_QUICKLY', 'ITEM_LUNGE_ATTACKS');
        expectFlags('flail', 'ITEM_PASS_ATTACKS');
        // P4-7 已落地的六件不受本轮影响
        expectFlags('whip', 'ITEM_ATTACKS_EXTEND');
        expectFlags('spear', 'ITEM_ATTACKS_PENETRATE');
        expectFlags('war_pike', 'ITEM_ATTACKS_PENETRATE');
        expectFlags('axe', 'ITEM_ATTACKS_ALL_ADJACENT');
        expectFlags('mace', 'ITEM_ATTACKS_STAGGER');
        expectFlags('war_hammer', 'ITEM_ATTACKS_STAGGER');

        // 数值冻结：本轮只许加 flags，不得动任何既有数值
        const FROZEN: Array<[string, string, number, number]> = [
            ['dagger', '1d2+2', 12, 5],
            ['whip', '1d3+2', 14, 6],
            ['spear', '1d2+3', 13, 8],
            ['rapier', '1d3+2', 15, 7],
            ['sword', '1d3+6', 14, 10],
            ['mace', '1d5+15', 16, 15],
            ['axe', '1d3+6', 15, 18],
            ['flail', '1d7+8', 17, 20],
            ['halberd', '3d4', 16, 22],
            ['broadsword', '1d9+13', 19, 25],
            ['war_pike', '1d5+10', 18, 26],
            ['war_hammer', '1d11+24', 20, 30],
            ['dart', '1d3+1', 10, 2],
        ];
        for (const [id, damage, strReq, weight] of FROZEN) {
            const w = WEAPONS.find(x => x.id === id);
            expect(w, id).toBeDefined();
            expect(w!.damage, `${id}.damage`).toBe(damage);
            expect(w!.strengthRequired, `${id}.strengthRequired`).toBe(strReq);
            expect(w!.weight, `${id}.weight`).toBe(weight);
        }

        // 真实装载链路：flags 从 json 流入 Item
        expect(ItemLoader.spawnWeapon('dagger', -1, -1)?.flags)
            .toEqual(['ITEM_SNEAK_ATTACK_BONUS']);
        expect(ItemLoader.spawnWeapon('rapier', -1, -1)?.flags)
            .toEqual(['ITEM_ATTACKS_QUICKLY', 'ITEM_LUNGE_ATTACKS']);
        expect(ItemLoader.spawnWeapon('flail', -1, -1)?.flags)
            .toEqual(['ITEM_PASS_ATTACKS']);
    });

    it('留痕（本轮明确不做：镜像盟友继承武器旗标，CE Combat.c:755-772）：web ' +
        '盟友没有武器槽，玩家武器旗标不存在被盟友继承的通路——盟友实例上无 ' +
        'equippedWeapon/flags 武器旗标字段。', () => {
        const game = createHeadlessGame(8865);
        clearToOpenRoom(game);
        equip(game, 'rapier');
        const ally = spawnAlly(game, 'rat', 5, 5);
        expect((ally as any).equippedWeapon).toBeUndefined();
        expect((ally as any).flags).toBeUndefined();
    });
});
