/**
 * src/engine/Combat/CombatFormulas.ts
 * Pure math functions ported from Brogue CE Combat.c
 * All functions are stateless and testable independently.
 */

// CE 的 FP_FACTOR 是 16.16 定点（Rogue.h:99-101，1<<16 = 65536）。
// 基础战斗与符文概率使用 CE 原表及逐级整数截断。
import { COMBAT_ENCHANT_FRACTION, COMBAT_DEFENSE_FRACTION } from './CombatTables';

/**
 * Strength modifier for an item.
 * Surplus strength gives +0.25 per point.
 * Deficit strength gives -2.5 per point (very harsh penalty).
 */
export function strengthModifier(playerStrength: number, requiredStrength: number): number {
    const diff = playerStrength - requiredStrength;
    if (diff > 0) {
        return diff * 0.25;
    } else {
        return diff * 2.5;
    }
}

/**
 * Net enchantment of an item accounting for strength.
 * Result clamped to [-20, 50].
 */
export function netEnchant(enchantment: number, playerStrength: number, requiredStrength: number): number {
    const raw = enchantment + strengthModifier(playerStrength, requiredStrength);
    return Math.max(-20, Math.min(50, raw));
}

/**
 * Accuracy fraction: how much accuracy is multiplied by enchantment.
 * CE formula: 1.065 ^ netEnchant
 * Positive enchantment increases accuracy, negative decreases.
 */
export function accuracyFraction(netEnch: number): number {
    return COMBAT_ENCHANT_FRACTION[Math.max(0, Math.min(280, Math.trunc(netEnch * 4) + 80))]! / FP_FACTOR;
}

/**
 * Damage fraction: how much damage is scaled by enchantment.
 * CE formula: 1.065 ^ netEnchant
 */
export function damageFraction(netEnch: number): number {
    return COMBAT_ENCHANT_FRACTION[Math.max(0, Math.min(280, Math.trunc(netEnch * 4) + 80))]! / FP_FACTOR;
}

/** CE Combat.c:87-110; truncate accuracy before hitProbability. */
export function monsterDamageAdjustmentAmount(weaknessAmount: number): number {
    return damageFraction(-1.5 * weaknessAmount);
}
export function monsterAccuracyAdjusted(accuracy: number, weaknessAmount: number): number {
    return Math.max(0, Math.trunc(accuracy * accuracyFraction(-1.5 * weaknessAmount)));
}
export function monsterDefenseAdjusted(defense: number, weaknessAmount: number): number {
    return Math.max(0, defense - 25 * weaknessAmount);
}

/**
 * Defense fraction: how hit probability is reduced by defense.
 * CE formula: 0.987 ^ defense
 * Higher defense = lower fraction = harder to hit.
 */
export function defenseFraction(defense: number): number {
    return COMBAT_DEFENSE_FRACTION[Math.max(0, Math.min(280, Math.trunc(defense * 4 / 10) + 80))]! / FP_FACTOR;
}

/**
 * Calculate hit probability (0-100).
 * CE formula: accuracy * accuracyFraction(weaponEnchant) * defenseFraction(defense)
 */
export function hitProbability(
    attackerAccuracy: number,
    defenderDefense: number,
    weaponNetEnchant?: number
): number {
    let accuracy = Math.max(0, Math.trunc(attackerAccuracy));
    if (weaponNetEnchant !== undefined) {
        accuracy = Math.trunc(attackerAccuracy * accuracyFraction(weaponNetEnchant));
    }
    const prob = Math.trunc(accuracy * defenseFraction(Math.max(0, Math.trunc(defenderDefense))));
    return Math.max(0, Math.min(100, prob));
}

/**
 * Player defense value in CE's internal ×10 fixed-point scale.
 *
 * CE Items.c:8515-8523 (recalculateEquipmentBonuses):
 *   enchant = netEnchant(theItem);                     // 含力量修正，已钳 [-20,50]
 *   player.info.defense = (theItem->armor * FP_FACTOR + enchant * 10) / FP_FACTOR;
 *   if (player.info.defense < 0) player.info.defense = 0;
 * 其中 theItem->armor 为 ×10 定点（leather 30 = 显示 3，显示值 = armor/10 + enchant1，
 * 见 Items.c:1544），armors.json 存显示值，故内部防御值 = (armor + netEnchant) * 10。
 * 每点净附魔恰好 +10 内部（+1 显示）防御——纯加法，无乘法项。
 *
 * ⚠ 该值只喂命中率公式（Combat.c:140
 *   hitProbability = accuracy * defenseFraction(defense * FP_FACTOR) / FP_FACTOR，
 *   defenseFraction 见 PowerTables.c:184-204）。CE 护甲不从伤害里扣任何点数。
 *
 * CE 存储到 short 时向零截断（如 32.5 → 32），再钳制负值。
 */
export function playerDefense(
    baseArmor: number,
    enchantment: number,
    playerStrength: number,
    requiredStrength: number
): number {
    const netEnch = netEnchant(enchantment, playerStrength, requiredStrength);
    return Math.max(0, Math.trunc((baseArmor + netEnch) * 10));
}

/**
 * Clumped damage roll.
 * Instead of a flat uniform roll between min and max,
 * break into `clumping` sub-dice to create a bell curve.
 *
 * With clumping 1: uniform [min, max]
 * With clumping 2: sum of 2 dice (triangular distribution)
 * With clumping 3: sum of 3 dice (approximating gaussian)
 *
 * CE handles remainder die sizes to ensure full range coverage.
 */
export function clumpedRoll(
    min: number,
    max: number,
    clumping: number,
    rollFn: (lo: number, hi: number) => number
): number {
    if (max <= min) return min;
    if (clumping <= 1) {
        return rollFn(min, max);
    }

    const range = max - min;
    const baseDieSize = Math.floor(range / clumping);
    const remainder = range % clumping;

    let total = min;
    for (let i = 0; i < clumping; i++) {
        // First `remainder` dice get +1 to their max
        const dieMax = baseDieSize + (i < remainder ? 1 : 0);
        total += rollFn(0, dieMax);
    }
    return total;
}

// ─── 武器符文触发率（CE PowerTables.c:220-345 的忠实移植）───

/** CE FP_FACTOR（Rogue.h:99-101，FP_BASE=16）。CE 全程以 16.16 定点 + 逐级整数
 * 截断计算，以下实现逐项复刻该语义（含内嵌原表），保证与 CE 逐值一致。 */
const FP_FACTOR = 65536;

/** CE PowerTables.c 的 *_RUNIC_DECREMENT 定点表：值为 (1-p)^x × 65536，x 以 0.25
 * 附魔点步进、范围 [0, 50]（201 项）。CE 原表与 round((1-p)^x·65536) 之间有 ≤1
 * 的生成噪声，故内嵌原表而非运行时 Math.pow，保证逐值一致。 */
const POW_16_RUNIC_DECREMENT = [ // PowerTables.c:221-230 (1-0.16)^x — W_SPEED
    65536, 62740, 60064, 57502, 55050, 52702, 50454, 48302, 46242, 44269, 42381, 40574, 38843, 37186, 35600, 34082,
    32628, 31236, 29904, 28629, 27407, 26238, 25119, 24048, 23022, 22040, 21100, 20200, 19339, 18514, 17724, 16968,
    16244, 15551, 14888, 14253, 13645, 13063, 12506, 11972, 11462, 10973, 10505, 10057, 9628, 9217, 8824, 8448,
    8087, 7742, 7412, 7096, 6793, 6503, 6226, 5961, 5706, 5463, 5230, 5007, 4793, 4589, 4393, 4206,
    4026, 3854, 3690, 3533, 3382, 3238, 3100, 2967, 2841, 2720, 2604, 2492, 2386, 2284, 2187, 2094,
    2004, 1919, 1837, 1759, 1684, 1612, 1543, 1477, 1414, 1354, 1296, 1241, 1188, 1137, 1089, 1042,
    998, 955, 914, 875, 838, 802, 768, 735, 704, 674, 645, 617, 591, 566, 542, 519,
    496, 475, 455, 436, 417, 399, 382, 366, 350, 335, 321, 307, 294, 281, 269, 258,
    247, 236, 226, 217, 207, 198, 190, 182, 174, 167, 159, 153, 146, 140, 134, 128,
    123, 117, 112, 108, 103, 99, 94, 90, 86, 83, 79, 76, 73, 69, 66, 64,
    61, 58, 56, 53, 51, 49, 47, 45, 43, 41, 39, 37, 36, 34, 33, 31,
    30, 29, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 18, 17, 16, 15,
    15, 14, 13, 13, 12, 12, 11, 11, 10,
];
const POW_6_RUNIC_DECREMENT = [ // PowerTables.c:273-283 (1-0.06)^x — W_QUIETUS
    65536, 64530, 63539, 62564, 61603, 60658, 59727, 58810, 57907, 57018, 56143, 55281, 54433, 53597, 52774, 51964,
    51167, 50381, 49608, 48846, 48097, 47358, 46631, 45916, 45211, 44517, 43833, 43161, 42498, 41846, 41203, 40571,
    39948, 39335, 38731, 38137, 37551, 36975, 36407, 35848, 35298, 34756, 34223, 33698, 33180, 32671, 32169, 31676,
    31189, 30711, 30239, 29775, 29318, 28868, 28425, 27989, 27559, 27136, 26719, 26309, 25905, 25508, 25116, 24731,
    24351, 23977, 23609, 23247, 22890, 22539, 22193, 21852, 21516, 21186, 20861, 20541, 20225, 19915, 19609, 19308,
    19012, 18720, 18433, 18150, 17871, 17597, 17327, 17061, 16799, 16541, 16287, 16037, 15791, 15549, 15310, 15075,
    14843, 14616, 14391, 14170, 13953, 13739, 13528, 13320, 13116, 12914, 12716, 12521, 12329, 12139, 11953, 11770,
    11589, 11411, 11236, 11063, 10894, 10726, 10562, 10400, 10240, 10083, 9928, 9776, 9625, 9478, 9332, 9189,
    9048, 8909, 8772, 8638, 8505, 8374, 8246, 8119, 7995, 7872, 7751, 7632, 7515, 7400, 7286, 7174,
    7064, 6956, 6849, 6744, 6640, 6538, 6438, 6339, 6242, 6146, 6052, 5959, 5867, 5777, 5688, 5601,
    5515, 5430, 5347, 5265, 5184, 5105, 5026, 4949, 4873, 4798, 4725, 4652, 4581, 4510, 4441, 4373,
    4306, 4240, 4175, 4111, 4047, 3985, 3924, 3864, 3805, 3746, 3689, 3632, 3576, 3521, 3467, 3414,
    3362, 3310, 3259, 3209, 3160, 3111, 3064, 3017, 2970,
];
const POW_7_RUNIC_DECREMENT = [ // PowerTables.c:262-272 (1-0.07)^x — W_PARALYSIS（web 名 paralyzing）
    65536, 64357, 63200, 62064, 60948, 59852, 58776, 57719, 56682, 55662, 54662, 53679, 52714, 51766, 50835, 49921,
    49024, 48142, 47277, 46427, 45592, 44772, 43967, 43177, 42401, 41638, 40890, 40155, 39433, 38724, 38027, 37344,
    36672, 36013, 35365, 34730, 34105, 33492, 32890, 32298, 31718, 31147, 30587, 30038, 29497, 28967, 28446, 27935,
    27433, 26939, 26455, 25979, 25512, 25054, 24603, 24161, 23726, 23300, 22881, 22470, 22066, 21669, 21279, 20897,
    20521, 20152, 19790, 19434, 19084, 18741, 18404, 18073, 17748, 17429, 17116, 16808, 16506, 16209, 15918, 15632,
    15351, 15075, 14804, 14537, 14276, 14019, 13767, 13520, 13277, 13038, 12804, 12573, 12347, 12125, 11907, 11693,
    11483, 11276, 11074, 10875, 10679, 10487, 10299, 10113, 9931, 9753, 9578, 9405, 9236, 9070, 8907, 8747,
    8590, 8435, 8284, 8135, 7988, 7845, 7704, 7565, 7429, 7296, 7164, 7036, 6909, 6785, 6663, 6543,
    6425, 6310, 6196, 6085, 5976, 5868, 5763, 5659, 5557, 5457, 5359, 5263, 5168, 5075, 4984, 4894,
    4806, 4720, 4635, 4552, 4470, 4390, 4311, 4233, 4157, 4082, 4009, 3937, 3866, 3796, 3728, 3661,
    3595, 3531, 3467, 3405, 3344, 3283, 3224, 3166, 3110, 3054, 2999, 2945, 2892, 2840, 2789, 2739,
    2689, 2641, 2594, 2547, 2501, 2456, 2412, 2369, 2326, 2284, 2243, 2203, 2163, 2124, 2086, 2048,
    2012, 1975, 1940, 1905, 1871, 1837, 1804, 1772, 1740,
];
const POW_11_RUNIC_DECREMENT = [ // PowerTables.c:251-261 (1-0.11)^x — W_CONFUSION
    65536, 63654, 61826, 60051, 58327, 56652, 55025, 53445, 51911, 50420, 48972, 47566, 46200, 44874, 43585, 42334,
    41118, 39938, 38791, 37677, 36595, 35544, 34524, 33533, 32570, 31634, 30726, 29844, 28987, 28155, 27346, 26561,
    25798, 25058, 24338, 23639, 22960, 22301, 21661, 21039, 20435, 19848, 19278, 18725, 18187, 17665, 17157, 16665,
    16186, 15721, 15270, 14832, 14406, 13992, 13590, 13200, 12821, 12453, 12095, 11748, 11411, 11083, 10765, 10456,
    10155, 9864, 9581, 9305, 9038, 8779, 8527, 8282, 8044, 7813, 7589, 7371, 7159, 6954, 6754, 6560,
    6372, 6189, 6011, 5838, 5671, 5508, 5350, 5196, 5047, 4902, 4761, 4624, 4492, 4363, 4237, 4116,
    3997, 3883, 3771, 3663, 3558, 3456, 3356, 3260, 3166, 3075, 2987, 2901, 2818, 2737, 2658, 2582,
    2508, 2436, 2366, 2298, 2232, 2168, 2106, 2045, 1986, 1929, 1874, 1820, 1768, 1717, 1668, 1620,
    1573, 1528, 1484, 1442, 1400, 1360, 1321, 1283, 1246, 1210, 1176, 1142, 1109, 1077, 1046, 1016,
    987, 959, 931, 904, 878, 853, 829, 805, 782, 759, 737, 716, 696, 676, 656, 637,
    619, 601, 584, 567, 551, 535, 520, 505, 490, 476, 462, 449, 436, 424, 412, 400,
    388, 377, 366, 356, 345, 336, 326, 317, 307, 299, 290, 282, 274, 266, 258, 251,
    243, 236, 230, 223, 217, 210, 204, 198, 193,
];
const POW_15_RUNIC_DECREMENT = [ // PowerTables.c:231-240 (1-0.15)^x — W_FORCE（CE 的 W_MULTIPLICITY 同用此表）
    65536, 62926, 60421, 58015, 55705, 53487, 51358, 49313, 47349, 45464, 43654, 41916, 40247, 38644, 37106, 35628,
    34210, 32848, 31540, 30284, 29078, 27920, 26809, 25741, 24716, 23732, 22787, 21880, 21009, 20172, 19369, 18598,
    17857, 17146, 16464, 15808, 15179, 14574, 13994, 13437, 12902, 12388, 11895, 11421, 10967, 10530, 10111, 9708,
    9321, 8950, 8594, 8252, 7923, 7608, 7305, 7014, 6735, 6466, 6209, 5962, 5724, 5496, 5278, 5067,
    4866, 4672, 4486, 4307, 4136, 3971, 3813, 3661, 3515, 3375, 3241, 3112, 2988, 2869, 2755, 2645,
    2540, 2439, 2341, 2248, 2159, 2073, 1990, 1911, 1835, 1762, 1692, 1624, 1559, 1497, 1438, 1380,
    1325, 1273, 1222, 1173, 1127, 1082, 1039, 997, 958, 919, 883, 848, 814, 781, 750, 720,
    692, 664, 638, 612, 588, 564, 542, 520, 500, 480, 461, 442, 425, 408, 391, 376,
    361, 346, 333, 319, 307, 294, 283, 271, 261, 250, 240, 231, 221, 213, 204, 196,
    188, 181, 173, 166, 160, 153, 147, 141, 136, 130, 125, 120, 115, 111, 106, 102,
    98, 94, 90, 87, 83, 80, 77, 74, 71, 68, 65, 62, 60, 58, 55, 53,
    51, 49, 47, 45, 43, 41, 40, 38, 37, 35, 34, 32, 31, 30, 29, 27,
    26, 25, 24, 23, 22, 21, 21, 20, 19,
];

/** web 符文名 → CE 递减表（对应 CE PowerTables.c:284-294 的 effectChances 数组）。
 * CE 的 W_SLOWING（POW_14）对应的 slowing 符文 web 尚未拥有，按本轮边界不予移植。 */
const WEAPON_RUNIC_TABLE: Record<string, readonly number[]> = {
    speed: POW_16_RUNIC_DECREMENT, // W_SPEED
    quietus: POW_6_RUNIC_DECREMENT, // W_QUIETUS
    paralyzing: POW_7_RUNIC_DECREMENT, // W_PARALYSIS（web 命名为 paralyzing）
    confusion: POW_11_RUNIC_DECREMENT, // W_CONFUSION
    force: POW_15_RUNIC_DECREMENT, // W_FORCE
};

/** CE 表外符文的固定触发率（PowerTables.c:303-305）：有害符文（Rogue.h:844 起，
 * W_MERCY/W_PLENTY）无递减表；web 自创的 vampirism/venom 同样无 CE 表可查。 */
export const RUNIC_WEAPON_BAD_CHANCE = 15;

/** runicWeaponChance 的武器上下文（CE 以 item* 直接取得的信息）。 */
export interface WeaponRunicContext {
    /** 武器基础伤害下界（CE range.lowerBound；web 取 CombatSystem.parseDamageString
     * 的 min——P1-7 校准后与 CE Globals.c weaponTable 的 range 完全一致） */
    damageMin: number;
    /** 武器基础伤害上界（CE range.upperBound；同上取 parseDamageString 的 max） */
    damageMax: number;
    /** CE ITEM_ATTACKS_STAGGER（Rogue.h:1376，mace/hammer 类迟滞武器）。
     * web 武器数据暂无等价标志，当前不会被置位，参数为本公式预留。 */
    attacksStagger?: boolean;
    /** CE ITEM_ATTACKS_QUICKLY（Rogue.h:1378，rapier 类迅捷武器）。
     * web 武器数据暂无等价标志，当前不会被置位，参数为本公式预留。 */
    attacksQuickly?: boolean;
}

/**
 * 武器符文触发率（百分比 0-100）。CE PowerTables.c:220-345 的忠实移植，
 * 替换旧线性近似 7 + 4·ench。
 *
 * CE 公式：chance = 100·(1 - (1-p)^(e·modifier))，其中 p 按符文种类取各自
 * 递减表（0.16/0.06/0.07/0.11/0.15），x = e·modifier 量化到 0.25 步进查表；
 * modifier = 1 - min(0.99, 武器基础伤害中值/18)，高伤武器触发率更低。
 * 实现按 CE 的 16.16 定点语义逐级截断（含内嵌原表），与 CE 逐值一致；
 * 与连续闭式公式的差仅剩表的 0.25 量化（≤3.1 个百分点）。
 *
 * @param enchantment 净附魔（CE netEnchant 口径：含力量修正、钳 [-20,50]；
 *                    PowerTables.c:306-308 取 netEnchant(theItem)，Combat.ts 传
 *                    netEnchant 的结果而非面板附魔）
 * @param runicKind   web 符文类别名。slaying 恒为 0（非概率触发）；
 *                    mercy 与 CE 同位（有害符文固定 15）；vampirism/venom 为
 *                    web 自创、CE 无对应，按"表外符文"口径固定 15；未提供时同。
 * @param weapon      武器基础伤害上下文；缺省时按无高伤惩罚（modifier = 1）处理
 */
export function runicWeaponChance(
    enchantment: number,
    runicKind?: string,
    weapon?: WeaponRunicContext
): number {
    // PowerTables.c:300-302：W_SLAYING 非概率触发（对 vorpal 类别必杀），返回 0
    if (runicKind === 'slaying') {
        return 0;
    }
    // PowerTables.c:303-305：有害符文（runicType >= NUMBER_GOOD_WEAPON_ENCHANT_KINDS）
    // 不查表，固定 15。mercy 在 CE 即有害符文；vampirism/venom 与未提供类别的
    // 单参兼容形态（旧调用点 armor_model_effect.test.ts）均无 CE 表，套用同口径。
    if (runicKind === undefined || !(runicKind in WEAPON_RUNIC_TABLE)) {
        return RUNIC_WEAPON_BAD_CHANCE;
    }
    const table = WEAPON_RUNIC_TABLE[runicKind]!;

    // PowerTables.c:310-316：adjustedBaseDamage = 武器表 range 中值（C 整数除法
    // 截断）。迟滞武器按"每两回合攻击一次"归一化再减半；迅捷武器的对应加倍在 CE
    // 源码 317-319 行被注释停用（"Testing disabling this for balance reasons"），
    // 如实保留该不对称。
    let adjustedBaseDamage = Math.floor(((weapon?.damageMin ?? 0) + (weapon?.damageMax ?? 0)) / 2);
    if (weapon?.attacksStagger) {
        adjustedBaseDamage = Math.floor(adjustedBaseDamage / 2);
    }

    // PowerTables.c:321：modifier = 1 - min(0.99, adjustedBaseDamage/18)（定点）
    const modifier =
        FP_FACTOR -
        Math.min(Math.trunc((99 * FP_FACTOR) / 100), Math.trunc((adjustedBaseDamage * FP_FACTOR) / 18));

    let chance: number;
    if (enchantment < 0) {
        // PowerTables.c:323-324：负附魔查表前归零（末尾下限会抬到 1）
        chance = 0;
    } else {
        // PowerTables.c:326-327：tableIndex = enchantLevel·modifier·4/FP/FP——CE 为
        // 两级整数除法逐级截断。净附魔为 0.25 步进值，×FP 后是精确整数。
        const enchantFix = Math.round(enchantment * FP_FACTOR);
        let tableIndex = Math.trunc((enchantFix * modifier * 4) / FP_FACTOR);
        tableIndex = Math.trunc(tableIndex / FP_FACTOR);
        tableIndex = Math.max(0, Math.min(table.length - 1, tableIndex));
        // PowerTables.c:328：chance = 100 - 表值/FP
        chance = 100 - Math.trunc((100 * table[tableIndex]!) / FP_FACTOR);
    }

    // PowerTables.c:331-334：迟滞武器两回合攻击两次 → 1-(1-c)²（两次机会）
    if (weapon?.attacksStagger) {
        chance = 100 - Math.trunc(((100 - chance) * (100 - chance)) / 100);
    }
    // PowerTables.c:335-338：迅捷武器攻击速度快一倍 → 1-√(1-c)（半次机会）。
    // CE 的 fp_sqrt（Math.c:224）为定点开方表，此处以 float sqrt 近似（<0.02% 噪声）
    if (weapon?.attacksQuickly) {
        const inner = FP_FACTOR - Math.trunc((chance * FP_FACTOR) / 100);
        const sqrtFix = Math.trunc(Math.sqrt(inner / FP_FACTOR) * FP_FACTOR);
        chance = Math.trunc((100 * (FP_FACTOR - sqrtFix)) / FP_FACTOR);
    }

    // PowerTables.c:340-342：下限 max(1, 净附魔)——即使重武器，每点附魔也至少
    // +1% 触发率；负附魔与 0 附魔经此下限返回 1 而非 0
    chance = Math.max(Math.min(chance, 100), Math.max(1, Math.trunc(enchantment)));
    return chance;
}

// ─── 护甲符文强度（CE PowerTables.c:106-123 的忠实移植）───
// CE 护甲符文没有统一触发率：reflection 查表、absorption/reprisal/mutuality
// 恒触发（强度只由净附魔决定）。入参一律取 netEnchant 口径（含力量修正、
// 钳 [-20,50]，与 playerDefense 同源）。

/** CE PowerTables.c:106：armorReprisalPercent = max(5, (int)(enchant·5/FP_FACTOR))。
 * fixpt 截断即 floor(e·5)（e 可为 0.25 步进的分数，如 e=1.5 → 7）；下限 5。 */
export function armorReprisalPercent(enchant: number): number {
    return Math.max(5, Math.trunc(enchant * 5));
}

/** CE PowerTables.c:107：armorAbsorptionMax = max(1, (int)(enchant/FP_FACTOR))，即 max(1, floor(e))。 */
export function armorAbsorptionMax(enchant: number): number {
    return Math.max(1, Math.trunc(enchant));
}

/** CE PowerTables.c:110-119 的 POW_REFLECT 原表：0.85^x × 65536，x 从 0.25 到 50、
 * 0.25 步进（200 项）。与 round(0.85^x·65536) 有 ≤1 的生成噪声，内嵌原表保证逐值一致。 */
const POW_REFLECT = [
    62926, 60421, 58015, 55705, 53487, 51358, 49313, 47349, 45464, 43654, 41916, 40247, 38644, 37106, 35628, 34210,
    32848, 31540, 30284, 29078, 27920, 26809, 25741, 24716, 23732, 22787, 21880, 21009, 20172, 19369, 18598, 17857,
    17146, 16464, 15808, 15179, 14574, 13994, 13437, 12902, 12388, 11895, 11421, 10967, 10530, 10111, 9708, 9321,
    8950, 8594, 8252, 7923, 7608, 7305, 7014, 6735, 6466, 6209, 5962, 5724, 5496, 5278, 5067, 4866,
    4672, 4486, 4307, 4136, 3971, 3813, 3661, 3515, 3375, 3241, 3112, 2988, 2869, 2755, 2645, 2540,
    2439, 2341, 2248, 2159, 2073, 1990, 1911, 1835, 1762, 1692, 1624, 1559, 1497, 1438, 1380, 1325,
    1273, 1222, 1173, 1127, 1082, 1039, 997, 958, 919, 883, 848, 814, 781, 750, 720, 692,
    664, 638, 612, 588, 564, 542, 520, 500, 480, 461, 442, 425, 408, 391, 376, 361,
    346, 333, 319, 307, 294, 283, 271, 261, 250, 240, 231, 221, 213, 204, 196, 188,
    181, 173, 166, 160, 153, 147, 141, 136, 130, 125, 120, 115, 111, 106, 102, 98,
    94, 90, 87, 83, 80, 77, 74, 71, 68, 65, 62, 60, 58, 55, 53, 51,
    49, 47, 45, 43, 41, 40, 38, 37, 35, 34, 32, 31, 30, 29, 27, 26,
    25, 24, 23, 22, 21, 21, 20, 19,
];

/**
 * 反射符文触发率（百分比 0-100）。CE PowerTables.c:109-123 reflectionChance 的忠实移植：
 * idx = clamp(trunc(e·4) - 1, 0, 199)（表以 x=0.25 起，故减一），
 * chance = clamp(100 - trunc(100·POW_REFLECT[idx]/65536), 1, 100)。
 * 与连续闭式 clamp(100·(1-0.85^e), 1, 100) 差 ≤1 个百分点（定点截断 + 表噪声）。
 * CE 中 reflection 只对投掷物/法术生效（Items.c:4969 projectileReflects），不作用于近战。
 */
export function reflectionChance(enchant: number): number {
    const idx = Math.max(0, Math.min(POW_REFLECT.length - 1, Math.trunc(enchant * 4) - 1));
    return Math.max(1, Math.min(100, 100 - Math.trunc((100 * POW_REFLECT[idx]!) / 65536)));
}

/**
 * Weapon paralysis duration based on enchantment.
 * CE: weaponParalysisDuration(enchant) — scales ~2 + enchant/2
 */
export function weaponParalysisDuration(enchantment: number): number {
    return Math.max(2, 2 + Math.floor(enchantment / 2));
}

/**
 * Weapon slowness duration.
 */
export function weaponSlowDuration(enchantment: number): number {
    return Math.max(3, 3 + Math.floor(enchantment / 2));
}

/**
 * Weapon confusion duration.
 */
export function weaponConfusionDuration(enchantment: number): number {
    return Math.max(3, 3 + Math.floor(enchantment * 0.75));
}

/**
 * Number of spectral images from multiplicity runic.
 * CE: weaponImageCount(enchant) — roughly min(7, 1 + enchant/3)
 */
export function weaponImageCount(enchantment: number): number {
    return Math.max(1, Math.min(7, 1 + Math.floor(enchantment / 3)));
}

/**
 * Force weapon knockback distance.
 * CE: weaponForceDistance(enchant) — roughly enchant/2 + 2
 */
export function weaponForceDistance(enchantment: number): number {
    return Math.max(1, Math.floor(enchantment / 2) + 2);
}
