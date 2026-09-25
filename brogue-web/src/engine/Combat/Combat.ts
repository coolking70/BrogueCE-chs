/**
 * src/engine/Combat/Combat.ts
 * Translates Brogue CE's Combat.c hit probabilities, damage math,
 * and damage resolution into TypeScript.
 */

import { monsterDamageAdjustmentAmount, monsterAccuracyAdjusted, monsterDefenseAdjusted } from './CombatFormulas';
import { Creature } from '../../entities/Creature';
import { Player } from '../../entities/Player';
import { Monster, MonsterState } from '../../entities/Monster';
import type { Item } from '../Items/Item';
import { ringBonus } from '../Items/RingBonuses';
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
    /** True if the attack hit, including a fully shielded hit */
    hit: boolean;
    /** True if the defender was sleeping/unaware (triple damage) */
    backstab: boolean;
    /**
     * B-1：CE attack() 的第三形参（Combat.c:1139）——刺剑突进攻击
     * （ITEM_LUNGE_ATTACKS 移动攻击）。突进与偷袭共用同一倍率触发集与
     * 自动命中（Combat.c:1239/1260），但不进符文触发率翻倍集（Combat.c:1420
     * 只收 sneakAttack || asleep || paralyzed），也不置 backstab 消息位。
     */
    lunge?: boolean;
    /** Runic that triggered, if any */
    triggeredRunic?: string;
    /**
     * P4-4：CE MA_KAMIKAZE（Combat.c:1159-1162）——攻击者代替造成伤害而自毁。
     * true 时 damage 恒为 0，defender 完全未受影响；调用方应据此显示专门的
     * "自爆"消息，而不是把 damage===0 当成"没打中"处理。
     */
    kamikazeSelfDestruct?: boolean;
    /**
     * P4-5：CE MA_SEIZES（Combat.c:1212-1237）——攻击者第一次贴身命中不是攻击，
     * 是"抓住"：伤害恒为 0，双方 seizing/seized 标记置位，直接 return false
     * （早于 attackHit 命中掷骰）。true 时 hit 恒为 false、damage 恒为 0，
     * 调用方应据此显示专门的"抓住"消息，而不是当成普通 miss。
     */
    seized?: boolean;
}

export class CombatSystem {

    /**
     * Resolves an attack from one creature to another.
     * Implements CE-accurate hit probability and damage formulas.
     */
    public static attack(attacker: Creature, defender: Creature, opts?: {
        /**
         * P4-3：CE attack()（Combat.c:1243-1245）把 MONST_IMMUNE_TO_WEAPONS 的豁免
         * 限定在“武器伤害”——近战与投掷武器都走这条 attack() 复用路径，默认 true。
         * BE_DAMAGE 已由 U06 独立结算；BE_ATTACK 保持 true
         * （CE inflictDamage 本身只认 MONST_INVULNERABLE，不检查 IMMUNE_TO_WEAPONS）。
         */
        isWeaponAttack?: boolean;
        /** CE armor adjustment precedes contact poison and shield absorption. */
        beforeDamage?: (damage: number) => number;
        /**
         * B-1：CE attack(attacker, defender, lungeAttack) 第三形参——刺剑突进
         * （Movement.c:1482-1483 对 hitList 结算时按武器 LUNGE 旗标传入）。
         * 效果：①该击自动命中（Combat.c:1239 的 || 短路）；
         * ②伤害吃 ×3/×5 偷袭倍率（Combat.c:1259-1268）。
         */
        lungeAttack?: boolean;
    }): AttackResult {
        let attackerAccuracy = 100; // Player base accuracy
        let defenderDefense = 0;
        let damageString = '1d2'; // CE monsterCatalog[MK_YOU]
        let weaponName = 'bare hands';
        let weaponEnchant: number | undefined;
        let weaponRunic: string | undefined;
        let backstab = false;
        let clumping: number | undefined;

        // --- Determine attacker stats ---
        if (attacker instanceof Player) {
            if (!attacker.equippedWeapon) attackerAccuracy = monsterAccuracyAdjusted(100, attacker.weaknessAmount);
            if (attacker.equippedWeapon && attacker.equippedWeapon.damage) {
                damageString = attacker.equippedWeapon.damage;
                clumping = attacker.equippedWeapon.clumping;
                weaponName = attacker.equippedWeapon.name;
                const strReq = attacker.equippedWeapon.strengthRequired || 0;
                weaponEnchant = netEnchant(
                    attacker.equippedWeapon.enchantment,
                    attacker.effectiveStrength,
                    strReq
                );
                weaponRunic = attacker.equippedWeapon.runicType;
            }
        } else if (attacker instanceof Monster) {
            attackerAccuracy = monsterAccuracyAdjusted(attacker.accuracy, attacker.weaknessAmount);
            damageString = attacker.damageString || '1d3';
            clumping = attacker.damageClumping;
            weaponName = 'claws/teeth';
        }

        // --- Determine defender stats ---
        if (defender instanceof Monster) {
            defenderDefense = monsterDefenseAdjusted(defender.defense, defender.weaknessAmount);
        } else if (defender instanceof Player) {
            // Player defense comes from equipped armor.
            // CE 内部 ×10 标度（Items.c:8515-8523），只降低被命中概率（Combat.c:140），
            // 不参与伤害结算——CE 的护甲没有任何"减伤"步骤。
            if (defender.equippedArmor && defender.equippedArmor.armor) {
                const strReq = defender.equippedArmor.strengthRequired || 0;
                defenderDefense = playerDefense(
                    defender.equippedArmor.armor,
                    defender.equippedArmor.enchantment,
                    defender.effectiveStrength,
                    strReq,
                    defender.getStatusDuration('donning')
                );
            }
        }

        // --- Auto-hit conditions ---
        // B-1：触发集对齐 CE attack()（Combat.c:1190-1196 + 1239）：
        //   - defenderWasAsleep   = 目标 MONSTER_SLEEPING（Combat.c:1196-1198）
        //   - defenderWasParalyzed = STATUS_PARALYZED > 0（Combat.c:1199）
        //   - sneakAttack         = 玩家攻击 WANDERING 目标（Combat.c:1193-1195；
        //     CE 的 creatureState==WANDERING 天然排除盟友，web 的 isAlly 是独立
        //     维度，须显式排除）
        //   - lungeAttack         = 突进（opts 传入，Movement.c:1482-1483）
        // CE Combat.c:1190-1194：MONST_INANIMATE 目标（镜像等无生命物）身上
        // 三类偷袭标志一律清零——web 原实现漏了这层守卫，此处照 CE 补上。
        const inanimateDefender = (defender instanceof Monster) &&
            defender.hasBehavior('MONST_INANIMATE');
        const defenderStuck = !inanimateDefender && defender.hasStatus('paralyzed');
        const defenderAsleep = !inanimateDefender && (defender instanceof Monster) &&
            (defender.state === MonsterState.ASLEEP);
        const sneakAttack = !inanimateDefender && (attacker instanceof Player) &&
            (defender instanceof Monster) && !defender.isAlly &&
            defender.state === MonsterState.WANDERING;
        const lungeAttack = opts?.lungeAttack === true;

        // Backstab: sleeping, paralyzed, or unaware targets take triple damage
        if (defenderAsleep || defenderStuck || sneakAttack) {
            backstab = true;
        }

        // 偷袭触发集整体自动命中（CE Combat.c:1239 的 || 短路，attackHit 不掷）。
        // attackHit() has its own short circuit, even for an inanimate paralyzed
        // defender: it auto-hits without granting the sneak damage multiplier.
        const autoHit = backstab || lungeAttack || defender.hasStatus('paralyzed') || defender.hasStatus('stuck')
            || (defender instanceof Monster && defender.isCaged);
        // --- P4-4: MA_KAMIKAZE (Combat.c:1159-1162) ---
        // CE 的检查在 attackHit() 掷骰之前（line 1159 早于 line 1240 的命中判定）：
        // 自爆怪物的攻击永远"成功"，不参与命中率——攻击者直接自毁代替造成伤害，
        // defender 完全不受影响。三只膨胀怪的 damage 都是 0d1，真正的杀伤来自
        // 死亡时触发的 DF（Game.triggerDeathFeatures），不是这次攻击本身。
        if (attacker instanceof Monster && attacker.hasAbility('MA_KAMIKAZE')) {
            attacker.takeDamage(attacker.hp, true);
            return { damage: 0, weaponName, hit: true, backstab: false, kamikazeSelfDestruct: true };
        }

        // CE Combat.c:1173-1177: this is a rejected physical attack, before
        // entrancement release. BE_DAMAGE has a separate U06 path.
        if (opts?.isWeaponAttack !== false && attacker instanceof Monster
            && attacker.hasBehavior('MONST_RESTRICTED_TO_LIQUID')
            && (defender.hasStatus('levitating') || defender.hasStatus('flying'))) {
            return { damage: 0, weaponName, hit: false, backstab: false };
        }

        // W-18 CE Combat.c:1183: attempts release entrancement even on a miss.
        // U06 handles BE_DAMAGE aggression in its separate damage path.
        if (opts?.isWeaponAttack !== false) {
            defender.setStatusDuration('entranced', 0);
            defender.shortenMagicalFear();
        }

        // --- P4-5: MA_SEIZES (Combat.c:1212-1237) ---
        // CE 条件：attacker 带 MA_SEIZES，且"不是（attacker 已经在抓 && defender
        // 已经被抓）"——即两个标记还没有同时置位时，这一下贴脸就是"抓住"而不是
        // 攻击：双方标记置位，伤害恒 0，直接 return false，不参与 attackHit 命中
        // 掷骰（比下面的命中率计算更早）。调用方（web 假定进 attack() 时双方
        // 已经相邻，距离判定由各调用点的 distToPlayer<=1 保证，对应 CE 的
        // distanceBetween==1 检查）。
        if (attacker instanceof Monster && attacker.hasAbility('MA_SEIZES') &&
            (!attacker.seizing || !defender.seized)) {
            attacker.seizing = true;
            defender.seized = true;
            return { damage: 0, weaponName, hit: false, backstab: false, seized: true };
        }

        // Seizing is probability=100, NOT an attackHit short circuit: it still
        // rolls 0..99. Sleeping/sneak/paralysis/lunge/captive bypass that roll.
        if (!autoHit && !rng.randPercent(defender.seized && attacker.seizing
            ? 100 : hitProbability(attackerAccuracy, defenderDefense, weaponEnchant))) {
            return { damage: 0, weaponName, hit: false, backstab: false };
        }

        if (opts?.isWeaponAttack === false) defender.setStatusDuration('entranced', 0);

        const parts = CombatSystem.parseDamageString(damageString);
        let { min, max } = parts;
        if (weaponEnchant !== undefined) {
            // CE Items.c recalculateEquipmentBonuses: scale/truncate endpoints
            // BEFORE randClump, preserving clumpFactor and every interior value.
            const fraction = damageFraction(weaponEnchant);
            min = Math.max(1, Math.trunc(min * fraction));
            max = Math.max(1, Math.trunc(max * fraction));
        }
        const isWeaponAttack = opts?.isWeaponAttack !== false;
        const immune = defender instanceof Monster && (defender.isInvulnerable()
            || (isWeaponAttack && defender.isImmuneToWeapons()));
        // CE Combat.c:1242-1246: immunity skips damage RNG entirely. Zero damage
        // ranges stay zero. Weakness scales the rolled damage, before sneak multipliers.
        let damage = immune ? 0 : clumpedRoll(min, max, clumping ?? parts.clumping,
            (lo, hi) => rng.randRange(lo, hi));

        if (attacker instanceof Monster) damage = Math.trunc(damage * monsterDamageAdjustmentAmount(attacker.weaknessAmount));

        // CE :1248-1258: only the sneak set delays/wakes a monster, even on an
        // immune hit; lunge/captive/attackHit-only paralysis do not.
        if (backstab && defender instanceof Monster) {
            defender.ticksUntilTurn += Math.max(defender.movementSpeed, defender.attackSpeed);
            if (!defender.isAlly) defender.state = MonsterState.HUNTING;
        }

        // B-1：CE Combat.c:1259-1268 —— 偷袭触发集（sneakAttack || asleep ||
        // paralyzed || lungeAttack）命中时只乘【一次】倍率：玩家装备匕首
        //（ITEM_SNEAK_ATTACK_BONUS）×5，否则通用 ×3。web 原本只有 asleep/
        // paralyzed 两支触发 ×3（基线已存在），本轮补上 sneakAttack(WANDERING)
        // 与 lungeAttack 两支触发和匕首的 ×5 升档。
        // 注意：backstab 字段保留"符文触发率翻倍集"语义（CE Combat.c:1419-1421
        // 只收 sneakAttack || asleep || paralyzed，不含 lungeAttack），突进只
        // 走下面的倍率与自动命中，不置 backstab。
        if (backstab || lungeAttack) {
            const daggerSneak = attacker instanceof Player &&
                attacker.equippedWeapon?.flags?.includes('ITEM_SNEAK_ATTACK_BONUS');
            damage *= daggerSneak ? 5 : 3;
        }

        // CE has no independent invisible damage multiplier. Visibility can
        // affect awareness through AI.

        if (damage > 0 && opts?.beforeDamage) damage = opts.beforeDamage(damage) ?? damage;

        // W-10 / CE Combat.c:1320-1323,1404,524-527: physical MA_POISONS
        // replaces rolled damage with 1 contact damage; the original roll becomes
        // poison duration. Centralized here for player, ally and geometry targets.
        // BE_DAMAGE is resolved separately by U06.
        const poisonDuration = isWeaponAttack && attacker instanceof Monster
            && attacker.hasAbility('MA_POISONS') && damage > 0 ? damage : 0;
        if (poisonDuration > 0) damage = 1;


        // --- Check for runic trigger ---
        let triggeredRunic: string | undefined;
        if (weaponRunic && attacker instanceof Player && attacker.equippedWeapon) {
            // CE Combat.c:666-677：触发率取 runicWeaponChance——内部按 CE netEnchant
            // （含力量修正，PowerTables.c:306-308）与武器基础伤害中值计算；此处传
            // 已算好的净附魔 weaponEnchant 与 parseDamageString 的基础伤害区间
            // （与 CE range.lowerBound/upperBound 同口径）。
            const triggerChance = runicWeaponChance(
                weaponEnchant ?? attacker.equippedWeapon.enchantment,
                weaponRunic,
                { damageMin: parts.min, damageMax: parts.max }
            );
            // Backstab doubles runic chance (CE: min(chance*2, (chance+100)/2))
            let adjustedChance = triggerChance;
            if (backstab && adjustedChance < 100) {
                adjustedChance = Math.min(adjustedChance * 2, Math.floor((adjustedChance + 100) / 2));
            }
            if (rng.randPercent(adjustedChance)) {
                triggeredRunic = weaponRunic;
            }
        }

        // Reflection has already selected the actual defender in bolt travel.
        const applyTo = defender;
        if (damage > 0) {
            const hpDamage = applyTo.absorbShieldDamage(damage);
            CombatSystem.transferMonsterHealth(attacker, applyTo, hpDamage);
            applyTo.takeDamage(hpDamage, true); // already passed through the shield exactly once
            if (poisonDuration > 0) applyTo.addPoison(poisonDuration, 1);
        } else {
            // CE inflictDamage still applies the ring's minimum ±1 on a hit
            // whose weapon damage was reduced to zero.
            CombatSystem.transferMonsterHealth(attacker, applyTo, 0);
        }

        if (isWeaponAttack && defender.hp > 0 && damage > 0 && attacker instanceof Monster && attacker.hasAbility('MA_CAUSES_WEAKNESS')
            && !(defender instanceof Monster && (defender.hasCEBehavior('MONST_INANIMATE') || defender.isInvulnerable()))) {
            defender.weaken(300); // GlobalsBrogue.c:onHitWeakenDuration, survivor gate; damage is the pre-shield roll.
        }

        if (defender instanceof Monster) defender.enrageAfterAttack();
        return { damage, weaponName, hit: true, backstab, lunge: lungeAttack, triggeredRunic };
    }

    /** CE inflictDamage (Combat.c:1847-1871), after shielding and before
     * subtracting HP. The original attacker owns reflected damage; no maxHP cap.
     * Environment/poison ticks have no attacker and do not call this helper. */
    public static transferMonsterHealth(attacker: Creature, defender: Creature, hpDamage: number): void {
        if (defender instanceof Monster && (defender.hasCEBehavior('MONST_INANIMATE') || defender.isInvulnerable())) return;
        const dealt = Math.min(hpDamage, defender.hp);
        if (attacker instanceof Player) {
            const bonus = ringBonus(attacker.rings(), 'ring_of_transference');
            if (!bonus) return;
            const amount = Math.trunc(dealt * bonus / 20);
            const transfer = amount || (bonus > 0 ? 1 : -1);
            if (transfer < 0) attacker.takeDamage(-transfer, true);
            else attacker.hp += transfer;
        } else if (attacker instanceof Monster && attacker.hasAbility('MA_TRANSFERENCE')) {
            attacker.hp += Math.trunc(dealt * (attacker.isAlly ? 4 : 9) / 10);
        }
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
        const parsed = parseInt(ds, 10);
        const val = Number.isNaN(parsed) ? 1 : parsed;
        return { min: val, max: val, clumping: 1 };
    }

    /**
     * B-2：投掷武器命中结算 —— CE hitMonsterWithProjectileWeapon（Items.c:6771-6860）
     * 的命中/伤害核心。与近战 attack() 的系统性差异（CE 原样，逐条复核）：
     *  - 命中掷骰走 attackHit 语义（Combat.c:149-158）：只有 STUCK/PARALYZED/CAPTIVE
     *    自动命中；睡觉/游荡**不**自动命中、没有偷袭倍率（attack() 的
     *    `defenderWasAsleep || sneakAttack || lungeAttack ||` 短路在 attackHit 之外）。
     *  - 伤害 = randClump(damage) × damageFraction(netEnchant)（Items.c:6819-6821），
     *    无背刺 ×3/×5，无 invisible ×1.5。
     *  - MONST_IMMUNE_TO_WEAPONS | MONST_INVULNERABLE → 伤害恒 0（Items.c:6817-6818），
     *    且 **不掷伤害骰**（C 三目先判豁免再掷骰）。
     *  - 符文触发只在目标**存活**时掷（Items.c:6845-6849 的 else 分支——击杀分支
     *    不调 magicWeaponHit，与近战 attack() 恒调、内部再挡 MB_IS_DYING 不同）。
     * CE 把投掷物临时换手（equipItem → attackHit → 换回，Items.c:6804-6811）只为
     * 让命中吃投掷物净附魔；web 直接把净附魔传进 hitProbability，等价。
     * U14a 接魔法恐惧的投掷尝试解除；普通逃跑保留。
     */
    public static resolveThrownWeapon(
        thrower: Player,
        defender: Monster,
        item: Item
    ): { hit: boolean; damage: number; killed: boolean; triggeredRunic?: string } {
        // CE Items.c:6790: a thrown weapon attempt releases even on a miss.
        defender.setStatusDuration('entranced', 0);
        if (!defender.isCaged && (!defender.isAlly || defender.hasStatus('magical_fear'))
            && (defender.state !== MonsterState.FLEEING || defender.hasStatus('magical_fear'))) {
            defender.state = MonsterState.HUNTING;
            defender.shortenMagicalFear();
        }
        const strReq = item.strengthRequired || 0;
        const enchant = netEnchant(item.enchantment, thrower.effectiveStrength, strReq);

        // CE attackHit (Combat.c:149-158): short circuit, no accuracy roll.
        const autoHit = defender.hasStatus('paralyzed') || defender.hasStatus('stuck') || defender.isCaged;
        const hit = autoHit || rng.randPercent(hitProbability(100, monsterDefenseAdjusted(defender.defense, defender.weaknessAmount), enchant));
        if (!hit) {
            return { hit: false, damage: 0, killed: false };
        }

        // CE Items.c:6817-6821：豁免在三目里先判，豁免时不掷伤害骰。
        const immune = defender.isInvulnerable() || defender.isImmuneToWeapons();
        let damage = 0;
        if (!immune) {
            const parts = CombatSystem.parseDamageString(item.damage || '1d3');
            damage = clumpedRoll(parts.min, parts.max, parts.clumping,
                (lo, hi) => rng.randRange(lo, hi));
            damage = Math.round(damage * damageFraction(enchant));
        }

        const hpDamage = defender.absorbShieldDamage(damage);
        CombatSystem.transferMonsterHealth(thrower, defender, hpDamage);
        defender.takeDamage(hpDamage, true);
        const killed = defender.hp <= 0;
        defender.enrageAfterAttack();

        // CE Items.c:6845-6849：magicWeaponHit 只在非击杀分支调用。
        let triggeredRunic: string | undefined;
        if (!killed && item.runicType) {
            const parts = CombatSystem.parseDamageString(item.damage || '1d3');
            const chance = runicWeaponChance(enchant, item.runicType,
                { damageMin: parts.min, damageMax: parts.max });
            if (rng.randPercent(chance)) {
                triggeredRunic = item.runicType;
            }
        }

        return { hit: true, damage, killed, triggeredRunic };
    }
}
