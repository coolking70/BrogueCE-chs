/**
 * CombatFormulas.test.ts — 战斗公式黄金值回归测试（验收网）
 *
 * 黄金值来源：BrogueCE-master/src/brogue/Combat.c 与 PowerTables.c（只读基线）。
 * web 端 CombatFormulas.ts 采用 float 近似 CE 的 16.16 定点表格（FP_FACTOR=65536，
 * 见 Rogue.h:99-101），因此断言使用 toBeCloseTo(…, 12)；CE 表格值与 float 理想值
 * 之间最多相差定点截断噪声（<0.02%），注释中给出对应表格下标以便核对。
 *
 * 本文件不修改任何被测实现；发现与 CE 不符之处以 it.fails / it.todo 占位并单独列出。
 */
import { describe, it, expect } from 'vitest';
import {
    strengthModifier,
    netEnchant,
    accuracyFraction,
    damageFraction,
    defenseFraction,
    hitProbability,
    armorProtection,
    clumpedRoll,
} from './CombatFormulas';
import { Random } from '../Random';

/** 确定性伪随机源：固定 seed 的项目 RNG（与引擎同源，兼作 randRange 的回归保护） */
function seededRoller(seed: number) {
    const r = new Random(seed);
    return (lo: number, hi: number) => r.randRange(lo, hi);
}

describe('strengthModifier — CE Combat.c:66-74', () => {
    // CE Combat.c:69-70  surplus: difference * FP_FACTOR / 4 → +0.25/点
    it('力量盈余每点 +0.25', () => {
        expect(strengthModifier(18, 14)).toBeCloseTo(1.0, 12); // +4 → +1.0
        expect(strengthModifier(20, 10)).toBeCloseTo(2.5, 12); // +10 → +2.5
        expect(strengthModifier(17, 16)).toBeCloseTo(0.25, 12); // +1 → +0.25
    });

    // CE Combat.c:71-73  deficit: difference * FP_FACTOR * 5 / 2 → -2.5/点（重惩罚）
    it('力量欠缺每点 -2.5（边界必测）', () => {
        expect(strengthModifier(15, 16)).toBeCloseTo(-2.5, 12); // -1 → -2.5
        expect(strengthModifier(10, 16)).toBeCloseTo(-15, 12); // -6 → -15
        expect(strengthModifier(1, 3)).toBeCloseTo(-5, 12); // -2 → -5
    });

    // CE Combat.c:67-68  difference == 0 走 else 分支，0 * 2.5 = 0
    it('力量恰好相等时为 0', () => {
        expect(strengthModifier(16, 16)).toBe(0);
    });
});

describe('netEnchant — CE Combat.c:76-83', () => {
    // CE Combat.c:77-80  retval = enchant1 * FP_FACTOR + strengthModifier（仅武器/护甲）
    it('附魔 + 力量修正的叠加', () => {
        expect(netEnchant(2, 16, 16)).toBeCloseTo(2, 12); // 无力量差
        expect(netEnchant(1, 20, 16)).toBeCloseTo(2, 12); // +4 力量 → +1
        expect(netEnchant(2, 10, 16)).toBeCloseTo(-13, 12); // -6 力量 → -15
        expect(netEnchant(2.5, 16, 16)).toBeCloseTo(2.5, 12); // 允许 0.25 步进
    });

    // CE Combat.c:81-82  clamp(retval, -20*FP_FACTOR, 50*FP_FACTOR)（边界必测）
    it('钳制到 [-20, 50]', () => {
        expect(netEnchant(50, 16, 16)).toBeCloseTo(50, 12); // 上界恰好保留
        expect(netEnchant(49, 30, 16)).toBeCloseTo(50, 12); // 49+3.5=52.5 → 50
        expect(netEnchant(60, 16, 16)).toBeCloseTo(50, 12); // 远超上界
        expect(netEnchant(-20, 16, 16)).toBeCloseTo(-20, 12); // 下界恰好保留
        expect(netEnchant(-30, 16, 16)).toBeCloseTo(-20, 12); // 远超下界
        expect(netEnchant(0, 5, 20)).toBeCloseTo(-20, 12); // 0-37.5 → 钳到 -20
        expect(netEnchant(45, 30, 16)).toBeCloseTo(48.5, 12); // 45+3.5=48.5 在界内，不钳
    });
});

describe('accuracyFraction — CE PowerTables.c:161-182', () => {
    // CE PowerTables.c:163  表格即 1.065^x，x 以 0.25 附魔点步进，范围 [-20, 50]
    // CE PowerTables.c:180  idx = netEnchant*4/FP_FACTOR + 80 → 指数恰为 netEnchant
    it('0 附魔 → 恰好 1（表格下标 80 = 65536）', () => {
        expect(accuracyFraction(0)).toBe(1);
    });

    it('正附魔按 1.065^x 放大', () => {
        // CE 表格下标 84 = 69795（= trunc(1.065 * 65536)）
        expect(accuracyFraction(1)).toBeCloseTo(1.065, 12);
        // 下标 81 = 66575（= trunc(1.065^0.25 * 65536)）
        expect(accuracyFraction(0.25)).toBeCloseTo(1.0158682847827845, 12);
        // 下标 120 = 123020
        expect(accuracyFraction(10)).toBeCloseTo(1.877137465269359, 12);
        // 下标 280 = 1527426（表格最大值，x=50）
        expect(accuracyFraction(50)).toBeCloseTo(23.306678678698496, 12);
    });

    it('负附魔按 1.065^x 衰减', () => {
        expect(accuracyFraction(-1)).toBeCloseTo(0.9389671361502347, 12); // 1/1.065
        expect(accuracyFraction(-10)).toBeCloseTo(0.5327260355205291, 12);
        // CE 表格下标 0 = 18598（x=-20；与 float 差 0.004%，系定点逐级截断噪声）
        expect(accuracyFraction(-20)).toBeCloseTo(0.2837970289214204, 12);
    });
});

describe('damageFraction — CE PowerTables.c:138-159', () => {
    // CE PowerTables.c:140  与 accuracyFraction 同一张 1.065^x 表
    // CE PowerTables.c:157  idx = netEnchant*4/FP_FACTOR + 80
    it('0 附魔 → 恰好 1', () => {
        expect(damageFraction(0)).toBe(1);
    });

    it('伤害缩放与命中缩放同表同值', () => {
        expect(damageFraction(1)).toBeCloseTo(1.065, 12);
        expect(damageFraction(10)).toBeCloseTo(1.877137465269359, 12);
        expect(damageFraction(-10)).toBeCloseTo(0.5327260355205291, 12);
        expect(damageFraction(50)).toBeCloseTo(23.306678678698496, 12);
        expect(damageFraction(-20)).toBeCloseTo(0.2837970289214204, 12);
    });
});

describe('defenseFraction — CE PowerTables.c:184-204', () => {
    // CE PowerTables.c:186  表格基数 0.877347265 = 0.987^10，x 以 0.25 防御点步进
    // CE PowerTables.c:202  idx = netDefense*4/10/FP_FACTOR + 80；CE 内部 defense
    //                       为 ×10 定点（ogre 60 = 显示 6），/10 还原后指数 = 0.1*defense，
    //                       即 0.877347265^(0.1*d) = 0.987^d —— 与 web 端 float 公式一致。
    it('defense=0 时必须恰好等于 1（边界必测；表格下标 80 = 65536）', () => {
        expect(defenseFraction(0)).toBe(1);
    });

    it('防御减伤系数 0.987^defense（CE 表格：下标 84=57497, 88=50445, 92=44258, 120=17709）', () => {
        expect(defenseFraction(1)).toBeCloseTo(0.987, 12);
        expect(defenseFraction(10)).toBeCloseTo(0.877347265250301, 12);
        expect(defenseFraction(20)).toBeCloseTo(0.7697382238421805, 12);
        expect(defenseFraction(30)).toBeCloseTo(0.6753277256465606, 12);
        expect(defenseFraction(100)).toBeCloseTo(0.270218617040487, 12);
    });
});

describe('hitProbability — CE Combat.c:116-147', () => {
    // CE Combat.c:137-138  accuracy = player.info.accuracy * accuracyFraction(netEnchant) / FP_FACTOR
    // CE Combat.c:140      hitProbability = accuracy * defenseFraction(defense) / FP_FACTOR
    // CE Combat.c:141-145  钳制到 [0, 100]。web 端以 float 计算后四舍五入（CE 为两级
    //                      定点截断，个别边界值可能相差 1，属量化差异，非公式漂移）。
    it('零防御 → 命中率等于 accuracy', () => {
        expect(hitProbability(100, 0)).toBe(100);
        expect(hitProbability(0, 0)).toBe(0);
        expect(hitProbability(75, 0)).toBe(75);
    });

    it('防御减伤（未提供武器附魔）', () => {
        expect(hitProbability(100, 10)).toBe(88); // 87.7347 → 88
        expect(hitProbability(75, 20)).toBe(58); // 57.7304 → 58
        expect(hitProbability(100, 100)).toBe(27); // 27.0219 → 27
        expect(hitProbability(1, 100)).toBe(0); // 0.2702 → 0（钳到 0）
    });

    it('武器附魔放大 accuracy 后再乘防御系数', () => {
        expect(hitProbability(50, 5, 3)).toBe(57); // 56.5724 → 57
        expect(hitProbability(88, 12, 2)).toBe(85); // 85.3076 → 85
        expect(hitProbability(100, 10, -10)).toBe(47); // 46.7386 → 47
        expect(hitProbability(100, 0, -20)).toBe(28); // 28.3797 → 28
    });

    // CE Combat.c:141-142  > 100 钳到 100
    it('上限钳制到 100', () => {
        expect(hitProbability(200, 0)).toBe(100);
        expect(hitProbability(100, 0, 10)).toBe(100); // 187.7137 → 100
    });
});

describe('armorProtection', () => {
    // ⚠️ 与 CE 不符项（只锁行为，不顺手修正，详见交付报告）：
    // 当前 web 实现为乘法 baseArmor * 1.065^netEnch（CombatFormulas.ts:87-90），
    // 而 CE 是加法：defense = (armor*FP_FACTOR + netEnchant*10) / FP_FACTOR，
    // armor 字段本身为 ×10 定点（显示值 = armor/10 + enchant，Items.c:1544），
    // 即每点净附魔恰好 +1 防御，最后钳制 ≥0（Items.c:8515-8523）。
    // 以下测试锁定当前实现行为，防止其在无决策的情况下漂移。
    it('当前实现（乘法 1.065^netEnch）的行为快照', () => {
        expect(armorProtection(4, 2, 16, 14)).toBe(5); // 4*1.065^2.5 = 4.6820 → 5
        expect(armorProtection(8, 0, 16, 15)).toBe(8); // 8*1.065^0.25 = 8.1269 → 8
        expect(armorProtection(5, -4, 16, 16)).toBe(4); // 5*1.065^-4 = 3.8866 → 4
        expect(armorProtection(6, 10, 30, 16)).toBe(14); // 6*1.065^13.5 = 14.0401 → 14
        expect(armorProtection(0, 10, 16, 16)).toBe(0); // 基础 0 保持 0
    });

    // CE Items.c:8519 + 8520-8521 的加法公式（黄金值）：
    // scale armor(4) +2、力量盈余 +0.5 → CE defense = 4 + 2.5 = 6.5（×10 定点后为 65）。
    // 当前乘法实现返回 5。it.fails 精确钉住「当前实现 ≠ CE 黄金值」这一事实；
    // 将来按 CE 改为加法后此测试会转红，即提示把下面的 it.todo 落地为正式断言。
    it.fails('【与 CE 不符】当前乘法实现返回 5，CE 加法公式的黄金值是 6.5（Items.c:8519）', () => {
        expect(armorProtection(4, 2, 16, 14)).toBe(6.5);
    });
    it.todo('armorProtection 待按 CE 加法公式重写后断言 base + netEnchant（钳 0）；见 Items.c:8515-8523');
});

describe('clumpedRoll — CE Combat.c:46-57 注释 / Math.c:40-59 randClumpedRange', () => {
    // CE Math.c:48-56  numSides = (max-min)/clumping；前 (max-min)%clumping 颗骰子
    // 掷 0..numSides+1，其余掷 0..numSides，总和 + lowerBound。
    // clumpedRoll(0,10,3) → 1 颗 d(0..4) + 2 颗 d(0..3)，均值 5（CE Combat.c:53-55
    // 的注释 "0-10 with a CF of 3 would be 1d4 + 2d3"，其 dN 记法含 0）。
    const N = 10000;
    const roll3 = () => {
        const vals: number[] = [];
        const rollFn = seededRoller(1234);
        for (let i = 0; i < N; i++) vals.push(clumpedRoll(0, 10, 3, rollFn));
        return vals;
    };

    it('固定 seed 下 10000 次的均值落在理论均值 5.0 附近', () => {
        const vals = roll3();
        const mean = vals.reduce((a, b) => a + b, 0) / N;
        expect(mean).toBeGreaterThan(4.9);
        expect(mean).toBeLessThan(5.1);
    });

    it('最小值/最大值等于理论边界 [0, 10]', () => {
        const vals = roll3();
        expect(Math.min(...vals)).toBe(0);
        expect(Math.max(...vals)).toBe(10);
    });

    it('分布呈钟形：中间桶计数高于两端', () => {
        const vals = roll3();
        let low = 0,
            mid = 0,
            high = 0;
        for (const v of vals) {
            if (v <= 3) low++;
            else if (v <= 6) mid++;
            else high++;
        }
        // 理论概率 ≈ 0.19 / 0.50 / 0.31 —— 钟形，而非均匀（均匀时三桶应各 ≈ 0.36）
        expect(mid).toBeGreaterThan(low);
        expect(mid).toBeGreaterThan(high);
        expect(mid).toBeGreaterThan(N * 0.4);
        expect(low).toBeLessThan(N * 0.3);
        expect(high).toBeLessThan(N * 0.3);
    });

    // CE Math.c:44-46  clumpFactor <= 1 → 退化为均匀 rand_range
    it('clumping=1 退化为均匀分布', () => {
        const rollFn = seededRoller(5678);
        const vals: number[] = [];
        for (let i = 0; i < N; i++) vals.push(clumpedRoll(0, 10, 1, rollFn));
        const mean = vals.reduce((a, b) => a + b, 0) / N;
        expect(mean).toBeGreaterThan(4.85);
        expect(mean).toBeLessThan(5.15);
        expect(Math.min(...vals)).toBe(0);
        expect(Math.max(...vals)).toBe(10);
        // 均匀分布：11 个取值各 ≈ N/11 ≈ 909 次（sd ≈ 29，±25% 容差约 7.7 个标准差）
        const counts = Array(11).fill(0);
        for (const v of vals) counts[v]!++;
        for (const c of counts) {
            expect(c).toBeGreaterThan(680);
            expect(c).toBeLessThan(1140);
        }
    });

    // CE Math.c:41-43  upper <= lower → 直接返回 lowerBound
    it('min >= max 时原样返回', () => {
        expect(clumpedRoll(7, 7, 4, seededRoller(99))).toBe(7);
        expect(clumpedRoll(9, 3, 2, seededRoller(99))).toBe(9);
    });

    it('余数骰：clumpedRoll(0,10,4) = 2×d(0..3) + 2×d(0..2)，均值 5', () => {
        const rollFn = seededRoller(4321);
        const vals: number[] = [];
        for (let i = 0; i < N; i++) vals.push(clumpedRoll(0, 10, 4, rollFn));
        const mean = vals.reduce((a, b) => a + b, 0) / N;
        expect(mean).toBeGreaterThan(4.9);
        expect(mean).toBeLessThan(5.1);
        expect(Math.min(...vals)).toBe(0);
        expect(Math.max(...vals)).toBe(10);
    });
});

// ─── 以下导出不在本次必测清单内，且与 CE 存在差异，仅立占位（详见交付报告）───
describe('与 CE 不符的占位（暂不实现黄金值断言）', () => {
    it.todo('runicWeaponChance：web 为 7+4*ench 线性近似；CE 为按符文类型分表的 100-(1-k)^x（PowerTables.c:220-345），且依赖武器基础伤害');
    it.todo('weaponSlowDuration：web 为 3+floor(ench/2)；CE 为 (ench+2)^2/3（PowerTables.c:102）');
    it.todo('weaponConfusionDuration：web 为 3+floor(ench*0.75)；CE 为 max(3, ench*3/2)（PowerTables.c:100）');
    it.todo('weaponImageCount：web 为 1+floor(ench/3)；CE 为 clamp(ench/3, 1, 7)（PowerTables.c:103）');
    it.todo('weaponForceDistance：web 为 floor(ench/2)+2（min 1）；CE 为 max(4, ench*2+2)（PowerTables.c:101）');
});
