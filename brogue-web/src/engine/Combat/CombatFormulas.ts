/**
 * src/engine/Combat/CombatFormulas.ts
 * Pure math functions ported from Brogue CE Combat.c
 * All functions are stateless and testable independently.
 */

// CE uses a fixed-point factor of 1000 (FP_FACTOR)
// We work in floating point for simplicity.

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
    return Math.pow(1.065, netEnch);
}

/**
 * Damage fraction: how much damage is scaled by enchantment.
 * CE formula: 1.065 ^ netEnchant
 */
export function damageFraction(netEnch: number): number {
    return Math.pow(1.065, netEnch);
}

/**
 * Defense fraction: how hit probability is reduced by defense.
 * CE formula: 0.987 ^ defense
 * Higher defense = lower fraction = harder to hit.
 */
export function defenseFraction(defense: number): number {
    return Math.pow(0.987, defense);
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
    let accuracy = attackerAccuracy;
    if (weaponNetEnchant !== undefined) {
        accuracy = accuracy * accuracyFraction(weaponNetEnchant);
    }
    const prob = accuracy * defenseFraction(defenderDefense);
    return Math.max(0, Math.min(100, Math.round(prob)));
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
 * 与 CE 的量化差异：CE 定点存储会把 ×10 值截断为整数（如 32.5 → 32），web 保留
 * float 理想值，与 defenseFraction 等既有约定的误差口径一致（≤0.05 显示点）。
 */
export function playerDefense(
    baseArmor: number,
    enchantment: number,
    playerStrength: number,
    requiredStrength: number
): number {
    const netEnch = netEnchant(enchantment, playerStrength, requiredStrength);
    return Math.max(0, (baseArmor + netEnch) * 10);
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
    if (clumping <= 1 || min >= max) {
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

/**
 * Runic weapon trigger chance based on enchantment.
 * CE uses: runicWeaponChance which scales with enchantment level.
 * Base chance ranges roughly: enchant 0 → ~10%, enchant 3 → ~20%, enchant 10 → ~50%
 * Formula approximation: 7 + enchant * 4, clamped [3, 90]
 */
export function runicWeaponChance(enchantment: number): number {
    const chance = 7 + enchantment * 4;
    return Math.max(3, Math.min(90, Math.round(chance)));
}

/**
 * Runic armor trigger chance.
 * Similar scaling, slightly lower base.
 * Approximation: 5 + enchant * 3, clamped [3, 80]
 */
export function runicArmorChance(enchantment: number): number {
    const chance = 5 + enchantment * 3;
    return Math.max(3, Math.min(80, Math.round(chance)));
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
