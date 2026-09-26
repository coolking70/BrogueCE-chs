/**
 * itemFlavors.test.ts — 未鉴定物品外观池的验收测试
 *
 * 背景：外观池曾小于物品种类数（药水 8 池 vs 16 种……），initConsumables 里
 * `if (index < shuffled.length)` 静默跳过，导致部分物品永远显示 "Unknown"。
 * 本文件锁定三点验收标准：
 *   1. 每个外观池的大小 >= 对应未知物品种类数（CE 五类）；
 *   2. 固定 seed 初始化后，每种药水/卷轴/魔杖/法杖/戒指都有非空外观，
 *      且同类内无两种物品共用同一外观（双射）；
 *   3. 不同 seed 产生不同的外观分配（每局洗牌生效）。
 *
 * 池大小与词表对齐 BrogueCE（Rogue.h:1071-1077、Globals.c itemColorsRef /
 * itemWoodsRef / itemMetalsRef / itemGemsRef / titlePhonemes）。
 * X2e 前提修正：CE Items.c:364–373 的护符出生即 ITEM_IDENTIFIED，
 * 不属于未知外观五类。保留五类的全部覆盖/双射/中文断言，并另验护符无需外观。
 * 原守卫 HEAD 绿、仅扩护符目录即三项红的反事实见 x2e.report.md；交验收方裁决。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import i18next from 'i18next';
import zhCN from '../../locales/zh_CN.json';
import { ItemLoader } from './ItemLoader';
import { rng } from '../Random';

const SEED_A = 20260914;
const SEED_B = 987654321;

beforeAll(() => {
    if (!i18next.isInitialized) {
        i18next.init({
            lng: 'zh_CN',
            fallbackLng: 'zh_CN',
            resources: { zh_CN: { translation: zhCN as any } },
            initImmediate: false, // 同步初始化，init 后立即可用
        });
    }
});

function initFlavors(seed: number): void {
    rng.seedRandomGenerator(seed);
    ItemLoader.initConsumables();
}

/** 五类未知物品的外观分配快照（id → 外观名），供跨 seed 比较。 */
function flavorSnapshot(): Record<string, Record<string, string>> {
    const potion: Record<string, string> = {};
    for (const p of ItemLoader.potions) {
        potion[p.id] = ItemLoader.potionFlavorMap.get(p.id)?.name ?? '';
    }
    const scroll: Record<string, string> = {};
    for (const s of ItemLoader.scrolls) {
        scroll[s.id] = ItemLoader.scrollFlavorMap.get(s.id) ?? '';
    }
    const arcana: Record<string, string> = {};
    for (const [pool, label] of [
        ['wands', 'wand'], ['staffs', 'staff'], ['rings', 'ring'],
    ] as const) {
        for (const a of ItemLoader[pool]) {
            arcana[`${label}:${a.id}`] = ItemLoader.arcanaFlavorMap.get(a.id) ?? '';
        }
    }
    return { potion, scroll, arcana };
}

describe('未鉴定物品外观池', () => {
    it('1a. 每个外观池的大小 >= 对应未知物品种类数（CE 五类全覆盖）', () => {
        expect(ItemLoader.potionColors.length).toBeGreaterThanOrEqual(ItemLoader.potions.length);
        expect(ItemLoader.titlePhonemes.length).toBeGreaterThanOrEqual(ItemLoader.scrolls.length);
        expect(ItemLoader.wandFlavorNames.length).toBeGreaterThanOrEqual(ItemLoader.wands.length);
        expect(ItemLoader.staffFlavorNames.length).toBeGreaterThanOrEqual(ItemLoader.staffs.length);
        expect(ItemLoader.ringFlavorNames.length).toBeGreaterThanOrEqual(ItemLoader.rings.length);
    });

    it('1b. 各池内部无重复词条（双射的前提）', () => {
        const dup = <T,>(xs: T[]): T[] =>
            xs.filter((x, i) => xs.indexOf(x) !== i);
        const potionNames = dup(ItemLoader.potionColors.map(c => c.name));
        expect(potionNames).toEqual([]);
        const potionColors = dup(ItemLoader.potionColors.map(c => c.color));
        expect(potionColors).toEqual([]);
        expect(dup(ItemLoader.titlePhonemes)).toEqual([]);
        expect(dup(ItemLoader.wandFlavorNames)).toEqual([]);
        expect(dup(ItemLoader.staffFlavorNames)).toEqual([]);
        expect(dup(ItemLoader.ringFlavorNames)).toEqual([]);
        expect(dup(ItemLoader.charmFlavorNames)).toEqual([]);
    });

    it('2. 固定 seed 下五类未知物品全部有非空外观，且同类内两两不同（双射）', () => {
        initFlavors(SEED_A);

        // 药水：名称与颜色都要构成双射（颜色是地牢里的实际外观）
        const potionNames = ItemLoader.potions.map(p => ItemLoader.potionFlavorMap.get(p.id));
        for (const f of potionNames) {
            expect(f, '每种药水都应分配到外观').toBeDefined();
            expect(f!.name.trim(), '药水外观名非空').not.toBe('');
        }
        expect(new Set(potionNames.map(f => f!.name)).size).toBe(ItemLoader.potions.length);
        expect(new Set(potionNames.map(f => f!.color)).size).toBe(ItemLoader.potions.length);

        // 卷轴
        const scrollTitles = ItemLoader.scrolls.map(s => ItemLoader.scrollFlavorMap.get(s.id));
        for (const t of scrollTitles) {
            expect(t, '每张卷轴都应分配到标题').toBeDefined();
            expect(t!.trim()).not.toBe('');
        }
        expect(new Set(scrollTitles).size).toBe(ItemLoader.scrolls.length);

        // 魔杖/法杖/戒指
        for (const [pool, label] of [
            ['wands', '魔杖'], ['staffs', '法杖'], ['rings', '戒指'],
        ] as const) {
            const flavors = ItemLoader[pool].map(a => ItemLoader.arcanaFlavorMap.get(a.id));
            for (const f of flavors) {
                expect(f, `每个${label}都应分配到外观`).toBeDefined();
                expect(f!.trim()).not.toBe('');
            }
            expect(new Set(flavors).size, `${label}外观应为双射`).toBe(ItemLoader[pool].length);
        }
    });

    it('2b. zh_CN 资源下所有外观显示名都是中文（不得回退为英文键）', () => {
        initFlavors(SEED_A);
        const all = [
            ...ItemLoader.potions.map(p => ItemLoader.potionFlavorMap.get(p.id)!.name),
            ...ItemLoader.scrolls.map(s => ItemLoader.scrollFlavorMap.get(s.id)!),
            ...ItemLoader.wands.map(a => ItemLoader.arcanaFlavorMap.get(a.id)!),
            ...ItemLoader.staffs.map(a => ItemLoader.arcanaFlavorMap.get(a.id)!),
            ...ItemLoader.rings.map(a => ItemLoader.arcanaFlavorMap.get(a.id)!),
        ];
        for (const name of all) {
            expect(name, `外观名 "${name}" 不应含未翻译的英文`).not.toMatch(/[A-Za-z]/);
        }
    });

    it('2c. CE 护符出生即鉴定，无外观映射时仍显示完整中文名称', () => {
        initFlavors(SEED_A);
        for (const data of ItemLoader.charms) {
            ItemLoader.arcanaFlavorMap.delete(data.id);
            const charm = ItemLoader.spawnCharm(data.id, 0, 0)!;
            expect(charm, data.id).not.toBeNull();
            expect(charm.identified, data.id).toBe(true);
            expect(ItemLoader.identifiedItems.has(data.id), data.id).toBe(true);
            expect(charm.displayName.trim(), data.id).not.toBe('');
            expect(charm.displayName, data.id).toMatch(/[\u4e00-\u9fff]/);
            expect(charm.displayName, data.id).not.toMatch(/[A-Za-z]/);
        }
    });

    it('3. 不同 seed 产生不同的外观分配（每局洗牌生效）', () => {
        initFlavors(SEED_A);
        const snapshotA = flavorSnapshot();

        initFlavors(SEED_B);
        const snapshotB = flavorSnapshot();

        expect(snapshotB).not.toEqual(snapshotA);

        // 再换一个 seed，覆盖性检查依然成立（多次洗牌不漏配、不重配）
        for (const seed of [1, 42, 13579, 20260101]) {
            initFlavors(seed);
            const names = ItemLoader.potions.map(p => ItemLoader.potionFlavorMap.get(p.id)!.name);
            expect(new Set(names).size).toBe(ItemLoader.potions.length);
            const titles = ItemLoader.scrolls.map(s => ItemLoader.scrollFlavorMap.get(s.id)!);
            expect(new Set(titles).size).toBe(ItemLoader.scrolls.length);
        }
    });
});
