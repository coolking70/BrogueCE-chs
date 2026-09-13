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
    playerDefense,
    clumpedRoll,
    runicWeaponChance,
    RUNIC_WEAPON_BAD_CHANCE,
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

describe('playerDefense — CE Items.c:8515-8523（加法模型）', () => {
    // CE Items.c:8517-8519:
    //   enchant = netEnchant(theItem);   // 含力量修正（Combat.c:76-83），已钳 [-20,50]
    //   player.info.defense = (theItem->armor * FP_FACTOR + enchant * 10) / FP_FACTOR;
    //   if (player.info.defense < 0) player.info.defense = 0;   // 8520-8522
    // theItem->armor 为 ×10 定点（leather 30 = 显示 3；显示值 = armor/10 + enchant1，
    // Items.c:1544），armors.json 存显示值 → 内部防御值 = (armor + netEnchant) * 10。
    // 每点净附魔恰好 +10 内部（+1 显示）防御，纯加法；该值只进命中率公式
    // （Combat.c:140），CE 护甲不从伤害中扣任何点数。

    // 原 it.fails 占位转正（P0-1 钉子）：scale armor(4) +2、力量盈余 +0.5
    // → 显示防御 4 + 2.5 = 6.5，内部值 65（Items.c:8519）。
    // 旧乘法实现返回 5，已于本次按 CE 改为加法后转绿。
    it('黄金值：scale(4) +2 附魔、力量盈余 +0.5 → 内部防御 65（Items.c:8519）', () => {
        expect(playerDefense(4, 2, 16, 14)).toBe(65);
    });

    // 原 it.todo 落地：断言 base + netEnchant（钳 0）
    it('加法模型黄金值：base + netEnchant（×10 标度）', () => {
        // leather(3) +0、力量恰好 → 内部 30（显示 3，Items.c:1544 口径）
        expect(playerDefense(3, 0, 10, 10)).toBe(30);
        // plate(11) +0、力量恰好 → 内部 110
        expect(playerDefense(11, 0, 19, 19)).toBe(110);
        // plate(11) +3、力量恰好 → 内部 140
        expect(playerDefense(11, 3, 19, 19)).toBe(140);
        // 0.25 步进（力量盈余 +0.25）：3 + 0.25 = 3.25 显示 → 32.5 内部
        expect(playerDefense(3, 0, 11, 10)).toBe(32.5);
        // banded(7) -4、力量恰好 → (7-4)*10 = 30
        expect(playerDefense(7, -4, 15, 15)).toBe(30);
        // 基础 0：净附魔仍按加法生效（0 + 2)*10 = 20；CE 对 defense 的唯一
        // 特殊处理就是 <0 钳 0（8520-8522），基础 0 无额外归零规则
        expect(playerDefense(0, 2, 16, 16)).toBe(20);
    });

    // 验收断言：每点净附魔使内部防御值恰好 +10（加法，非乘法）
    it('每点净附魔使内部防御值 +10（含 0.25 步进的 +2.5）', () => {
        // 力量恰好时：附魔 +1 → +10
        expect(playerDefense(4, 3, 14, 14) - playerDefense(4, 2, 14, 14)).toBe(10);
        expect(playerDefense(11, 4, 19, 19) - playerDefense(11, 3, 19, 19)).toBe(10);
        // 力量盈余路径同样线性：力量 +4 → +1 净附魔 → +10 内部
        expect(playerDefense(4, 0, 18, 14) - playerDefense(4, 0, 14, 14)).toBe(10);
        // 力量欠缺路径：-1 力量 → -2.5 净附魔 → -25 内部
        expect(playerDefense(4, 0, 13, 14) - playerDefense(4, 0, 14, 14)).toBe(-25);
        // 0.25 步进：+0.25 净附魔 → +2.5 内部
        expect(playerDefense(4, 0.25, 14, 14) - playerDefense(4, 0, 14, 14)).toBe(2.5);
    });

    // 验收断言：负值钳到 0（CE Items.c:8520-8522）
    it('净防御为负时钳到 0（Items.c:8520-8522，边界必测）', () => {
        // (3 - 4)*10 = -10 → 0
        expect(playerDefense(3, -4, 10, 10)).toBe(0);
        // 恰好为 0 的边界保留：(3 - 3)*10 = 0 → 0
        expect(playerDefense(3, -3, 10, 10)).toBe(0);
        // 深度负附魔受 netEnchant 下界 [-20] 约束后再钳 0：(3 - 20)*10 → 0
        expect(playerDefense(3, -20, 10, 10)).toBe(0);
        // 力量欠缺拖垮附魔：plate(11) -2 附魔、欠缺 1 力量 → (11 - 4.5)*10 = 65 仍为正
        expect(playerDefense(11, -2, 18, 19)).toBe(65);
        // 欠缺 3 力量 → (11 - 9.5)*10 = 15；欠缺 4 → (11-12)*10 = -10 → 0
        expect(playerDefense(11, -2, 16, 19)).toBe(15);
        expect(playerDefense(11, -2, 15, 19)).toBe(0);
    });
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
    it.todo('weaponSlowDuration：web 为 3+floor(ench/2)；CE 为 (ench+2)^2/3（PowerTables.c:102）');
    it.todo('weaponConfusionDuration：web 为 3+floor(ench*0.75)；CE 为 max(3, ench*3/2)（PowerTables.c:100）');
    it.todo('weaponImageCount：web 为 1+floor(ench/3)；CE 为 clamp(ench/3, 1, 7)（PowerTables.c:103）');
    it.todo('weaponForceDistance：web 为 floor(ench/2)+2（min 1）；CE 为 max(4, ench*2+2)（PowerTables.c:101）');
});

// ─── runicWeaponChance：CE PowerTables.c:220-345 的逐值移植（原 it.todo 落地）───
describe('runicWeaponChance — CE PowerTables.c:220-345', () => {
    // 武器基础伤害口径：weapons.json 记法经 CombatSystem.parseDamageString 解析出的
    // {min,max} 与 CE Globals.c weaponTable 的 range{lowerBound,upperBound} 逐项一致：
    //   dagger     "1d2+2"   → {3,4}   （Globals.c:1583）
    //   rapier     "1d3+2"   → {3,5}   （Globals.c:1588）
    //   mace       "1d5+15"  → {16,20} （Globals.c:1591）
    //   war hammer "1d11+24" → {25,35} （Globals.c:1592）
    const DAGGER = { damageMin: 3, damageMax: 4 }; // adj=(3+4)/2=3 → modifier=1-3/18=5/6
    const RAPIER = { damageMin: 3, damageMax: 5 }; // adj=4
    const MACE = { damageMin: 16, damageMax: 20 }; // adj=18（CE 中为 STAGGER 武器）
    const HAMMER = { damageMin: 25, damageMax: 35 }; // adj=30 → modifier=1-0.99=0.01

    it('黄金值：匕首(低伤)+speed——高伤惩罚低，触发率随附魔快速上升（POW_16 表，PowerTables.c:221-230、311-328）', () => {
        // modifier = 1 - 3/18 = 5/6；表下标 = floor(4·e·5/6)，chance = 100-表值/FP
        // e=1: idx 3（T=57502）→ 13；e=3: idx 10（42381）→ 36；e=4: idx 13（37186）→ 44
        // e=6: idx 20（27407）→ 59；e=10: idx 33（15551）→ 77；e=20: idx 66（4346）→ 95
        expect(runicWeaponChance(1, 'speed', DAGGER)).toBe(13);
        expect(runicWeaponChance(3, 'speed', DAGGER)).toBe(36);
        expect(runicWeaponChance(4, 'speed', DAGGER)).toBe(44);
        expect(runicWeaponChance(6, 'speed', DAGGER)).toBe(59);
        expect(runicWeaponChance(10, 'speed', DAGGER)).toBe(77);
        expect(runicWeaponChance(20, 'speed', DAGGER)).toBe(95);
    });

    it('黄金值：战锤(高伤)+speed——modifier≈0.01，原始查表值极小（PowerTables.c:321 高伤惩罚）', () => {
        // e=4: idx 0 → 0 → 下限抬到 4；e=25: idx 1（62740）→ 5 → 下限抬到 25
        expect(runicWeaponChance(4, 'speed', HAMMER)).toBe(4);
        expect(runicWeaponChance(25, 'speed', HAMMER)).toBe(25);
    });

    it('黄金值：quietus（p=0.06，POW_6 表，PowerTables.c:273-283）', () => {
        expect(runicWeaponChance(6, 'quietus', DAGGER)).toBe(27); // idx 20（48097）
        expect(runicWeaponChance(12, 'quietus', DAGGER)).toBe(47); // idx 40（35298）
        expect(runicWeaponChance(20, 'quietus', DAGGER)).toBe(64); // idx 66（23209）
    });

    it('黄金值：paralyzing/confusion/force 各用各自的 p 表（PowerTables.c:251-272、231-240）', () => {
        expect(runicWeaponChance(7, 'paralyzing', DAGGER)).toBe(35); // POW_7 idx 17（48142）
        expect(runicWeaponChance(4, 'confusion', DAGGER)).toBe(32); // POW_11 idx 13（43585）
        expect(runicWeaponChance(3, 'force', DAGGER)).toBe(34); // POW_15 idx 10（43654）
        expect(runicWeaponChance(9, 'force', DAGGER)).toBe(71); // POW_15 idx 30（19369）
    });

    it('与闭式公式 100·(1-(1-p)^(e·modifier)) 一致——差异仅剩表下标的 0.25 量化（≤3.5pp）', () => {
        // CE 表即 (1-p)^x × 65536（与理想值差 ≤1/65536），下标取 floor(4·e·m)；
        // 量化使整数百分比结果与连续闭式最多差约 3.1pp（全参数域实测），此处留 3.5 余量
        const P: Record<string, number> = { speed: 0.16, quietus: 0.06, paralyzing: 0.07, confusion: 0.11, force: 0.15 };
        for (const [kind, p] of Object.entries(P)) {
            for (const weapon of [DAGGER, RAPIER, MACE, HAMMER]) {
                // CE 为整数除法（PowerTables.c:311-312），匕首 (3+4)/2 → 3 而非 3.5
                const adj = Math.floor((weapon.damageMin + weapon.damageMax) / 2);
                const m = 1 - Math.min(0.99, adj / 18);
                for (let e = 0; e <= 50; e++) {
                    // 闭式值套用 CE 同款钳制 clamp(chance, max(1, e), 100)（PowerTables.c:342）
                    const closed = Math.min(100, Math.max(100 * (1 - Math.pow(1 - p, e * m)), 1, e));
                    const actual = runicWeaponChance(e, kind, weapon);
                    expect(Math.abs(actual - closed)).toBeLessThanOrEqual(3.5);
                }
            }
        }
    });

    it('W_SLAYING 非概率触发，恒返回 0（PowerTables.c:300-302）', () => {
        expect(runicWeaponChance(10, 'slaying', DAGGER)).toBe(0);
        expect(runicWeaponChance(50, 'slaying', HAMMER)).toBe(0);
        expect(runicWeaponChance(0, 'slaying', DAGGER)).toBe(0);
        expect(runicWeaponChance(-3, 'slaying', DAGGER)).toBe(0);
    });

    it('有害/表外符文固定 15（PowerTables.c:303-305；mercy=CE 有害符文，vampirism/venom 为 web 自创按同口径）', () => {
        expect(runicWeaponChance(10, 'mercy', DAGGER)).toBe(RUNIC_WEAPON_BAD_CHANCE);
        expect(runicWeaponChance(20, 'vampirism', DAGGER)).toBe(RUNIC_WEAPON_BAD_CHANCE);
        expect(runicWeaponChance(20, 'venom', DAGGER)).toBe(RUNIC_WEAPON_BAD_CHANCE);
        expect(runicWeaponChance(-5, 'mercy', HAMMER)).toBe(RUNIC_WEAPON_BAD_CHANCE);
        // CE 有表但 web 未实装的种类（multiplicity/slowing）按本轮边界不移植 → 表外口径
        expect(runicWeaponChance(10, 'multiplicity', DAGGER)).toBe(RUNIC_WEAPON_BAD_CHANCE);
        expect(runicWeaponChance(10, 'slowing', DAGGER)).toBe(RUNIC_WEAPON_BAD_CHANCE);
        // 单参兼容形态（无类别信息）——旧调用点 armor_model_effect.test.ts 的形态
        expect(runicWeaponChance(10)).toBe(RUNIC_WEAPON_BAD_CHANCE);
    });

    it('负附魔与 0 附魔 → 1（末尾下限 max(1, e) 抬升；PowerTables.c:323-324 归零后经 342 行下限）', () => {
        // 注：任务预设"负附魔→0"与 CE 不符——323-324 行先归零，但 342 行
        // clamp(chance, max(1, e), 100) 把下限抬到 1。以 CE 实现为准，见交付报告。
        expect(runicWeaponChance(-3, 'speed', DAGGER)).toBe(1);
        expect(runicWeaponChance(-20, 'quietus', DAGGER)).toBe(1);
        expect(runicWeaponChance(0, 'speed', DAGGER)).toBe(1);
    });

    it('下限 max(1, e) 生效的高伤武器场景：战锤原始查表值近 0，被抬到 e（PowerTables.c:340-342）', () => {
        expect(runicWeaponChance(2, 'speed', HAMMER)).toBe(2); // 原始 0
        expect(runicWeaponChance(5, 'speed', HAMMER)).toBe(5); // 原始 0
        expect(runicWeaponChance(10, 'speed', HAMMER)).toBe(10); // 原始 0
        expect(runicWeaponChance(25, 'speed', HAMMER)).toBe(25); // 原始 5 < 25
        expect(runicWeaponChance(50, 'speed', HAMMER)).toBe(50); // 原始 9 < 50
    });

    it('迟滞/迅捷攻速修正（web 数据暂无对应标志，用合成上下文验证 CE PowerTables.c:314-316、331-338）', () => {
        // mace adj=18，STAGGER 先把伤害折半为 9（modifier=0.5）：e4 查表 30 → 1-(1-0.3)² = 51
        expect(runicWeaponChance(4, 'speed', { ...MACE, attacksStagger: true })).toBe(51);
        // rapier adj=4：e4 查表 41 → 1-√(1-0.41) = 23（CE fp_sqrt 定点开方的 float 近似）
        expect(runicWeaponChance(4, 'speed', { ...RAPIER, attacksQuickly: true })).toBe(23);
        // 迅捷不叠加伤害折半——CE 317-319 行已注释停用：rapier 无 stagger 标志时 adj=4
        expect(runicWeaponChance(4, 'speed', RAPIER)).toBe(41);
    });

    it('无武器上下文时按无高伤惩罚（modifier=1）处理，不抛错', () => {
        // adj 取 0 → modifier=1：e=4 → idx 16 → 100-trunc(100·32628/65536) = 51
        expect(runicWeaponChance(4, 'speed')).toBe(51);
    });
});
