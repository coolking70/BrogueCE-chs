/**
 * src/engine/UI/DetailGenerator.ts
 * Generates detail description text for monsters and items,
 * modeled after CE's monsterDetails() and itemDetails().
 */

import { ItemLoader } from '../Items/ItemLoader';
import { itemKnowledge } from './ItemKnowledge';
import { staffBlinkDistance } from '../Combat/BoltTrajectory';
import type { Item } from '../Items/Item';
import { ItemCategory } from '../Items/Item';
import type { Monster } from '../../entities/Monster';
import { MonsterState } from '../../entities/Monster';
import { creatureStatusRows } from '../Status/statusConfig';
import { monsterAccuracyAdjusted, monsterDefenseAdjusted, monsterDamageAdjustmentAmount } from '../Combat/CombatFormulas';
import { hitProbability, netEnchant, damageFraction, strengthModifier, playerDefense } from '../Combat/CombatFormulas';
import { CombatSystem } from '../Combat/Combat';

// ---------- Helper types ----------

export interface DetailInfo {
    /** Entity symbol character */
    char: string;
    /** Entity display color (hex) */
    color: number;
    /** Entity display name */
    name: string;
    /** Multi-line detail text sections */
    sections: DetailSection[];
}

export interface DetailSection {
    /** Optional section header */
    header?: string;
    /** Lines of text within the section */
    lines: DetailLine[];
}

export interface DetailLine {
    text: string;
    color?: string; // CSS color string, e.g. '#ff4444'
    progress?: { value: number; max: number };
}

// ---------- Runic description tables ----------

const weaponRunicDescriptions: Record<string, string> = {
    paralyzing: '每次攻击有概率麻痹目标数回合。',
    venom: '每次攻击有概率对目标施加致命毒素。',
    quietus: '每次攻击有概率瞬间击杀目标。',
    vampirism: '攻击会吸取目标生命值来治愈自身。',
    speed: '攻击后有概率获得额外攻击机会。',
    confusion: '每次攻击有概率使目标陷入混乱。',
    force: '每次攻击有概率将目标击退数格。',
    slaying: '对特定种类的怪物造成即死效果。',
    mercy: '攻击不会将目标生命值降至 1 以下。',
};

const armorRunicDescriptions: Record<string, string> = {
    reflection: '受击时有概率将 50% 的伤害反弹给攻击者。',
    dampening: '受击时有概率回复少量生命值。',
    mutuality: '受击时有概率将全额伤害共享给攻击者。',
    respiration: '免疫有害气体的影响。',
    vitality: '持续缓慢再生生命值。',
    absorption: '受击时有概率完全吸收伤害。',
    reprisal: '受击时有概率将 75% 的伤害返还给攻击者。',
    immunity: '完全免疫特定种类怪物的攻击。',
};

// ---------- Monster ability / behavior description ----------

const abilityFlagDescriptions: Record<string, string> = {
    MA_HIT_HALLUCINATE: '攻击会导致产生幻觉',
    MA_HIT_STEAL_FLEE: '攻击会偷取物品并逃跑',
    MA_HIT_BURN: '攻击会点燃目标',
    MA_TRANSFERENCE: '攻击会吸取生命',
    MA_CAUSES_WEAKNESS: '攻击会削弱力量',
    MA_POISONS: '攻击会施加毒素',
    MA_HIT_DEGRADE_ARMOR: '攻击会腐蚀护甲',
    MA_CLONE_SELF_ON_DEFEND: '受到伤害时会分裂',
    MA_KAMIKAZE: '自爆攻击',
    MA_DF_ON_DEATH: '死亡时触发特殊效果',
    MA_SEIZES: '会抓住并束缚猎物',
    MA_ATTACKS_PENETRATE: '攻击可以穿透',
    MA_ATTACKS_ALL_ADJACENT: '攻击所有相邻的目标',
    MA_ATTACKS_EXTEND: '攻击范围延长',
    MA_ATTACKS_STAGGER: '攻击会击退目标',
    MA_CAST_SUMMON: '可以召唤其他怪物',
    MA_ENTER_SUMMONS: '可以进入召唤物中',
    MA_AVOID_CORRIDORS: '避开走廊',
    MA_REFLECT_100: '反射所有远程法术',
};

const behaviorFlagDescriptions: Record<string, string> = {
    MONST_INVISIBLE: '隐形',
    MONST_INANIMATE: '无生命物体',
    MONST_IMMOBILE: '无法移动',
    MONST_FLIES: '飞行',
    MONST_FLITS: '移动飘忽不定',
    MONST_IMMUNE_TO_FIRE: '免疫火焰',
    MONST_IMMUNE_TO_WEAPONS: '免疫武器伤害',
    MONST_IMMUNE_TO_WEBS: '不会被蛛网缠绕',
    MONST_FLEES_NEAR_DEATH: '生命值低时会逃跑',
    MONST_DEFEND_DEGRADE_WEAPON: '被击中时会腐蚀武器',
    MONST_MAINTAINS_DISTANCE: '保持距离作战',
    MONST_RESTRICTED_TO_LIQUID: '限制在液体中',
    MONST_SUBMERGES: '可以潜入水中',
    MONST_FIERY: '身体炽热',
    MONST_INVULNERABLE: '无敌',
    MONST_REFLECT_50: '有概率反射法术',
    MONST_NEVER_SLEEPS: '从不睡觉',
    MONST_DIES_IF_NEGATED: '被消除时死亡',
    MONST_NO_POLYMORPH: '免疫变形',
};

// ---------- Monster detail generator ----------

/**
 * 生成怪物详情面板。
 *
 * 玩家防御不在调用方预先计算：本函数内部用 (playerArmorBase, playerArmorEnchant,
 * playerArmorStrReq) 三元组调用 playerDefense()（CE Items.c:8515-8523，×10 内部
 * 标度），与实战结算（Combat.ts attack 的玩家受击分支）共用同一真相来源，保证
 * "该怪物有 X% 概率命中你"与实战命中判定同源。
 */
export function generateMonsterDetail(
    monster: Monster,
    playerHP: number,
    playerStrength: number,
    _playerDefense: number, // @deprecated 已废弃：旧乘法口径的防御值占位参数，本函数不再读取
    playerWeaponDamage: [number, number] | null, // [low, high]
    playerWeaponEnchant: number,
    playerWeaponStrReq: number,
    playerArmorBase?: number,
    playerArmorEnchant?: number,
    playerArmorStrReq?: number,
    playerHallucinating = false,
    playerDonning = 0,
    playerStuck = false
): DetailInfo {
    const sections: DetailSection[] = [];

    // --- Flavor text ---
    const desc = monster.description || '';
    if (desc) {
        sections.push({
            lines: [{ text: desc, color: '#aaaacc' }]
        });
    }

    // --- Basic stats ---
    const statsLines: DetailLine[] = [];
    statsLines.push({ text: `生命值: ${monster.hp}/${monster.maxHp}`, color: '#66ccff' });

    const dmgStr = monster.damageString;
    const mDmg = dmgStr ? CombatSystem.parseDamageString(dmgStr) : null;
    if (mDmg) {
        const fraction = monsterDamageAdjustmentAmount(monster.weaknessAmount);
        mDmg.min = Math.trunc(mDmg.min * fraction);
        mDmg.max = Math.trunc(mDmg.max * fraction);
    }
    if (dmgStr) {
        statsLines.push({ text: `伤害: ${monster.weaknessAmount && mDmg ? `${mDmg.min}–${mDmg.max}` : dmgStr}` });
    }

    // Accuracy and defense
    const monAcc = monsterAccuracyAdjusted(monster.accuracy ?? 100, monster.weaknessAmount);
    const monDef = monsterDefenseAdjusted(monster.defense ?? 0, monster.weaknessAmount);
    if (monAcc !== 100) statsLines.push({ text: `精度: ${monAcc}` });
    if (monDef > 0) statsLines.push({ text: `防御: ${monDef}` });

    // Move / attack speed
    const moveSpd = monster.moveSpeed ?? 100;
    const atkSpd = monster.attackSpeed ?? 100;
    if (moveSpd < 100) statsLines.push({ text: '移动速度较快', color: '#ff8844' });
    else if (moveSpd > 100) statsLines.push({ text: '移动速度较慢' });
    if (atkSpd < 100) statsLines.push({ text: '攻击速度较快', color: '#ff8844' });
    else if (atkSpd > 100) statsLines.push({ text: '攻击速度较慢' });

    const regen = monster.regenTurns;
    if (regen !== undefined && regen > 0 && regen <= 1) {
        statsLines.push({ text: '再生极快', color: '#44ff44' });
    } else if (regen !== undefined && regen > 0 && regen <= 5) {
        statsLines.push({ text: '再生较快', color: '#44ff44' });
    }

    sections.push({ header: '基本属性', lines: statsLines });
    const statusRows = creatureStatusRows(monster);
    if (statusRows.length) sections.push({ header: '状态效果', lines: statusRows.map(s => ({
        text: `${s.label}（${s.value}）`, color: s.color,
    })) });
    // CE IO.c:4827 checks position equality, not MB_ABSORBING, allegiance or
    // counter > 0. Default null keeps this hidden until a corpse is assigned.
    if (!playerHallucinating && monster.targetCorpseLoc?.x === monster.loc.x && monster.targetCorpseLoc.y === monster.loc.y) {
        sections.push({ lines: [{ text: '吸收', color: '#ff6666',
            progress: { value: monster.corpseAbsorptionCounter, max: 20 } }] });
    }

    // --- Combat analysis ---
    const combatLines: DetailLine[] = [];

    // Monster hitting player
    // 与实战完全相同的输入与缺省口径：armor 为 0 视同无甲（防御 0，同 Combat.ts
    // 的 truthy 守卫），strengthRequired 缺省 0（同 Combat.ts 的 `|| 0`）。
    const armorBase = playerArmorBase ?? 0;
    const effectivePlayerDefense = armorBase > 0
        ? playerDefense(armorBase, playerArmorEnchant ?? 0, playerStrength, playerArmorStrReq ?? 0, playerDonning)
        : 0;
    const monHitProb = playerStuck ? 100 : hitProbability(monAcc, effectivePlayerDefense);
    combatLines.push({
        text: `该怪物有 ${monHitProb}% 的概率命中你。`,
        color: monHitProb > 50 ? '#ff6644' : '#ffcc44'
    });

    // Same truncated damage endpoints as combat.
    if (mDmg && playerHP > 0) {
        const avgDmg = (mDmg.min + mDmg.max) / 2;
        const pctOfHP = Math.round(100 * avgDmg / playerHP);
        combatLines.push({
            text: `平均每击造成你当前生命值的 ${pctOfHP}% 伤害。`,
            color: pctOfHP > 30 ? '#ff4444' : '#ffaa44'
        });

        // Hits to kill player
        const hitsToKill = Math.max(1, Math.ceil(playerHP / Math.max(1, mDmg.max)));
        combatLines.push({
            text: `最坏情况下，${hitsToKill} 击可击败你。`,
            color: hitsToKill <= 3 ? '#ff4444' : '#cccccc'
        });
    }

    // Player hitting monster
    if (playerWeaponDamage) {
        const wNE = netEnchant(playerWeaponEnchant, playerStrength, playerWeaponStrReq);
        const playerHitProb = monster.hasStatus('stuck') || monster.hasStatus('paralyzed') || monster.isCaged
            ? 100 : hitProbability(100, monDef, wNE);
        combatLines.push({
            text: `你有 ${playerHitProb}% 的概率命中该怪物。`,
            color: playerHitProb > 70 ? '#44ff44' : '#ffcc44'
        });

        const fraction = damageFraction(wNE);
        const scaledLo = Math.max(1, Math.trunc(playerWeaponDamage[0] * fraction));
        const scaledHi = Math.max(1, Math.trunc(playerWeaponDamage[1] * fraction));
        const scaledAvg = (scaledLo + scaledHi) / 2;
        if (monster.hp > 0) {
            const pctOfMonHP = Math.round(100 * scaledAvg / monster.hp);
            combatLines.push({
                text: `平均每击造成该怪物当前生命值的 ${pctOfMonHP}% 伤害。`,
                color: '#88ff88'
            });

            const hitsFromPlayer = Math.max(1, Math.ceil(monster.hp / scaledHi));
            combatLines.push({
                text: `最少 ${hitsFromPlayer} 击可击败该怪物。`,
                color: '#cccccc'
            });
        }
    }

    sections.push({ header: '战斗分析', lines: combatLines });

    // --- Abilities ---
    const abilityLines: DetailLine[] = [];
    const abilityFlags: string[] = Array.from(monster.abilityFlags);
    const behaviorFlags: string[] = Array.from(monster.behaviorFlags);

    for (const flag of behaviorFlags) {
        const desc = behaviorFlagDescriptions[flag];
        if (desc) abilityLines.push({ text: desc, color: '#ccaaff' });
    }
    for (const flag of abilityFlags) {
        const desc = abilityFlagDescriptions[flag];
        if (desc) abilityLines.push({ text: desc, color: '#ccaaff' });
    }

    if (abilityLines.length > 0) {
        sections.push({ header: '特殊能力', lines: abilityLines });
    }

    // --- State ---
    const stateLines: DetailLine[] = [];
    if (monster.displaysNegation) stateLines.push({ text: '特殊能力已被消除。', color: '#ff88cc' });
    if (monster.isAlly && monster.newPowerCount > 0) {
        stateLines.push({ text: `似乎已准备好学习 ${monster.newPowerCount} 项新能力。`, color: '#88ff99' });
    }
    const state = monster.state;
    if (state === MonsterState.ASLEEP) stateLines.push({ text: '正在睡眠', color: '#8888ff' });
    else if (state === MonsterState.WANDERING) stateLines.push({ text: '正在巡逻', color: '#88ff88' });
    else if (state === MonsterState.HUNTING) stateLines.push({ text: '正在追击', color: '#ff4444' });
    else if (state === MonsterState.FLEEING) stateLines.push({ text: '正在逃跑', color: '#ffcc44' });

    if (stateLines.length > 0) {
        sections.push({ header: '状态', lines: stateLines });
    }

    return {
        char: monster.char,
        color: typeof monster.color === 'number' ? monster.color : 0xffffff,
        name: monster.name,
        sections
    };
}

// ---------- Display helpers ----------

/** 净附魔含 0.25 步进的力量修正，可能出现一位小数；去浮点尾噪后转显示串。 */
function trimFloatStr(v: number): string {
    return String(Math.round(v * 100) / 100);
}

/** 同上，但正数带 + 前缀（附魔标注惯例）。 */
function signedTrimFloatStr(v: number): string {
    return (v > 0 ? '+' : '') + trimFloatStr(v);
}

// ---------- Item detail generator ----------

export function generateItemDetail(
    item: Item,
    playerStrength: number
): DetailInfo {
    const sections: DetailSection[] = [];
    const knowledge = itemKnowledge(item);

    // --- Description ---
    const desc = (item as any).description || '';
    if (desc && knowledge.kindKnown) {
        sections.push({
            lines: [{ text: desc, color: '#aaaacc' }]
        });
    }

    // --- Weapon stats ---
    if (item.category === ItemCategory.WEAPON) {
        const statsLines: DetailLine[] = [];
        if (item.damage) {
            const { min: lo, max: hi } = CombatSystem.parseDamageString(item.damage);
            // 基础伤害是种类数据（CE itemName/详情对未鉴定也显示类型已知信息）
            statsLines.push({ text: `基础伤害: ${item.damage} (${lo}~${hi})` });

            // B-1a 反泄露（CE Items.c:1488-1493）：附魔修正只在实例已鉴定后显示。
            if (knowledge.instanceKnown && item.enchantment !== 0) {
                const strReq = item.strengthRequired || 12;
                const ne = netEnchant(item.enchantment, playerStrength, strReq);
                const frac = damageFraction(ne);
                const eLo = Math.max(1, Math.trunc(lo * frac));
                const eHi = Math.max(1, Math.trunc(hi * frac));
                statsLines.push({
                    text: `实际伤害: ${eLo}~${eHi} (附魔 ${item.enchantment > 0 ? '+' : ''}${item.enchantment})`,
                    color: item.enchantment > 0 ? '#44ff44' : '#ff4444'
                });
            }
        }
        if (item.strengthRequired) {
            const mod = strengthModifier(playerStrength, item.strengthRequired);
            statsLines.push({
                text: `力量需求: ${item.strengthRequired} (你的力量: ${playerStrength}, ${mod >= 0 ? '盈余' : '不足'})`,
                color: mod >= 0 ? '#44ff44' : '#ff4444'
            });
        }
        // UI-2：ITEM_PROTECTED 详情行（CE Items.c:2394-2400）。CE 该块在武器/
        // 护甲 if-else 之外，两类装备都显示，故武器段与护甲段各放一份；中文
        // 取 CE chineseUi 原文「不会被酸液腐蚀。」，色同 goodColorEscape（绿）。
        if (item.isProtected) {
            statsLines.push({ text: `${item.displayName}不会被酸液腐蚀。`, color: '#44ff44' });
        }
        // B-1a 反泄露：诅咒不预亮（CE 全源码无"详情面板显示诅咒"的分支——
        // 玩家经穿戴后摘不下来得知，Items.c:7110；或鉴定卷轴整件亮）。
        sections.push({ header: '武器属性', lines: statsLines });
    }

    // --- Armor stats ---
    if (item.category === ItemCategory.ARMOR) {
        const statsLines: DetailLine[] = [];
        if (item.armor !== undefined) {
            // CE 加法防御模型（Items.c:8515-8523）：显示防御 = armor + 净附魔
            // （含力量修正）。旧乘法"减伤值"口径已随 P1-11 废弃。
            // B-1a 反泄露：净附魔段只在实例已鉴定后显示（同武器，CE 对未鉴定
            // 装备只给类型已知信息与力量需求）。
            statsLines.push({ text: `基础防御值: ${item.armor}` });
            if (knowledge.instanceKnown) {
                const strReq = item.strengthRequired || 12;
                const ne = netEnchant(item.enchantment, playerStrength, strReq);
                if (ne !== 0 || item.enchantment !== 0) {
                    const effectiveArmor = item.armor + ne;
                    const strengthNote = ne !== item.enchantment ? '，含力量修正' : '';
                    statsLines.push({
                        text: `实际防御值: ${trimFloatStr(effectiveArmor)} (净附魔 ${signedTrimFloatStr(ne)}${strengthNote})`,
                        color: ne > 0 ? '#44ff44' : ne < 0 ? '#ff4444' : undefined
                    });
                }
            }
        }
        if (item.strengthRequired) {
            const mod = strengthModifier(playerStrength, item.strengthRequired);
            statsLines.push({
                text: `力量需求: ${item.strengthRequired} (你的力量: ${playerStrength}, ${mod >= 0 ? '盈余' : '不足'})`,
                color: mod >= 0 ? '#44ff44' : '#ff4444'
            });
        }
        // UI-2：ITEM_PROTECTED 详情行（CE Items.c:2394-2400，见武器段注）。
        if (item.isProtected) {
            statsLines.push({ text: `${item.displayName}不会被酸液腐蚀。`, color: '#44ff44' });
        }
        // B-1a 反泄露：诅咒不预亮（同武器段注）。
        sections.push({ header: '护甲属性', lines: statsLines });
    }

    // --- Runic ---
    if (item.runicType && knowledge.runicKnown) {
        const runicLines: DetailLine[] = [];
        if (item.category === ItemCategory.WEAPON) {
            const runicDesc = weaponRunicDescriptions[item.runicType];
            if (runicDesc) runicLines.push({ text: runicDesc, color: '#ffcc44' });
        } else if (item.category === ItemCategory.ARMOR) {
            const runicDesc = armorRunicDescriptions[item.runicType];
            if (runicDesc) runicLines.push({ text: runicDesc, color: '#ffcc44' });
        }
        if (runicLines.length > 0) {
            sections.push({ header: `附魔: ${item.runicType}`, lines: runicLines });
        }
    }

    // --- Consumable info ---
    if (item.category === ItemCategory.WAND || item.category === ItemCategory.STAFF) {
        const statsLines: DetailLine[] = [];
        // B-1a 反泄露（CE Items.c:1611-1634 / 1650-1653）：充能只在实例层已知
        // （ITEM_IDENTIFIED / ITEM_MAX_CHARGES_KNOWN）时显示；未识别魔杖显示
        // 使用次数（enchant2 计数，Items.c:7435）而非充能。
        if (knowledge.instanceKnown) {
            if (item.charges !== undefined && item.maxCharges !== undefined) {
                statsLines.push({ text: `充能: ${item.charges}/${item.maxCharges}` });
            }
        } else if (knowledge.capacityKnown) {
            if (item.maxCharges !== undefined) {
                statsLines.push({ text: `充能上限: ${item.maxCharges}（当前余量未知）` });
            }
        } else if (item.category === ItemCategory.WAND && (item.timesUsed ?? 0) > 0) {
            statsLines.push({ text: `已使用 ${item.timesUsed} 次（充能未知）`, color: '#aaaaff' });
        }
        statsLines.push({ text: item.category === ItemCategory.WAND
            ? '不会自然恢复充能'
            : '随时间恢复充能，速度受附魔等级与佩戴的智慧戒指影响' });
        const staffId = (item as Item & { identityId?: string }).identityId;
        if (item.category === ItemCategory.STAFF && staffId === 'staff_of_blinking'
            && ItemLoader.identifiedItems.has(staffId)) {
            statsLines.push({ text: '自然回电速度为普通法杖的一半' });
            if (knowledge.instanceKnown) {
                statsLines.push({ text: `最多瞬移 ${staffBlinkDistance(item.enchantment)} 格（附魔后 ${staffBlinkDistance(item.enchantment + 1)} 格）` });
            }
        }
        sections.push({ header: '法器属性', lines: statsLines });
    }

    if (item.category === ItemCategory.CHARM && knowledge.kindKnown) {
        const statsLines: DetailLine[] = [];
        if (item.cooldownTurns) {
            statsLines.push({ text: `冷却回合: ${item.cooldownTurns}` });
        }
        if (item.cooldownRemaining) {
            statsLines.push({ text: `剩余冷却: ${item.cooldownRemaining}`, color: '#ff8844' });
        }
        sections.push({ header: '护符属性', lines: statsLines });
    }

    return {
        char: item.char,
        color: item.color,
        name: item.displayName,
        sections
    };
}
