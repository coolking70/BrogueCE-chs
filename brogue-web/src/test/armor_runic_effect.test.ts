/**
 * src/test/armor_runic_effect.test.ts — 护甲符文触发条件与强度对齐 CE 的验收测试
 *
 * CE 出处（BrogueCE 6.x，src/brogue/）：
 *   - PowerTables.c:106  armorReprisalPercent = max(5, (int)(enchant*5/FP))
 *   - PowerTables.c:107  armorAbsorptionMax   = max(1, (int)(enchant/FP))
 *   - PowerTables.c:109-123 reflectionChance（POW_REFLECT 表，0.85^x、x=0.25 步进）
 *   - Combat.c:976-1024  A_MUTUALITY：恒触发，伤害与相邻敌方均摊
 *   - Combat.c:1026-1035 A_ABSORPTION：恒触发，damage -= rand_range(1, absorptionMax)
 *   - Combat.c:1037-1056 A_REPRISAL：仅近战、恒触发，反弹 percent% 伤害
 *   - Combat.c:1058-1063 A_IMMUNITY：被动常驻、无概率判定
 *   - Items.c:4969-5000  projectileReflects：reflection 只作用于投掷物/法术
 */
import { describe, it, expect } from 'vitest';
import {
    reflectionChance,
    armorAbsorptionMax,
    armorReprisalPercent,
    netEnchant,
} from '../engine/Combat/CombatFormulas';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { Item, ItemCategory } from '../engine/Items/Item';
import { Monster, type MonsterData } from '../entities/Monster';
import monsterDataJson from '../data/monsters.json';

const MONSTER_DATA = monsterDataJson as MonsterData[];

/** 造一件带符文的护甲并直接装备（绕过装备校验，聚焦符文分支本身） */
function equipRunicArmor(game: Game, runicType: string, enchantment: number, strengthRequired = 15): Item {
    const armor = new Item('test armor', ']', 0xcccccc, ItemCategory.ARMOR);
    armor.armor = 3;
    armor.enchantment = enchantment;
    armor.strengthRequired = strengthRequired;
    armor.runicType = runicType;
    armor.runicKnown = false;
    game.player.equippedArmor = armor;
    return armor;
}

/** 造一只不参与 AI 的裸怪，摆在玩家相对坐标处 */
function makeMonster(game: Game, dx: number, dy: number, hp = 1000): Monster {
    const data = MONSTER_DATA.find(m => m.id === 'rat') ?? MONSTER_DATA[0]!;
    const m = new Monster(game.player.loc.x + dx, game.player.loc.y + dy, data);
    m.hp = hp;
    m.maxHp = hp;
    return m;
}

describe('reflectionChance 黄金值（PowerTables.c:109-123 POW_REFLECT 表）', () => {
    // CE-exact 逐值（定点截断）；连续闭式 100*(1-0.85^e) = 15.0/38.6/55.6/80.3/96.1，
    // 与表值差 ≤1 个百分点（定点截断 + 表生成噪声），故两者都断言。
    it('e=1/3/5/10/20 与表逐值一致，且与 100*(1-0.85^e) 差 ≤1，钳 [1,100]', () => {
        expect(reflectionChance(1)).toBe(16);
        expect(reflectionChance(3)).toBe(39);
        expect(reflectionChance(5)).toBe(56);
        expect(reflectionChance(10)).toBe(81);
        expect(reflectionChance(20)).toBe(97);

        for (const e of [1, 3, 5, 10, 20]) {
            const continuous = 100 * (1 - Math.pow(0.85, e));
            expect(Math.abs(reflectionChance(e) - continuous)).toBeLessThanOrEqual(1);
        }

        // 钳位：下限 1 / 上限 100；e≤0.25 走表头（idx 钳 0 → 4）
        expect(reflectionChance(-5)).toBe(4);
        expect(reflectionChance(0)).toBe(4);
        expect(reflectionChance(0.25)).toBe(4);
        expect(reflectionChance(50)).toBe(100);
        expect(reflectionChance(100)).toBe(100);
    });
});

describe('armorAbsorptionMax / armorReprisalPercent 黄金值（PowerTables.c:106-107）', () => {
    it('armorAbsorptionMax(e) = max(1, floor(e))', () => {
        // PowerTables.c:107: max(1, (int)(enchant / FP_FACTOR))
        expect(armorAbsorptionMax(1)).toBe(1);
        expect(armorAbsorptionMax(3)).toBe(3);
        expect(armorAbsorptionMax(5)).toBe(5);
        expect(armorAbsorptionMax(10)).toBe(10);
        expect(armorAbsorptionMax(20)).toBe(20);
        expect(armorAbsorptionMax(1.5)).toBe(1);
        expect(armorAbsorptionMax(0)).toBe(1);
        expect(armorAbsorptionMax(-20)).toBe(1);
    });

    it('armorReprisalPercent(e) = max(5, floor(e*5))（fixpt 截断，非 floor(e)*5）', () => {
        // PowerTables.c:106: max(5, (int)(enchant*5/FP_FACTOR))
        expect(armorReprisalPercent(1)).toBe(5);
        expect(armorReprisalPercent(3)).toBe(15);
        expect(armorReprisalPercent(5)).toBe(25);
        expect(armorReprisalPercent(10)).toBe(50);
        expect(armorReprisalPercent(20)).toBe(100);
        // 0.25 步进的分数附魔按 fixpt 截断：e=1.5 → floor(7.5)=7（CE 语义，
        // 与 floor(e)*5=5 不同，整数附魔下两者一致）
        expect(armorReprisalPercent(1.5)).toBe(7);
        expect(armorReprisalPercent(0)).toBe(5);
        expect(armorReprisalPercent(-20)).toBe(5);
    });
});

describe('强度吃 netEnchant：同一件护甲力量不足时符文更弱', () => {
    it('公式层面：力量赤字压低三种强度曲线', () => {
        const weak = netEnchant(3, 10, 15); // 赤字 5 × 2.5 = -12.5 → -9.5
        const strong = netEnchant(3, 20, 15); // 盈余 5 × 0.25 = +1.25 → 4.25
        expect(weak).toBeLessThan(0);
        expect(reflectionChance(weak)).toBeLessThan(reflectionChance(strong));
        expect(armorAbsorptionMax(weak)).toBeLessThan(armorAbsorptionMax(strong));
        expect(armorReprisalPercent(weak)).toBeLessThan(armorReprisalPercent(strong));
    });

    it('实战层面：力量不足的 absorption 每击只吸收 1 点（armorAbsorptionMax 钳下限）', () => {
        const game = createHeadlessGame(20260914);
        equipRunicArmor(game, 'absorption', 3, /* strengthRequired */ 15);
        game.player.strength = 10; // 赤字 5 → netEnchant = -9.5 → absorptionMax = 1
        const attacker = makeMonster(game, 1, 0);
        game.monsters = [attacker];

        for (let i = 0; i < 50; i++) {
            game.player.hp = 5; // 远离 maxHp，回补不会被钳
            game.tryTriggerArmorRunic(attacker, 20);
            expect(game.player.hp).toBe(6); // 每击恰好吸收 1 点，恒触发、无漏发
        }
    });
});

describe('absorption / reprisal / mutuality 恒触发（无概率判定）', () => {
    it('absorption：每次受击必然吸收 ≥1 点，且满额吸收时才提示/鉴定', () => {
        const game = createHeadlessGame(20260914);
        const armor = equipRunicArmor(game, 'absorption', 10, 0);
        game.player.strength = 30; // netEnchant = 10 + 30×0.25 = 17.5 → absorptionMax = 17
        const attacker = makeMonster(game, 1, 0);
        game.monsters = [attacker];

        let sawFull = false;
        for (let i = 0; i < 100; i++) {
            game.player.hp = 5;
            game.tryTriggerArmorRunic(attacker, 8); // 吸收 1..17，必 ≥1，可能满额 8
            const absorbed = game.player.hp - 5;
            expect(absorbed).toBeGreaterThanOrEqual(1); // 恒触发：绝无空过
            if (absorbed === 8) sawFull = true;
        }
        expect(sawFull).toBe(true);
        expect(armor.runicKnown).toBe(true);

        // 远程不触发（CE applyArmorRunicEffect 唯一调用点在近战 attack() 内，
        // Combat.c:1272 恒传 melee=true）
        const rangedAttacker = makeMonster(game, 4, 0);
        game.monsters = [rangedAttacker];
        for (let i = 0; i < 30; i++) {
            game.player.hp = 5;
            game.tryTriggerArmorRunic(rangedAttacker, 8);
            expect(game.player.hp).toBe(5); // 远程零吸收
        }
    });

    it('reprisal：仅近战恒触发，反弹 armorReprisalPercent% 伤害；远程不触发', () => {
        const game = createHeadlessGame(20260914);
        const armor = equipRunicArmor(game, 'reprisal', 4, 15);
        game.player.strength = 20; // 盈余 5 → netEnchant = 5.25 → percent = 26
        const meleeAttacker = makeMonster(game, 1, 0);
        game.monsters = [meleeAttacker];

        // 近战：每次受击 20 点伤害反弹 26% → trunc(5.2) = 5 点，30 连击无一空过
        for (let i = 0; i < 30; i++) {
            meleeAttacker.hp = 1000;
            game.tryTriggerArmorRunic(meleeAttacker, 20);
            expect(meleeAttacker.hp).toBe(995);
        }
        expect(armor.runicKnown).toBe(true);

        // 远程（CE Combat.c:1038 melee 门）：永不反弹
        const rangedAttacker = makeMonster(game, 4, 0);
        game.monsters = [rangedAttacker];
        for (let i = 0; i < 30; i++) {
            game.tryTriggerArmorRunic(rangedAttacker, 20);
            expect(rangedAttacker.hp).toBe(1000);
        }
    });

    it('mutuality：恒触发，伤害按 (damage+count)/(count+1) 与相邻敌方均摊，攻击者不摊、盟友不摊', () => {
        const game = createHeadlessGame(20260914);
        equipRunicArmor(game, 'mutuality', 4, 15);
        game.player.strength = 16;

        const attacker = makeMonster(game, 1, 0);
        const enemyA = makeMonster(game, -1, 0);
        const ally = makeMonster(game, 0, 1);
        ally.isAlly = true;

        // count=1：share = floor((10+1)/2) = 5；玩家伤害降为 5（回补 5）
        game.monsters = [attacker, enemyA, ally];
        enemyA.hp = 100;
        ally.hp = 100;
        attacker.hp = 100;
        game.player.hp = 20;
        game.tryTriggerArmorRunic(attacker, 10);
        expect(game.player.hp).toBe(25); // 20 + (10-5)
        expect(enemyA.hp).toBe(95); // 摊到 5 点
        expect(ally.hp).toBe(100); // 盟友不摊
        expect(attacker.hp).toBe(100); // 攻击者本身不摊（Combat.c:992）

        // count=2：share = floor((10+2)/3) = 4；玩家伤害降为 4（回补 6）
        const enemyB = makeMonster(game, 0, -1);
        game.monsters = [attacker, enemyA, enemyB];
        enemyA.hp = 100;
        enemyB.hp = 100;
        game.player.hp = 20;
        game.tryTriggerArmorRunic(attacker, 10);
        expect(game.player.hp).toBe(26);
        expect(enemyA.hp).toBe(96);
        expect(enemyB.hp).toBe(96);

        // count=0（只有攻击者相邻）：什么都不发生
        game.monsters = [attacker];
        game.player.hp = 20;
        game.tryTriggerArmorRunic(attacker, 10);
        expect(game.player.hp).toBe(20);

        // 远程不触发：即使有相邻敌方也不摊派（CE Combat.c:1272 melee 门）
        const rangedAttacker = makeMonster(game, 4, 0);
        game.monsters = [rangedAttacker, enemyA];
        enemyA.hp = 100;
        game.player.hp = 20;
        game.tryTriggerArmorRunic(rangedAttacker, 10);
        expect(game.player.hp).toBe(20);
        expect(enemyA.hp).toBe(100);
    });
});

describe('reflection：仅远程触发、触发率随附魔走表；immunity 无概率判定', () => {
    it('reflection 对近战永不触发（Items.c:4969 projectileReflects 语义）', () => {
        const game = createHeadlessGame(20260914);
        equipRunicArmor(game, 'reflection', 20, 0);
        game.player.strength = 40; // 高附魔、高触发率，排除"概率没到"的解释
        const attacker = makeMonster(game, 1, 0); // 近战
        game.monsters = [attacker];

        for (let i = 0; i < 50; i++) {
            game.tryTriggerArmorRunic(attacker, 10);
            expect(attacker.hp).toBe(1000); // 近战从不反弹
        }
    });

    it('reflection 远程触发率符合 reflectionChance(e)（e=8 → 73%，统计断言）', () => {
        const game = createHeadlessGame(20260914);
        const armor = equipRunicArmor(game, 'reflection', 8, 10);
        game.player.strength = 10; // 力量恰好达标 → netEnchant = 8 → 触发率 73%
        const attacker = makeMonster(game, 4, 0); // 远程
        game.monsters = [attacker];

        const trials = 3000;
        let triggered = 0;
        for (let i = 0; i < trials; i++) {
            attacker.hp = 1000;
            game.tryTriggerArmorRunic(attacker, 2); // 反弹 max(1, floor(2*0.5)) = 1
            if (attacker.hp === 999) triggered++;
        }
        // 期望 73%；±8 个百分点的宽松区间（固定种子下结果确定，区间只防实现漂移）
        expect(triggered / trials).toBeGreaterThan(0.65);
        expect(triggered / trials).toBeLessThan(0.81);
        expect(armor.runicKnown).toBe(true);
    });

    it('immunity：移除恒真 randPercent(100) 后行为不变——每次受击全额抵挡', () => {
        const game = createHeadlessGame(20260914);
        const armor = equipRunicArmor(game, 'immunity', 5, 0);
        const attacker = makeMonster(game, 1, 0);
        game.monsters = [attacker];

        for (let i = 0; i < 20; i++) {
            game.player.hp = 5;
            game.tryTriggerArmorRunic(attacker, 12);
            expect(game.player.hp).toBe(17); // 5 + 12，每次都挡
        }
        expect(armor.runicKnown).toBe(true);
    });
});

describe('runicArmorChance 死代码已删除', () => {
    it('CombatFormulas 模块不再导出 runicArmorChance', async () => {
        const mod = await import('../engine/Combat/CombatFormulas');
        expect((mod as Record<string, unknown>).runicArmorChance).toBeUndefined();
    });
});
