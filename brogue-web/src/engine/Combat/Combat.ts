/**
 * src/engine/Combat/Combat.ts
 * Translates Brogue CE's Combat.c hit probabilities, damage math,
 * and damage resolution into TypeScript.
 */

import { Creature } from '../../entities/Creature';
import { Player } from '../../entities/Player';
import { Monster } from '../../entities/Monster';
import { rng } from '../Random';
import {
    netEnchant,
    hitProbability,
    damageFraction,
    playerDefense,
    clumpedRoll,
    runicWeaponChance
} from './CombatFormulas';

export interface AttackResult {
    damage: number;
    weaponName?: string;
    /** True if the attack hit (damage is dealt in full; CE armor never reduces damage) */
    hit: boolean;
    /** True if the defender was sleeping/unaware (triple damage) */
    backstab: boolean;
    /** Runic that triggered, if any */
    triggeredRunic?: string;
}

export class CombatSystem {

    /**
     * Resolves an attack from one creature to another.
     * Implements CE-accurate hit probability and damage formulas.
     */
    public static attack(attacker: Creature, defender: Creature): AttackResult {
        let attackerAccuracy = 100; // Player base accuracy
        let defenderDefense = 0;
        let damageString = '1d4'; // default unarmed
        let weaponName = 'bare hands';
        let weaponEnchant: number | undefined;
        let weaponRunic: string | undefined;
        let backstab = false;
        let clumping = 1;

        // --- Determine attacker stats ---
        if (attacker instanceof Player) {
            if (attacker.equippedWeapon && attacker.equippedWeapon.damage) {
                damageString = attacker.equippedWeapon.damage;
                weaponName = attacker.equippedWeapon.name;
                const strReq = attacker.equippedWeapon.strengthRequired || 0;
                weaponEnchant = netEnchant(
                    attacker.equippedWeapon.enchantment,
                    attacker.strength,
                    strReq
                );
                weaponRunic = attacker.equippedWeapon.runicType;
            }
        } else if (attacker instanceof Monster) {
            attackerAccuracy = attacker.accuracy;
            damageString = attacker.damageString || '1d3';
            weaponName = 'claws/teeth';
        }

        // --- Determine defender stats ---
        if (defender instanceof Monster) {
            defenderDefense = defender.defense;
        } else if (defender instanceof Player) {
            // Player defense comes from equipped armor.
            // CE 内部 ×10 标度（Items.c:8515-8523），只降低被命中概率（Combat.c:140），
            // 不参与伤害结算——CE 的护甲没有任何"减伤"步骤。
            if (defender.equippedArmor && defender.equippedArmor.armor) {
                const strReq = defender.equippedArmor.strengthRequired || 0;
                defenderDefense = playerDefense(
                    defender.equippedArmor.armor,
                    defender.equippedArmor.enchantment,
                    defender.strength,
                    strReq
                );
            }
        }

        // --- Auto-hit conditions ---
        const defenderStuck = defender.hasStatus('paralyzed');
        const defenderAsleep = (defender instanceof Monster) &&
            (defender.state === 0 /* ASLEEP */);
        const autoHit = defenderStuck || defenderAsleep;

        // Backstab: sleeping, paralyzed, or unaware targets take triple damage
        if (defenderAsleep || defenderStuck) {
            backstab = true;
        }

        // --- Calculate hit probability ---
        let hitProb: number;
        if (autoHit) {
            hitProb = 100;
        } else {
            hitProb = hitProbability(attackerAccuracy, defenderDefense, weaponEnchant);
        }

        // --- Roll to hit ---
        if (!rng.randPercent(hitProb)) {
            return { damage: 0, weaponName, hit: false, backstab: false };
        }

        // --- Calculate damage ---
        const parts = CombatSystem.parseDamageString(damageString);
        let damage = clumpedRoll(
            parts.min,
            parts.max,
            clumping,
            (lo, hi) => rng.randRange(lo, hi)
        );

        // Apply weapon enchantment damage scaling
        if (weaponEnchant !== undefined && weaponEnchant !== 0) {
            const dmgMult = damageFraction(weaponEnchant);
            damage = Math.max(1, Math.round(damage * dmgMult));
        }

        // Monster damage adjustment (weakness debuff)
        if (attacker instanceof Monster && attacker.hasStatus('weakened')) {
            damage = Math.max(1, Math.floor(damage * 0.5));
        }

        // Player weakness adjustment
        if (attacker instanceof Player && attacker.hasStatus('weakened')) {
            damage = Math.max(1, Math.floor(damage * 0.5));
        }

        // Backstab triple damage
        if (backstab) {
            damage *= 3;
        }

        // Invisibility bonus (+50% damage)
        if (attacker instanceof Player && attacker.hasStatus('invisible') && !backstab) {
            damage = Math.floor(damage * 1.5);
        }

        // CE 护甲不参与伤害结算：防御值已在上面进入命中率掷骰（Combat.c:140），
        // 命中后按伤害骰全额扣血，没有任何"护甲减伤"步骤（全 CE 源码无此实现）。

        // Minimum 1 damage on a hit
        if (damage < 1) damage = 1;

        // --- Check for runic trigger ---
        let triggeredRunic: string | undefined;
        if (weaponRunic && attacker instanceof Player && attacker.equippedWeapon) {
            const enchant = attacker.equippedWeapon.enchantment;
            const triggerChance = runicWeaponChance(enchant);
            // Backstab doubles runic chance (CE: min(chance*2, (chance+100)/2))
            let adjustedChance = triggerChance;
            if (backstab && adjustedChance < 100) {
                adjustedChance = Math.min(adjustedChance * 2, Math.floor((adjustedChance + 100) / 2));
            }
            if (rng.randPercent(adjustedChance)) {
                triggeredRunic = weaponRunic;
            }
        }

        // Apply damage
        defender.takeDamage(damage);

        return { damage, weaponName, hit: true, backstab, triggeredRunic };
    }

    /**
     * Parse a damage string like "2d4", "1d6+2", "3d3" into min/max range.
     */
    public static parseDamageString(ds: string): { min: number; max: number; clumping: number } {
        // Support formats: "XdY", "XdY+Z", "X-Y"
        const diceMatch = ds.match(/^(\d+)d(\d+)(?:\+(\d+))?$/);
        if (diceMatch) {
            const count = parseInt(diceMatch[1]!, 10);
            const sides = parseInt(diceMatch[2]!, 10);
            const bonus = diceMatch[3] ? parseInt(diceMatch[3], 10) : 0;
            return {
                min: count + bonus,
                max: count * sides + bonus,
                clumping: count
            };
        }

        const rangeMatch = ds.match(/^(\d+)-(\d+)$/);
        if (rangeMatch) {
            return {
                min: parseInt(rangeMatch[1]!, 10),
                max: parseInt(rangeMatch[2]!, 10),
                clumping: 1
            };
        }

        // Fallback: treat as a constant
        const val = parseInt(ds, 10) || 1;
        return { min: val, max: val, clumping: 1 };
    }
}
