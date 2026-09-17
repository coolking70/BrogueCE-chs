/**
 * src/engine/Combat/Combat.ts
 * Translates Brogue CE's Combat.c hit probabilities, damage math,
 * and damage resolution into TypeScript.
 */

import { Creature } from '../../entities/Creature';
import { Player } from '../../entities/Player';
import { Monster, MonsterState } from '../../entities/Monster';
import type { Item } from '../Items/Item';
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
         * castMonsterBolt 等法术/环境伤害出口传 false，不受该标志影响
         * （CE inflictDamage 本身只认 MONST_INVULNERABLE，不检查 IMMUNE_TO_WEAPONS）。
         */
        isWeaponAttack?: boolean;
        /**
         * P4-3：反射（MA_REFLECT_100/MONST_REFLECT_50）——调用方在命中判定前
         * 已经算好"这一击会被反射"，改把伤害记到这个目标身上（通常是原施法者）
         * 而不是 defender。hit probability / 偷袭仍按 defender 的状态计算，
         * 只有伤害的落点被换掉，对应 CE reflectBolt 把弹道折返给原施法者。
         */
        damageTarget?: Creature;
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
        const autoHit = backstab || lungeAttack;
        // --- P4-4: MA_KAMIKAZE (Combat.c:1159-1162) ---
        // CE 的检查在 attackHit() 掷骰之前（line 1159 早于 line 1240 的命中判定）：
        // 自爆怪物的攻击永远"成功"，不参与命中率——攻击者直接自毁代替造成伤害，
        // defender 完全不受影响。三只膨胀怪的 damage 都是 0d1，真正的杀伤来自
        // 死亡时触发的 DF（Game.triggerDeathFeatures），不是这次攻击本身。
        if (attacker instanceof Monster && attacker.hasAbility('MA_KAMIKAZE')) {
            attacker.takeDamage(attacker.hp);
            return { damage: 0, weaponName, hit: true, backstab: false, kamikazeSelfDestruct: true };
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

        // --- Calculate hit probability ---
        let hitProb: number;
        if (autoHit) {
            hitProb = 100;
        } else if (defender.seized && attacker.seizing) {
            // P4-5：CE hitProbability()（Combat.c:125-130）——猎物被抓住后无法闪避
            // 抓着自己的攻击者（defender SEIZED && attacker SEIZING → 直接返回 100）。
            // 这让"抓住→下一口必中"成为 MA_SEIZES 的核心威胁；若把这一击仍然交给
            // 命中率公式，accuracy 低的抓取者抓住后反而很难咬到，与 CE 不符。
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

        // Invisibility bonus (+50% damage)
        if (attacker instanceof Player && attacker.hasStatus('invisible') && !backstab) {
            damage = Math.floor(damage * 1.5);
        }

        // CE 护甲不参与伤害结算：防御值已在上面进入命中率掷骰（Combat.c:140），
        // 命中后按伤害骰全额扣血，没有任何"护甲减伤"步骤（全 CE 源码无此实现）。

        // P4-3：MONST_INVULNERABLE（Combat.c:1806 inflictDamage）对一切伤害源生效；
        // MONST_IMMUNE_TO_WEAPONS（Combat.c:1243）只在武器攻击（isWeaponAttack !== false）
        // 时把伤害归零——早于下面的"命中至少 1 点"下限，且优先级更高（CE 同理：
        // 伤害先被算成 0，最低 1 点的逻辑根本不会触发,因为 CE 没有"最低 1 点"这回事，
        // 这里只是不让 web 自己的下限规则覆盖掉豁免）。
        const isWeaponAttack = opts?.isWeaponAttack !== false;
        const defenderIsInvulnerable = defender instanceof Monster && defender.isInvulnerable();
        const defenderIsImmuneToWeapons = defender instanceof Monster && defender.isImmuneToWeapons();
        if (defenderIsInvulnerable || (isWeaponAttack && defenderIsImmuneToWeapons)) {
            damage = 0;
        } else if (damage < 1) {
            // Minimum 1 damage on a hit
            damage = 1;
        }

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

        // Apply damage (P4-3: reflected hits redirect to opts.damageTarget, e.g. the caster)
        const applyTo = opts?.damageTarget ?? defender;
        if (damage > 0) {
            // --- P4-5: MA_TRANSFERENCE (Combat.c:1849-1871, inflictDamage()) ---
            // 前置条件：defender（这里是实际承伤对象 applyTo，对应 CE reflectBolt
            // 换靶后传进 inflictDamage 的 defender）不是 MONST_INANIMATE/
            // MONST_INVULNERABLE。transferenceAmount = min(damage, 承伤对象当前HP)
            // ——不能超过对方剩余血量；再按"攻击者是否是盟友"取 40%/90%（整数除法，
            // 向零截断，与 C 的 short 除法同口径）。复核结论（写入报告）：CE
            // `attacker->currentHP += transferenceAmount` 紧跟着只有玩家血量
            // 归零的判断，没有 maxHP 上限——这里照实现，不做 clamp。
            // 玩家戒指 rogue.transference 不在本轮范围，只接怪物/变异的 MA_TRANSFERENCE。
            if (attacker instanceof Monster && attacker.hasAbility('MA_TRANSFERENCE') &&
                !(applyTo instanceof Monster && (applyTo.hasBehavior('MONST_INANIMATE') || applyTo.isInvulnerable()))) {
                const cappedAmount = Math.min(damage, applyTo.hp);
                const transferAmount = attacker.isAlly
                    ? Math.trunc(cappedAmount * 4 / 10)  // allies: 40% recovery rate
                    : Math.trunc(cappedAmount * 9 / 10); // enemies: 90% recovery rate
                attacker.hp += transferAmount; // 有意不 clamp 到 maxHp，见上方注释
            }
            applyTo.takeDamage(damage);
        }

        return { damage, weaponName, hit: true, backstab, lunge: lungeAttack, triggeredRunic };
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
     * web 无 STATUS_ENTRANCED / 魔法恐惧 / MB_CAPTIVE 载体，对应豁免分支不迁移
     *（登记见 b_2 报告）。
     */
    public static resolveThrownWeapon(
        thrower: Player,
        defender: Monster,
        item: Item
    ): { hit: boolean; damage: number; killed: boolean; triggeredRunic?: string } {
        const strReq = item.strengthRequired || 0;
        const enchant = netEnchant(item.enchantment, thrower.strength, strReq);

        // CE attackHit（Combat.c:149-158）。web StatusId 无 stuck/captive
        //（蛛网定身/囚笼机制未实装），自动命中集只有 paralyzed 有载体。
        const autoHit = defender.hasStatus('paralyzed');
        const hit = autoHit || rng.randPercent(hitProbability(100, defender.defense, enchant));
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

        defender.takeDamage(damage);
        const killed = defender.hp <= 0;

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
