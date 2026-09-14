/**
 * src/test/invented_content_pool.test.ts — D2：web 自创（CE 无对应）内容退出生成池
 *
 * 自创清单及 CE 证据（复核于 BrogueCE-master 源码）：
 *  - scroll_of_amnesia  ：CE 全源码无 "amnesia"（scrollTable_Brogue 14 种无此条）
 *  - potion_of_healing   ：potionTable_Brogue 16 种无 healing/extra healing
 *  - potion_of_poison    ：potionTable_Brogue 16 种无 poison（CE 的毒来自毒气陷阱
 *     GAS_TRAP_POISON / creeping death 药水/毒镖，均非"毒药水"）
 *  - wand_of_fire / wand_of_lightning：wandTable_Brogue 9 种无火/闪电魔杖（火/闪电是 staff）
 *  - staff_of_light      ：staffTable 12 种无 light 法杖
 *  - halberd             ：weaponTable 15 种无 halberd（CE 全源码 grep 零命中）
 *  - 武器符文 vampirism / venom：weaponRunicNames 10 种（speed/quietus/paralysis/
 *    multiplicity/slowing/confusion/force/slaying/mercy/plenty）无此二项
 *  - 护甲符文 vitality    ：armorRunicNames 11 种无 vitality
 *
 * 验收条款：
 *  1) 固定多 seed 大量生成，断言自创项出现 0 次（含整层生成 D1-D26、符文随机流、
 *     以及附魔卷轴 20% 送符文路径 enchantEquippedItem——它也是真实游玩中的随机池）；
 *  2) 被排除条目仍存在于数据/代码中、可被直接构造（证明是退池而非删除）；
 *  3) 反真空断言：生成仍大量发生、CE 符文仍出现（防止"池子被清空导致 0 次"的假阴性）。
 *
 * 对抗性（验收 3 的手动步骤）：把某个自创项加回生成池（如 GENERATED_WEAPON_RUNICS
 * 加回 'vampirism'）后，本文件的 0 次断言必须失败——失败输出见交付报告。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame } from './harness';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { rng } from '../engine/Random';
import type { Game } from '../engine/Core/Game';
import { ItemCategory, type Item } from '../engine/Items/Item';
import consumablesJson from '../data/consumables.json';
import arcanaJson from '../data/arcana.json';
import weaponsJson from '../data/weapons.json';

/** web 自创、本轮退出生成池的全部条目 */
const INVENTED = {
    potions: ['potion_of_healing', 'potion_of_poison'],
    scrolls: ['scroll_of_amnesia'],
    wands: ['wand_of_fire', 'wand_of_lightning'],
    staffs: ['staff_of_light'],
    weapons: ['halberd'],
    weaponRunics: ['vampirism', 'venom'],
    armorRunics: ['vitality'],
} as const;

/** 全部自创条目的直接显示名（harness 空资源下 tn() 原样返回英文名），供整层扫描兜底比对 */
const INVENTED_DISPLAY_NAMES = new Set([
    'Potion of Healing',
    'Potion of Poison',
    'Scroll of Amnesia',
    'Wand of Fire',
    'Wand of Lightning',
    'Staff of Light',
    'Halberd',
]);

interface SimpleEntry { id: string; excludeFromGeneration?: boolean }

const potionsJson = consumablesJson.potions as SimpleEntry[];
const scrollsJson = consumablesJson.scrolls as SimpleEntry[];
const wandsJson = arcanaJson.wands as SimpleEntry[];
const staffsJson = arcanaJson.staffs as SimpleEntry[];
const weaponsJsonArr = weaponsJson as SimpleEntry[];

/** 全部自创 id 的扁平清单 */
const ALL_INVENTED_IDS: readonly string[] = [
    ...INVENTED.potions, ...INVENTED.scrolls, ...INVENTED.wands,
    ...INVENTED.staffs, ...INVENTED.weapons,
    ...INVENTED.weaponRunics, ...INVENTED.armorRunics,
];

type GameWithGenerateDepth = Omit<Game, 'generateDepth'> & {
    generateDepth(isGoingUp: boolean, isFirstLevel: boolean): void;
};

/** 从一个已生成物品提取其"真实类别 id"（能取到 id 用 id，否则退回显示名） */
function identityOf(item: Item): string {
    const anyItem = item as unknown as {
        consumableId?: string; identityId?: string; runicType?: string; name: string;
    };
    return anyItem.consumableId ?? anyItem.identityId ?? anyItem.name;
}

describe('D2 生成池排他：自创条目不在任何生成池中', () => {
    it('gen* 生成池不含自创条目，且全量数组仍含之（退池而非删除）', () => {
        for (const id of INVENTED.potions) {
            expect(ItemLoader.genPotions.map(p => p.id)).not.toContain(id);
        }
        expect(ItemLoader.genScrolls.map(s => s.id)).not.toContain('scroll_of_amnesia');
        for (const id of INVENTED.wands) {
            expect(ItemLoader.genWands.map(w => w.id)).not.toContain(id);
        }
        expect(ItemLoader.genStaffs.map(s => s.id)).not.toContain('staff_of_light');
        expect(ItemLoader.genWeapons.map(w => w.id)).not.toContain('halberd');

        // 全量数据仍完整保留
        for (const id of INVENTED.potions) {
            expect(potionsJson.map(p => p.id)).toContain(id);
        }
        expect(scrollsJson.map(s => s.id)).toContain('scroll_of_amnesia');
        for (const id of INVENTED.wands) expect(wandsJson.map(w => w.id)).toContain(id);
        expect(staffsJson.map(s => s.id)).toContain('staff_of_light');
        expect(weaponsJsonArr.map(w => w.id)).toContain('halberd');

        // json 标记与 gen 池大小严格对应（防止"漏标"或"全量被误删"）
        for (const id of INVENTED.potions) {
            expect(potionsJson.find(p => p.id === id)?.excludeFromGeneration).toBe(true);
        }
        expect(scrollsJson.find(s => s.id === 'scroll_of_amnesia')?.excludeFromGeneration).toBe(true);
        expect(ItemLoader.genPotions.length).toBe(ItemLoader.potions.length - INVENTED.potions.length);
        expect(ItemLoader.genScrolls.length).toBe(ItemLoader.scrolls.length - INVENTED.scrolls.length);
        expect(ItemLoader.genWands.length).toBe(ItemLoader.wands.length - INVENTED.wands.length);
        expect(ItemLoader.genStaffs.length).toBe(ItemLoader.staffs.length - INVENTED.staffs.length);
        expect(ItemLoader.genWeapons.length).toBe(ItemLoader.weapons.length - INVENTED.weapons.length);
    }, 120000);

    it('符文生成池不含自创符文，全量符号表仍含之', () => {
        const genWeapon = ItemLoader.GENERATED_WEAPON_RUNICS as readonly string[];
        const allWeapon = ItemLoader.ALL_WEAPON_RUNICS as readonly string[];
        const genArmor = ItemLoader.GENERATED_ARMOR_RUNICS as readonly string[];
        const allArmor = ItemLoader.ALL_ARMOR_RUNICS as readonly string[];

        for (const r of INVENTED.weaponRunics) {
            expect(genWeapon).not.toContain(r);
            expect(allWeapon).toContain(r);
        }
        for (const r of INVENTED.armorRunics) {
            expect(genArmor).not.toContain(r);
            expect(allArmor).toContain(r);
        }
        // CE 对应符文必须一个不少（防止误删 CE 符文）
        expect(genWeapon).toEqual(expect.arrayContaining(
            ['paralyzing', 'quietus', 'speed', 'confusion', 'force', 'slaying', 'mercy']));
        expect(genArmor).toEqual(expect.arrayContaining(
            ['reflection', 'dampening', 'mutuality', 'respiration', 'absorption', 'reprisal', 'immunity']));
    }, 120000);
});

describe('D2 退池而非删除：自创条目仍可被直接构造', () => {
    it('spawnXxx(自创 id) 仍返回完整物品', () => {
        expect(ItemLoader.spawnScroll('scroll_of_amnesia', 0, 0)).not.toBeNull();
        expect(ItemLoader.spawnPotion('potion_of_healing', 0, 0)).not.toBeNull();
        expect(ItemLoader.spawnPotion('potion_of_poison', 0, 0)).not.toBeNull();
        expect(ItemLoader.spawnWand('wand_of_fire', 0, 0)).not.toBeNull();
        expect(ItemLoader.spawnWand('wand_of_lightning', 0, 0)).not.toBeNull();
        expect(ItemLoader.spawnStaff('staff_of_light', 0, 0)).not.toBeNull();
        const halberd = ItemLoader.spawnWeapon('halberd', 0, 0);
        expect(halberd).not.toBeNull();
        expect(halberd!.damage).toBe('3d4'); // 数据原样保留
    }, 120000);
});

describe('D2 附魔卷轴送符文路径（enchantEquippedItem）：自创符文 0 出现', () => {
    // 附魔卷轴对无符文装备有 20% 概率随机授符文，是真实游玩中的随机抽取池，
    // 必须同样只从 GENERATED_*_RUNICS 取值。
    // 每次迭代消耗固定 rng 抽取（randPercent 必抽；命中后再抽 randRange），固定 seed 下完全确定。
    it('8000 次附魔：武器/护甲只授 CE 符文，vampirism/venom/vitality 出现 0 次', () => {
        const weaponCounts = new Map<string, number>();
        const armorCounts = new Map<string, number>();
        let weaponGrants = 0;
        let armorGrants = 0;

        const TRAILS = 8000;
        for (const seed of [123_456, 654_321]) {
            rng.seedRandomGenerator(seed);
            const game = createHeadlessGame(seed);
            const g = game as unknown as {
                player: { equippedWeapon: Item | null; equippedArmor: Item | null };
                enchantEquippedItem(): boolean;
            };

            // —— 武器阶段：初始装备的武器为附魔对象 ——
            expect(g.player.equippedWeapon).not.toBeNull();
            for (let i = 0; i < TRAILS; i++) {
                const weapon = g.player.equippedWeapon!;
                (weapon as unknown as { runicType?: string }).runicType = undefined;
                (weapon as unknown as { enchantment: number }).enchantment = 0;
                if (g.enchantEquippedItem()) {
                    const rt = (weapon as unknown as { runicType?: string }).runicType;
                    if (rt) {
                        weaponGrants++;
                        weaponCounts.set(rt, (weaponCounts.get(rt) ?? 0) + 1);
                    }
                }
            }

            // —— 护甲阶段：临时摘下武器，使附魔对象落到护甲上 ——
            const savedWeapon = g.player.equippedWeapon;
            g.player.equippedWeapon = null;
            expect(g.player.equippedArmor).not.toBeNull();
            for (let i = 0; i < TRAILS; i++) {
                const armor = g.player.equippedArmor!;
                (armor as unknown as { runicType?: string }).runicType = undefined;
                (armor as unknown as { enchantment: number }).enchantment = 0;
                if (g.enchantEquippedItem()) {
                    const rt = (armor as unknown as { runicType?: string }).runicType;
                    if (rt) {
                        armorGrants++;
                        armorCounts.set(rt, (armorCounts.get(rt) ?? 0) + 1);
                    }
                }
            }
            g.player.equippedWeapon = savedWeapon;
        }

        // 自创符文必须 0 次
        for (const r of INVENTED.weaponRunics) {
            expect(weaponCounts.get(r) ?? 0, `附魔路径授予了自创武器符文 ${r}`).toBe(0);
        }
        for (const r of INVENTED.armorRunics) {
            expect(armorCounts.get(r) ?? 0, `附魔路径授予了自创护甲符文 ${r}`).toBe(0);
        }

        // 反真空：20% 命中率 × 16000 次 ≈ 3200 次授予，且每个 CE 符文都真实出现过
        expect(weaponGrants).toBeGreaterThan(1000);
        expect(armorGrants).toBeGreaterThan(1000);
        for (const r of ItemLoader.GENERATED_WEAPON_RUNICS) {
            expect(weaponCounts.get(r) ?? 0, `CE 武器符文 ${r} 在附魔路径出现过多（池不完整？）`).toBeGreaterThanOrEqual(20);
        }
        for (const r of ItemLoader.GENERATED_ARMOR_RUNICS) {
            expect(armorCounts.get(r) ?? 0, `CE 护甲符文 ${r} 在附魔路径出现过多（池不完整？）`).toBeGreaterThanOrEqual(20);
        }
    }, 120000);
});

describe('D2 随机流大量采样：自创符文 0 出现', () => {
    // 20 seed × (13 武器 + 6 护甲) × 20 次 ≈ 7600 次直接生成；
    // 符文触发率 12%/10%，期望 ~600+ 次符文命中，逐 CE 符文断言出现次数下限。
    const SEEDS = Array.from({ length: 20 }, (_, i) => 77_000 + i * 1_317);
    const SPAWNS_PER_KIND = 20;

    it(`20 seed × 19 种装备 × ${SPAWNS_PER_KIND} 次：vampirism/venom/vitality 出现 0 次，CE 符文均出现`, () => {
        const weaponRunicCounts = new Map<string, number>();
        const armorRunicCounts = new Map<string, number>();
        let weaponSpawns = 0;
        let armorSpawns = 0;

        for (const seed of SEEDS) {
            rng.seedRandomGenerator(seed);
            for (const w of ItemLoader.weapons) {
                for (let i = 0; i < SPAWNS_PER_KIND; i++) {
                    const item = ItemLoader.spawnWeapon(w.id, 0, 0);
                    weaponSpawns++;
                    if (item?.runicType) {
                        weaponRunicCounts.set(item.runicType, (weaponRunicCounts.get(item.runicType) ?? 0) + 1);
                    }
                }
            }
            for (const a of ItemLoader.armors) {
                for (let i = 0; i < SPAWNS_PER_KIND; i++) {
                    const item = ItemLoader.spawnArmor(a.id, 0, 0);
                    armorSpawns++;
                    if (item?.runicType) {
                        armorRunicCounts.set(item.runicType, (armorRunicCounts.get(item.runicType) ?? 0) + 1);
                    }
                }
            }
        }

        // 自创符文必须 0 次
        for (const r of INVENTED.weaponRunics) {
            expect(weaponRunicCounts.get(r) ?? 0, `武器符文 ${r} 不应出现在生成流中`).toBe(0);
        }
        for (const r of INVENTED.armorRunics) {
            expect(armorRunicCounts.get(r) ?? 0, `护甲符文 ${r} 不应出现在生成流中`).toBe(0);
        }

        // 反真空：生成确实大量发生，且每个 CE 符文都真实出现过
        expect(weaponSpawns).toBe(SEEDS.length * ItemLoader.weapons.length * SPAWNS_PER_KIND);
        expect(armorSpawns).toBe(SEEDS.length * ItemLoader.armors.length * SPAWNS_PER_KIND);
        const totalWeaponRunics = [...weaponRunicCounts.values()].reduce((s, n) => s + n, 0);
        const totalArmorRunics = [...armorRunicCounts.values()].reduce((s, n) => s + n, 0);
        expect(totalWeaponRunics).toBeGreaterThan(300);
        expect(totalArmorRunics).toBeGreaterThan(150);
        for (const r of ItemLoader.GENERATED_WEAPON_RUNICS) {
            expect(weaponRunicCounts.get(r) ?? 0, `CE 武器符文 ${r} 出现过少`).toBeGreaterThanOrEqual(5);
        }
        for (const r of ItemLoader.GENERATED_ARMOR_RUNICS) {
            expect(armorRunicCounts.get(r) ?? 0, `CE 护甲符文 ${r} 出现过少`).toBeGreaterThanOrEqual(5);
        }
    });
});

describe('D2 整层生成扫描：20 seed × D1-D26 遇不到任何自创项', () => {
    const SEEDS = Array.from({ length: 20 }, (_, i) => 4_242_000 + i * 7_777);

    it('520 层生成的地面/机器/祭坛/金库物品中自创项出现 0 次', () => {
        const seenIds = new Set<string>();
        let totalItems = 0;
        const byCategory = new Map<string, number>();

        for (const seed of SEEDS) {
            const game = createHeadlessGame(seed);
            const g = game as unknown as GameWithGenerateDepth;
            for (let depth = 1; depth <= 26; depth++) {
                if (depth > 1) {
                    game.depth = depth;
                    g.generateDepth(false, false); // 等价走下行楼梯的新层生成路径
                }
                for (const item of game.items) {
                    totalItems++;
                    const catName = ItemCategory[item.category];
                    byCategory.set(catName, (byCategory.get(catName) ?? 0) + 1);
                    seenIds.add(identityOf(item));
                    if ((item as unknown as { runicType?: string }).runicType) {
                        seenIds.add((item as unknown as { runicType: string }).runicType);
                    }
                }
            }
        }

        // 逐项断言自创 id / 符文 / 显示名 0 出现（报出实际撞见者，便于定位回退点）
        const offenders = [...seenIds].filter(id =>
            ALL_INVENTED_IDS.includes(id) || INVENTED_DISPLAY_NAMES.has(id));
        expect(offenders, `整层生成撞见自创项：${offenders.join(', ')}`).toEqual([]);

        // 反真空：520 层确实生成了大量物品，且各主要类别都出现过
        expect(totalItems).toBeGreaterThan(1000);
        for (const cat of ['POTION', 'SCROLL', 'WAND', 'STAFF', 'RING', 'CHARM', 'WEAPON', 'ARMOR']) {
            expect(byCategory.get(cat) ?? 0, `类别 ${cat} 在 520 层中一次都未生成（池被清空？）`).toBeGreaterThan(0);
        }
    }, 120000);
});
