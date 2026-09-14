/**
 * src/engine/Items/ItemLoader.ts
 * Parses item JSON files and spawns Item instances
 */

import { Item, ItemCategory } from './Item';
import weaponsData from '../../data/weapons.json';
import armorsData from '../../data/armors.json';
import consumablesData from '../../data/consumables.json';
import arcanaData from '../../data/arcana.json';
import { rng, RNGType } from '../Random';
import i18next from 'i18next';

/** Translate an entity name using the 'name.X' key, falling back to the English name. */
function tn(name: string): string {
    return i18next.t('name.' + name, { defaultValue: name });
}

export interface ConsumableConfig {
    id: string;
    trueName: string;
    effect: string;
    minDepth: number;
    maxDepth: number;
    /** D2：true = web 自创条目（CE 无对应），保留定义与效果实现，但退出生成池 */
    excludeFromGeneration?: boolean;
}

export interface ArcanaConfig {
    id: string;
    name: string;
    minDepth: number;
    maxDepth: number;
    weight: number;
    color: number;
    maxCharges?: number;
    rechargeTurns?: number;
    cooldownTurns?: number;
    /** D2：true = web 自创条目（CE 无对应），保留定义与效果实现，但退出生成池 */
    excludeFromGeneration?: boolean;
}

/** 「是否参与生成」字段名：与 data json 中的约定一致 */
type Poolable = { excludeFromGeneration?: boolean };

export class ItemLoader {
    public static weapons = weaponsData as any[];
    public static armors = armorsData as any[];
    public static potions = consumablesData.potions as ConsumableConfig[];
    public static scrolls = consumablesData.scrolls as ConsumableConfig[];
    public static food = consumablesData.food as ConsumableConfig[];
    public static wands = arcanaData.wands as ArcanaConfig[];
    public static staffs = arcanaData.staffs as ArcanaConfig[];
    public static rings = arcanaData.rings as ArcanaConfig[];
    public static charms = arcanaData.charms as ArcanaConfig[];
    public static keys = arcanaData.keys as ArcanaConfig[];
    public static amulets = arcanaData.amulets as ArcanaConfig[];

    // ---- 生成池（D2：自创条目退出生成池，而非删除） ----
    // 上方 * 全量数组供直接构造（spawnXxx 按 id 查全量）与测试模式资产使用；
    // 下方 gen* 才是随机生成/掉落允许抽取的池子。新增自创条目时只需在
    // json 里标 excludeFromGeneration: true，无需改生成代码。
    public static genPotions = ItemLoader.filterPool(ItemLoader.potions);
    public static genScrolls = ItemLoader.filterPool(ItemLoader.scrolls);
    public static genFood = ItemLoader.filterPool(ItemLoader.food);
    public static genWands = ItemLoader.filterPool(ItemLoader.wands);
    public static genStaffs = ItemLoader.filterPool(ItemLoader.staffs);
    public static genRings = ItemLoader.filterPool(ItemLoader.rings);
    public static genCharms = ItemLoader.filterPool(ItemLoader.charms);
    public static genKeys = ItemLoader.filterPool(ItemLoader.keys);
    public static genAmulets = ItemLoader.filterPool(ItemLoader.amulets);
    public static genWeapons = ItemLoader.filterPool(ItemLoader.weapons);
    public static genArmors = ItemLoader.filterPool(ItemLoader.armors);

    private static filterPool<T extends Poolable>(arr: T[]): T[] {
        return arr.filter(x => !x.excludeFromGeneration);
    }

    // ---- 符文池（D2：venom/vampirism/vitality 为 web 自创，退出生成池） ----
    // CE 权威表：weaponRunicNames（Globals.c）10 种、armorRunicNames 11 种。
    // web 效果实现保留全部条目（Combat/Game 分支未动），池子只保留 CE 对应项。
    // 'paralyzing' 对应 CE 的 "paralysis" 符文（拼写差异，非自创）。
    public static readonly ALL_WEAPON_RUNICS = [
        'paralyzing', 'venom', 'quietus', 'vampirism', 'speed',
        'confusion', 'force', 'slaying', 'mercy'
    ] as const;
    public static readonly GENERATED_WEAPON_RUNICS = [
        'paralyzing', 'quietus', 'speed', 'confusion', 'force', 'slaying', 'mercy'
    ] as const;
    public static readonly ALL_ARMOR_RUNICS = [
        'reflection', 'dampening', 'mutuality', 'respiration', 'vitality',
        'absorption', 'reprisal', 'immunity'
    ] as const;
    public static readonly GENERATED_ARMOR_RUNICS = [
        'reflection', 'dampening', 'mutuality', 'respiration', 'absorption', 'reprisal', 'immunity'
    ] as const;

    // Mappings from true ID to fake name/color
    public static potionFlavorMap = new Map<string, { name: string, color: number }>();
    public static scrollFlavorMap = new Map<string, string>();
    public static arcanaFlavorMap = new Map<string, string>();

    // Which IDs have been identified by the player
    public static identifiedItems = new Set<string>();

    // ---- 未鉴定物品外观池 ----
    // 池大小对齐 BrogueCE（Rogue.h:1071-1077：色 21 / 题素 21 / 木 21 / 金 12 / 石 18），
    // 词表取自 Globals.c 的 itemColorsRef / itemWoodsRef / itemMetalsRef / itemGemsRef
    // 与 titlePhonemes，中文选词参考 CE 本地化资源 bin/assets/zh_CN.todo.json。
    // 每个池必须 ≥ 对应物品种类数（initConsumables 里不足会 console.error），
    // 且池内显示名两两不同，否则同一局会出现两种物品共用同一外观。
    // 既有条目保留原英文键（经 zh_CN.json 翻译）；新增词条直接存中文显示名，
    // tn() 对无 i18n 键的字符串原样返回。
    public static potionColors = [
        { name: 'Red Potion', color: 0xff4444 },
        { name: 'Blue Potion', color: 0x4444ff },
        { name: 'Green Potion', color: 0x44ff44 },
        { name: 'Bubbly Potion', color: 0xffffff },
        { name: 'Viscous Potion', color: 0x884400 },
        { name: 'Smoky Potion', color: 0x555555 },
        { name: 'Golden Potion', color: 0xffdd44 },
        { name: 'Purple Potion', color: 0xaa44ff },
        // itemColorsRef 21 色，去与上方重复的 green/blue 后补入 19 色
        { name: '深红色药水', color: 0x8b0000 },   // crimson
        { name: '猩红色药水', color: 0xe34234 },   // scarlet
        { name: '橙色药水', color: 0xff8800 },     // orange
        { name: '黄色药水', color: 0xffff00 },     // yellow
        { name: '靛蓝色药水', color: 0x3f00b0 },   // indigo
        { name: '紫罗兰色药水', color: 0x9b30ff }, // violet
        { name: '暗紫红色药水', color: 0x9f6a7a }, // puce
        { name: '紫红色药水', color: 0xe0b0ff },   // mauve
        { name: '酒红色药水', color: 0x800020 },   // burgundy
        { name: '青绿色药水', color: 0x30d5c8 },   // turquoise
        { name: '海蓝色药水', color: 0x7fffd4 },   // aquamarine
        { name: '灰色药水', color: 0xaaaaaa },     // gray
        { name: '粉色药水', color: 0xff88bb },     // pink
        { name: '白色药水', color: 0xf5f5f5 },     // white
        { name: '薰衣草色药水', color: 0xb57edc }, // lavender
        { name: '棕褐色药水', color: 0xd2b48c },   // tan
        { name: '棕色药水', color: 0xa0522d },     // brown
        { name: '青色药水', color: 0x00e5e5 },     // cyan
        { name: '黑色药水', color: 0x222222 }      // black
    ];

    /** Translate a name string via i18next. */
    public static translateName(name: string): string { return tn(name); }

    // 卷轴标题不用固定词表，按 CE 方式程序化拼装：从 titlePhonemes 取 3~4 个
    // 词素连成标题（Items.c:8851-8856，NUMBER_TITLE_PHONEMES=21），每局随机。
    public static titlePhonemes = [
        '玄妙', '天书', '灵符', '古咒', '星辰',
        '妙法', '幻影', '金光', '火雷', '水月',
        '虚空', '玉简', '道典', '法阵', '秘术',
        '奥义', '冥力', '苍穹', '混沌', '无极',
        '灵魂'
    ];

    public static wandFlavorNames = [
        'Copper Wand',
        'Oak Wand',
        'Crystal Wand',
        'Ivory Wand',
        'Carved Wand',
        'Runed Wand',
        // itemMetalsRef 12 金属，去与 Copper Wand（铜）重复的 copper，补入 11 种
        '青铜魔杖', // bronze
        '钢铁魔杖', // steel
        '黄铜魔杖', // brass
        '白锡魔杖', // pewter
        '镍魔杖',   // nickel
        '铝魔杖',   // aluminum
        '钨魔杖',   // tungsten
        '钛魔杖',   // titanium
        '钴魔杖',   // cobalt
        '铬魔杖',   // chromium
        '银魔杖'    // silver
    ];

    public static staffFlavorNames = [
        'Ashwood Staff',
        'Bronze Staff',
        'Blackwood Staff',
        'Marble Staff',
        'Twisted Staff',
        'Polished Staff',
        // itemWoodsRef 21 种木材全量补入
        '柚木法杖',     // teak
        '橡木法杖',     // oak
        '红木法杖',     // redwood
        '花楸木法杖',   // rowan
        '柳木法杖',     // willow
        '桃花心木法杖', // mahogany
        '松木法杖',     // pinewood
        '枫木法杖',     // maple
        '竹法杖',       // bamboo
        '铁木法杖',     // ironwood
        '梨木法杖',     // pearwood
        '桦木法杖',     // birch
        '樱桃木法杖',   // cherry
        '桉木法杖',     // eucalyptus
        '胡桃木法杖',   // walnut
        '雪松木法杖',   // cedar
        '玫瑰木法杖',   // rosewood
        '紫杉木法杖',   // yew
        '檀香木法杖',   // sandalwood
        '山核桃木法杖', // hickory
        '铁杉木法杖'    // hemlock
    ];

    public static ringFlavorNames = [
        'Agate Ring',
        'Copper Ring',
        'Jade Ring',
        'Silver Ring',
        'Iron Ring',
        'Gold Ring',
        // itemGemsRef 18 石，去与 Agate Ring（玛瑙）重复的 agate，补入 17 种
        '钻石戒指',     // diamond
        '蛋白石戒指',   // opal
        '石榴石戒指',   // garnet
        '红宝石戒指',   // ruby
        '紫水晶戒指',   // amethyst
        '黄玉戒指',     // topaz
        '缟玛瑙戒指',   // onyx
        '碧玺戒指',     // tourmaline
        '蓝宝石戒指',   // sapphire
        '黑曜石戒指',   // obsidian
        '孔雀石戒指',   // malachite
        '海蓝宝石戒指', // aquamarine
        '祖母绿戒指',   // emerald
        '玉戒指',       // jade
        '变石戒指',     // alexandrite
        '血石戒指',     // bloodstone
        '碧玉戒指'      // jasper
    ];

    public static charmFlavorNames = [
        'Bone Charm',
        'Amber Charm',
        'Stone Charm',
        'Glass Charm',
        'Bronze Charm',
        'Ivory Charm'
    ];

    public static initConsumables() {
        this.potionFlavorMap.clear();
        this.scrollFlavorMap.clear();
        this.arcanaFlavorMap.clear();
        this.identifiedItems.clear();

        // 外观是纯展示层随机，走 RNG_COSMETIC，不消耗主随机流（RNG_SUBSTANTIVE）：
        // 外观池大小的任何变化都不得移位同一 seed 下的地牢/怪物生成序列。
        // （CE 的 shuffleFlavors 在主流上洗牌，但依赖池大小恒定；web 池可调，须解耦。）
        rng.setRNG(RNGType.RNG_COSMETIC);
        try {
            this.assignAllFlavors();
        } finally {
            rng.setRNG(RNGType.RNG_SUBSTANTIVE);
        }
    }

    private static assignAllFlavors() {
        // Shuffle flavors
        const shuffledPotions = [...this.potionColors];
        rng.shuffleList(shuffledPotions);

        if (shuffledPotions.length < this.potions.length) {
            console.error(
                `[ItemLoader] 药水外观池不足：池 ${shuffledPotions.length} < 药水 ${this.potions.length} 种，` +
                '不足者将显示为 Unknown Potion'
            );
        }

        // Assign to potions
        this.potions.forEach((p, index) => {
            const orig = shuffledPotions[index];
            if (!orig) {
                console.error(`[ItemLoader] 药水 ${p.id} 未分配到外观，将显示为 Unknown Potion`);
                return;
            }
            this.potionFlavorMap.set(p.id, { name: tn(orig.name), color: orig.color });
        });

        // Assign to scrolls（程序化标题，一局内两两不同）
        const usedTitles = new Set<string>();
        this.scrolls.forEach((s) => {
            this.scrollFlavorMap.set(s.id, this.generateScrollTitle(usedTitles));
        });

        this.assignArcanaFlavors(this.wands, this.wandFlavorNames, '魔杖');
        this.assignArcanaFlavors(this.staffs, this.staffFlavorNames, '法杖');
        this.assignArcanaFlavors(this.rings, this.ringFlavorNames, '戒指');
        this.assignArcanaFlavors(this.charms, this.charmFlavorNames, '护符');
    }

    /** CE 式卷轴标题：3~4 个词素拼接，重试保证一局内不重复（Items.c:8851-8856）。 */
    private static generateScrollTitle(used: Set<string>): string {
        for (let attempt = 0; attempt < 1000; attempt++) {
            let title = '';
            const phonemeCount = rng.randRange(3, 4);
            for (let i = 0; i < phonemeCount; i++) {
                title += ItemLoader.titlePhonemes[rng.randRange(0, ItemLoader.titlePhonemes.length - 1)];
            }
            if (!used.has(title)) {
                used.add(title);
                return `题为「${title}」的卷轴`;
            }
        }
        throw new Error('[ItemLoader] 无法生成不重复的卷轴标题（词素空间耗尽？）');
    }

    private static assignArcanaFlavors(pool: ArcanaConfig[], flavors: string[], label: string) {
        if (flavors.length < pool.length) {
            console.error(
                `[ItemLoader] ${label}外观池不足：池 ${flavors.length} < ${label} ${pool.length} 种，` +
                '不足者将显示为 Unknown'
            );
        }
        const shuffled = [...flavors];
        rng.shuffleList(shuffled);
        pool.forEach((entry, index) => {
            const flavor = shuffled[index];
            if (!flavor) {
                console.error(`[ItemLoader] ${label} ${entry.id} 未分配到外观，将显示为 Unknown`);
                return;
            }
            this.arcanaFlavorMap.set(entry.id, tn(flavor));
        });
    }

    public static spawnPotion(id: string, x: number, y: number): Item | null {
        const data = this.potions.find(p => p.id === id);
        if (!data) return null;

        const flavor = this.potionFlavorMap.get(id) || { name: tn('Unknown Potion'), color: 0x00ffff };

        const potion = new Item(tn(data.trueName), '!', flavor.color, ItemCategory.POTION);
        potion.loc = { x, y };
        potion.weight = 10;
        // Store true ID for logic
        (potion as any).consumableId = id;

        return potion;
    }

    public static spawnScroll(id: string, x: number, y: number): Item | null {
        const data = this.scrolls.find(s => s.id === id);
        if (!data) return null;

        const scroll = new Item(tn(data.trueName), '?', 0xffebcd, ItemCategory.SCROLL);
        scroll.loc = { x, y };
        scroll.weight = 5;
        (scroll as any).consumableId = id;

        return scroll;
    }

    public static spawnFood(id: string, x: number, y: number): Item | null {
        const data = this.food.find(f => f.id === id);
        if (!data) return null;

        const foodItem = new Item(tn(data.trueName), '%', 0xddaa55, ItemCategory.FOOD);
        foodItem.loc = { x, y };
        foodItem.weight = 5;
        (foodItem as any).consumableId = id;

        return foodItem;
    }

    public static identify(consumableId: string) {
        this.identifiedItems.add(consumableId);
    }

    public static getWeaponConfigs() {
        return this.weapons.map((w) => ({ ...w }));
    }

    public static getArmorConfigs() {
        return this.armors.map((a) => ({ ...a }));
    }

    public static spawnWeapon(id: string, x: number, y: number): Item | null {
        const data = this.weapons.find(w => w.id === id);
        if (!data) return null;

        const weapon = new Item(tn(data.name), ')', 0xcccccc, ItemCategory.WEAPON);
        weapon.loc = { x, y };
        weapon.weight = data.weight || 0;
        weapon.damage = data.damage;
        weapon.strengthRequired = data.strengthRequired;

        // 20% chance for modifier
        if (rng.randPercent(20)) {
            weapon.enchantment = rng.randRange(-1, 2);
            if (weapon.enchantment < 0) {
                weapon.isCursed = true;
            }
        }
        if (rng.randPercent(12)) {
            const runics = ItemLoader.GENERATED_WEAPON_RUNICS;
            weapon.runicType = runics[rng.randRange(0, runics.length - 1)];
        }

        return weapon;
    }

    public static spawnArmor(id: string, x: number, y: number): Item | null {
        const data = this.armors.find(a => a.id === id);
        if (!data) return null;

        const armor = new Item(tn(data.name), ']', 0x888888, ItemCategory.ARMOR);
        armor.loc = { x, y };
        armor.weight = data.weight || 0;
        armor.armor = data.armor;
        armor.strengthRequired = data.strengthRequired;

        // 20% chance for modifier
        if (rng.randPercent(20)) {
            armor.enchantment = rng.randRange(-1, 2);
            if (armor.enchantment < 0) {
                armor.isCursed = true;
            }
        }
        if (rng.randPercent(10)) {
            const runics = ItemLoader.GENERATED_ARMOR_RUNICS;
            armor.runicType = runics[rng.randRange(0, runics.length - 1)];
        }

        return armor;
    }

    public static spawnWand(id: string, x: number, y: number): Item | null {
        const data = this.wands.find((w) => w.id === id);
        if (!data) return null;
        const wand = new Item(tn(data.name), '/', data.color, ItemCategory.WAND);
        wand.loc = { x, y };
        wand.weight = data.weight;
        wand.maxCharges = data.maxCharges ?? 1;
        wand.charges = wand.maxCharges;
        wand.rechargeTurns = data.rechargeTurns ?? 200;
        wand.rechargeCounter = 0;
        (wand as any).identityId = id;
        return wand;
    }

    public static spawnStaff(id: string, x: number, y: number): Item | null {
        const data = this.staffs.find((s) => s.id === id);
        if (!data) return null;
        const staff = new Item(tn(data.name), '\\', data.color, ItemCategory.STAFF);
        staff.loc = { x, y };
        staff.weight = data.weight;
        staff.maxCharges = data.maxCharges ?? 1;
        staff.charges = staff.maxCharges;
        staff.rechargeTurns = data.rechargeTurns ?? 200;
        staff.rechargeCounter = 0;
        (staff as any).identityId = id;
        return staff;
    }

    public static spawnRing(id: string, x: number, y: number): Item | null {
        const data = this.rings.find((r) => r.id === id);
        if (!data) return null;
        const ring = new Item(tn(data.name), '=', data.color, ItemCategory.RING);
        ring.loc = { x, y };
        ring.weight = data.weight;
        (ring as any).identityId = id;
        return ring;
    }

    public static spawnCharm(id: string, x: number, y: number): Item | null {
        const data = this.charms.find((c) => c.id === id);
        if (!data) return null;
        const charm = new Item(tn(data.name), '*', data.color, ItemCategory.CHARM);
        charm.loc = { x, y };
        charm.weight = data.weight;
        charm.cooldownTurns = data.cooldownTurns ?? 300;
        charm.cooldownRemaining = 0;
        (charm as any).identityId = id;
        return charm;
    }

    public static spawnKey(id: string, x: number, y: number): Item | null {
        const data = this.keys.find((k) => k.id === id);
        if (!data) return null;
        const key = new Item(tn(data.name), 'k', data.color, ItemCategory.KEY);
        key.loc = { x, y };
        key.weight = data.weight;
        return key;
    }

    public static spawnAmulet(id: string, x: number, y: number): Item | null {
        const data = this.amulets.find((a) => a.id === id);
        if (!data) return null;
        const amulet = new Item(tn(data.name), ',', data.color, ItemCategory.AMULET);
        amulet.loc = { x, y };
        amulet.weight = data.weight;
        (amulet as any).identityId = id;
        return amulet;
    }
}
