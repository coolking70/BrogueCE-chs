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

/** 实例 → 种类 id（药水/卷轴/食物用 consumableId，法器/护符用 identityId）。 */
function kindIdOf(item: Item): string | undefined {
    return (item as any).consumableId ?? (item as any).identityId;
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

    /**
     * B-1b：玩家给未识别风味种类起的绰号（CE itemTable.callTitle/called，
     * Rogue.h:1426-1427）。键 = 种类 id（consumableId/identityId）。
     * CE 语义（call()，Items.c:1347-1437）：
     *  - 只对五张风味种类表存在且种类未识别的物品开放（Items.c:1423-1425）；
     *  - 写入同时置 called=true（Items.c:1427-1428）；空文本 = 清除绰号
     *    （callTitle[0]='\0' + called=false，Items.c:1429-1432）——web 用
     *    "Map 里有无键" 表达 called，callKind(空串) 即 delete；
     *  - 种类识别后绰号不再显示（itemName 的 identified 分支短路，
     *    Items.c:1558/1578/1598/1638/1663），条目本身保留到新局；
     *  - 新局清零（resetItemTableEntry，Items.c:8778-8779）——见 initConsumables。
     * 持久化随 GameSnapshot.callTitles（P1-48，B-1b）。
     */
    public static callTitles = new Map<string, string>();

    /** CE call() 的落账段（Items.c:1423-1432）：空/纯空白文本清除绰号。 */
    public static callKind(kindId: string, title: string): void {
        if (title.trim()) {
            this.callTitles.set(kindId, title.trim());
        } else {
            this.callTitles.delete(kindId);
        }
    }

    // ---- B-1a：两层未知态模型的层 1（种类）与被动揭示引擎 ----
    // CE 权威出处（BrogueCE-master/src/）：
    //   - 熟悉度门槛：variants/GlobalsBrogue.c:1040-1042
    //     （weaponKillsToAutoID=20 / armorDelayToAutoID=1000 / ringDelayToAutoID=1500）
    //   - 计数器装载：Items.c:275（武器）/ 285（护甲）/ 353（戒指），charges 复用
    //   - 武器杀敌揭示：Combat.c:1099-1121 decrementWeaponAutoIDTimer
    //     （调用点 Combat.c:1427-1430：玩家近战击杀非无生命怪时扣减）
    //   - 护甲/戒指穿戴揭示：Time.c:1987-2024 processIncrementalAutoID
    //     （调用点 Time.c:2664，客观时间块内每 100 tick 扣 1）
    //   - identify()（实例全亮+种类亮）：Items.c:7636-7648
    //   - identifyItemKind()（种类亮 + 实例副规则）：Items.c:6675-6720
    //   - 最后一种类自动升格：Items.c:6635-6673 tryIdentifyLastItemKind(s)
    //   - 卷轴自亮例外：Items.c:8019-8026（enchanting/identify 两类用完不亮）
    //   - 戒指戴上即亮种类：Items.c:8583-8586（clairvoyance/light/stealth）
    //   - 魔杖放电计数：Items.c:7435（enchant2++）
    public static readonly WEAPON_KILLS_TO_AUTO_ID = 20;
    public static readonly ARMOR_DELAY_TO_AUTO_ID = 1000;
    public static readonly RING_DELAY_TO_AUTO_ID = 1500;

    /**
     * CE 充能区间退化的魔杖（wandTable lowerBound==upperBound，GlobalsBrogue.c:701-711
     * 逐行复核：唯有 empowerment {1,1,1}）。identifyItemKind 对它连实例一起亮
     * （Items.c:6701-6706：充能无隐藏价值）。纯数据留形，激活轮需重核 CE。
     */
    private static readonly DEGENERATE_CHARGE_WAND_KINDS: ReadonlySet<string> = new Set(['wand_of_empowerment']);

    /**
     * 戴上即识别种类的戒指（Items.c:8583-8586：RING_CLAIRVOYANCE / RING_LIGHT /
     * RING_STEALTH）。web 无 light 戒指（目录缺口，B-0 §5.1-9），留形于此，
     * 回池/新增轮次无需再查 CE。
     */
    private static readonly INSTANT_ID_RING_KINDS: ReadonlySet<string> = new Set([
        'ring_of_clairvoyance', 'ring_of_light', 'ring_of_stealth',
    ]);

    /** 戴上即亮种类的戒指（CE Items.c:8583-8586）。 */
    public static isInstantIdentifyRing(item: Item): boolean {
        return this.INSTANT_ID_RING_KINDS.has((item as any).identityId ?? '');
    }

    /**
     * 种类固有极性（CE magicPolarity 列，HAS_INTRINSIC_POLARITY = POTION|SCROLL|
     * RING|WAND|STAFF，Rogue.h:768）。B-1a 只用于"最后一种类自动升格"的极性分组
     * （Items.c:6635-6656）：某极性类只剩一种未识别，且对侧极性类全识别（或本类
     * 极性已被 detect magic 揭示——B-1c 才有载体，现恒 false）时，最后一种升格。
     * 取值：1 善意 / -1 恶意 / 0 无极性（不参与升格分组）。
     *
     * 数据来源（逐行复核，CE 行号）：
     *   - 药水 potionTable_Brogue，variants/GlobalsBrogue.c:665-682
     *   - 卷轴 scrollTable_Brogue，variants/GlobalsBrogue.c:684-699
     *   - 魔杖 wandTable_Brogue，variants/GlobalsBrogue.c:701-711
     *   - 法杖 staffTable，brogue/Globals.c:1641-1653
     *   - 戒指 ringTable，brogue/Globals.c:1656-1664（全部 +1）
     * web 自创/错位实体（CE 无此种类）记 0 并注明：potion_of_healing（自创，退池）、
     * scroll_of_amnesia（自创，退池）、wand_of_fire / wand_of_lightning（CE 法杖
     * 错位实体，退池）、staff_of_light（自创，退池）。CE 有而 web 缺的种类
     * （potion darkness、scroll aggravate、wand polymorphism/negation/domination/
     * plenty、ring light/reaping、staff tunneling/blinking/entrancement/obstruction/
     * discord/protection）不在 web 表内，不参与分组——回池/补目录轮无需改本表。
     *
     * ★ D2 后果（结构性不可达，激活轮需重核）：potion_of_poison（=CE caustic gas，
     * 恶意 -1）与 potion_of_creeping_death（=CE POTION_LICHEN，恶意 -1）均退池且
     * 永不被识别，恶意药水类恒有未识别种 → 恶意药水的"最后升格"在 B-4 回池前
     * 不可达；善意药水、卷轴、戒指、魔杖、法杖各类均可达。
     */
    private static readonly MAGIC_POLARITY: Readonly<Record<string, number>> = {
        // 药水（CE 16 类中 web 有 16 条，含 2 条自创）
        potion_of_life: 1,            // life
        potion_of_strength: 1,        // strength
        potion_of_telepathy: 1,       // telepathy
        potion_of_levitation: 1,      // levitation
        potion_of_detect_magic: 1,    // detect magic
        // B-1c 更正：CE POTION_SPEED 在 web 的 id 是 `potion_of_haste`
        // （consumables.json，trueName "Potion of Speed"、effect "speed"）。
        // B-1a 写成 `potion_of_speed` → 该键在表里恒查不到，速度药水此前
        // 落在"无极性"（0）而不参与善意分组；B-0 §5.1-9 "web 缺速度药水"
        // 的目录缺口结论同样不成立。见 b_1c 报告 §与预设不符。
        potion_of_haste: 1,           // speed
        potion_of_fire_immunity: 1,   // fire immunity
        potion_of_invisibility: 1,    // invisibility
        potion_of_poison: -1,         // caustic gas（CE 原生，web 误退池，B-4 回池）
        potion_of_paralysis: -1,      // paralysis
        potion_of_hallucination: -1,  // hallucination
        potion_of_confusion: -1,      // confusion
        potion_of_incineration: -1,   // incineration
        potion_of_descent: -1,        // descent
        potion_of_creeping_death: -1, // creeping death（=POTION_LICHEN，退池）
        potion_of_healing: 0,         // 自创（CE 无），退池
        // 卷轴（web 14 条，含 1 条自创；CE aggravate monsters web 缺）
        scroll_of_enchantment: 1,     // enchanting
        scroll_of_identify: 1,        // identify
        scroll_of_teleportation: 1,   // teleportation
        scroll_of_remove_curse: 1,    // remove curse
        scroll_of_recharging: 1,      // recharging
        scroll_of_protect_armor: 1,   // protect armor
        scroll_of_protect_weapon: 1,  // protect weapon
        scroll_of_sanctuary: 1,       // sanctuary
        scroll_of_magic_mapping: 1,   // magic mapping
        scroll_of_negation: 1,        // negation
        scroll_of_shattering: 1,      // shattering
        scroll_of_discord: 1,         // discord
        scroll_of_summon_monsters: -1,// summon monsters
        scroll_of_amnesia: 0,         // 自创（CE 无），退池
        // 魔杖（web 7 条，含 2 条错位实体；CE polymorphism/negation/domination/plenty web 缺）
        wand_of_teleportation: 1,     // teleportation
        wand_of_slowness: 1,          // slowness
        wand_of_beckoning: 1,         // beckoning
        wand_of_invisibility: -1,     // invisibility
        wand_of_empowerment: -1,      // empowerment
        wand_of_fire: 0,              // CE 法杖错位实体，退池
        wand_of_lightning: 0,         // 同上
        // 法杖（web 7 条，含 1 条自创；CE 其余 5 种 web 缺）
        staff_of_lightning: 1,        // lightning
        staff_of_fire: 1,             // firebolt
        staff_of_poison: 1,           // poison
        staff_of_conjuration: 1,      // conjuration
        staff_of_healing: -1,         // healing
        staff_of_haste: -1,           // haste
        staff_of_light: 0,            // 自创，退池
        // 戒指（web 6 条，全 +1；CE light/reaping web 缺）
        ring_of_clairvoyance: 1,
        ring_of_stealth: 1,
        ring_of_regeneration: 1,
        ring_of_transference: 1,
        ring_of_awareness: 1,
        ring_of_wisdom: 1,
    };

    /** 升格规则参与判定的种类全集（CE 语义：整张种类表，含退池条目）。 */
    private static kindsOfFlavoredCategory(category: ItemCategory): string[] {
        switch (category) {
            case ItemCategory.POTION: return this.potions.map(p => p.id);
            case ItemCategory.SCROLL: return this.scrolls.map(s => s.id);
            case ItemCategory.WAND: return this.wands.map(w => w.id);
            case ItemCategory.STAFF: return this.staffs.map(s => s.id);
            case ItemCategory.RING: return this.rings.map(r => r.id);
            default: return [];
        }
    }

    /**
     * B-1c：种类级"极性已被 detect magic 揭示"（CE itemTable.magicPolarityRevealed，
     * Rogue.h:1436）。CE 把它与 identified 并列存在 itemTable 里、随存档往返；
     * web 用与 identifiedItems 同款的种类 id 集合表达，随 GameSnapshot 持久化。
     * 新局清零：CE resetItemTableEntry（Items.c:8777）——见 initConsumables。
     */
    public static magicPolarityRevealed = new Set<string>();

    // 注意：下面两个类别集合必须**惰性**构造。ItemLoader.ts 与 Item.ts 是循环
    // 依赖（Item 引 ItemLoader 取风味表，ItemLoader 引 Item 的枚举），静态字段
    // 初始化器在模块求值期就跑，那时 ItemCategory 还是 undefined（实测：
    // "Cannot read properties of undefined (reading 'POTION')"）。static getter
    // 的求值推迟到第一次读取，绕开这个时序。
    private static _hasIntrinsicPolarity: ReadonlySet<ItemCategory> | null = null;
    private static _canBeDetected: ReadonlySet<ItemCategory> | null = null;

    /** CE HAS_INTRINSIC_POLARITY（Rogue.h:768）= POTION|SCROLL|RING|WAND|STAFF。 */
    public static get HAS_INTRINSIC_POLARITY(): ReadonlySet<ItemCategory> {
        if (!this._hasIntrinsicPolarity) {
            this._hasIntrinsicPolarity = new Set([
                ItemCategory.POTION, ItemCategory.SCROLL, ItemCategory.RING,
                ItemCategory.WAND, ItemCategory.STAFF,
            ]);
        }
        return this._hasIntrinsicPolarity;
    }

    /**
     * CE CAN_BE_DETECTED（Rogue.h:770）= WEAPON|ARMOR|POTION|SCROLL|RING|CHARM|
     * WAND|STAFF|AMULET。食物 / 金币 / 钥匙 / 宝石不在内。
     */
    public static get CAN_BE_DETECTED(): ReadonlySet<ItemCategory> {
        if (!this._canBeDetected) {
            this._canBeDetected = new Set([
                ItemCategory.WEAPON, ItemCategory.ARMOR, ItemCategory.POTION, ItemCategory.SCROLL,
                ItemCategory.RING, ItemCategory.CHARM, ItemCategory.WAND, ItemCategory.STAFF,
                ItemCategory.AMULET,
            ]);
        }
        return this._canBeDetected;
    }

    /** 种类固有极性的表查（CE itemTable[kind].magicPolarity）；表外种类记 0。 */
    public static kindPolarity(kindId: string | undefined): number {
        if (!kindId) return 0;
        return this.MAGIC_POLARITY[kindId] ?? 0;
    }

    /** detect magic 的极性揭示（CE itemTable[kind].magicPolarityRevealed）。 */
    public static isPolarityRevealed(kindId: string | undefined): boolean {
        return !!kindId && this.magicPolarityRevealed.has(kindId);
    }

    /**
     * CE itemMagicPolarity（Items.c:8267-8299）：这一**件**的极性。
     * 注意它与"种类固有极性"不是一回事——武器/护甲/戒指按实例的诅咒与附魔算，
     * 魔杖充能耗尽时降为 0，护符恒 +1；只有药水/卷轴/法杖/护符查种类表。
     * 返回 1 善意 / -1 恶意 / 0 无魔法。
     */
    public static itemMagicPolarity(item: Item): number {
        const kindId = kindIdOf(item);
        switch (item.category) {
            case ItemCategory.WEAPON:
            case ItemCategory.ARMOR:
            case ItemCategory.RING:
                // CE :8272-8277 / :8287-8293（两段同构）
                if (item.isCursed || item.enchantment < 0) return -1;
                if (item.enchantment > 0) return 1;
                return 0;
            case ItemCategory.WAND:
                // CE :8278-8281：充能为 0 的魔杖无魔法可言；否则**贯穿**到表查。
                if (item.charges === 0) return 0;
                return this.kindPolarity(kindId);
            case ItemCategory.CHARM:
                // CE :8283-8285 同样是表查，但 charmTable_Brogue 的 magicPolarity
                // 列**全部为 +1**（GlobalsBrogue.c 逐行复核 12 条，含被注释掉的
                // fear 在内无一例外），与 magicCharDiscoverySuffix(CHARM) 恒 1 一致。
                // web 的 MAGIC_POLARITY 只收五张风味表，护符不在其中 → 直接给常量，
                // 避免查表落到 0（护符被 detect magic 照到时该显示善意 sigil）。
                return 1;
            case ItemCategory.SCROLL:
            case ItemCategory.POTION:
            case ItemCategory.STAFF:
                return this.kindPolarity(kindId);
            case ItemCategory.AMULET:
                return 1; // CE :8295-8296
            default:
                return 0; // 食物/金币/钥匙：CE :8297-8298
        }
    }

    /**
     * CE magicCharDiscoverySuffix（Items.c:8213-8262）。**不是** magicPolarity 的
     * 同义词：它是一张与种类表并行的硬编码开关表，用于发现屏与"恶意品使用前
     * 确认"的前置条件（Items.c:7757 读卷轴 / 8050 喝药水）。
     * 逐行复核 CE 与 web 的差异：
     *  - POTION / SCROLL：CE 的 -1 名单与 potionTable/scrollTable 的 magicPolarity
     *    列逐条一致（GlobalsBrogue.c:665-698 复核），故这里查同一张表；
     *  - RING：CE 恒 0（:8250-8252），**与 ringTable 全 +1 的 magicPolarity 相反**；
     *  - CHARM：CE 恒 1（:8253-8255）；
     *  - WAND / STAFF：CE 查 boltCatalog[power].flags & BF_TARGET_ALLIES（:8243-8249）。
     *    web 没有"法器种类 → bolt 旗标"这张表（MONSTER_BOLT_TABLE 是怪物施法用的，
     *    按 CE bolt 名索引，不含 wand/staff 的 power 列），**结构性无载体**：
     *    此处恒返回 0 并由留痕测试钉住。CE 的两个消费点都只吃 POTION/SCROLL，
     *    本轮不受影响；补上 bolt 目录的那一轮必须回来重核这段。
     */
    public static magicCharDiscoverySuffix(item: Item): number {
        switch (item.category) {
            case ItemCategory.POTION:
            case ItemCategory.SCROLL:
                return this.kindPolarity(kindIdOf(item));
            case ItemCategory.RING:
                return 0;
            case ItemCategory.CHARM:
                return 1;
            case ItemCategory.WAND:
            case ItemCategory.STAFF:
                return 0; // 结构性无载体（见上）——激活轮需重核 CE :8243-8249
            default:
                return 0;
        }
    }

    /**
     * CE detectMagicOnItem（Items.c:8027-8038）。三件事，顺序与 CE 一致：
     *  1. 若类别有固有极性 → 该**种类**的 magicPolarityRevealed 置真；
     *  2. 这一**件**打 ITEM_MAGIC_DETECTED；
     *  3. 武器/护甲且 附魔恰为 0 且 无符文 → identify()（没有秘密可留，直接全亮）。
     * 注意 3 的条件是 `enchant1 == 0`，不是 `<= 0`——负附魔的武器护甲不自亮。
     */
    public static detectMagicOnItem(item: Item): void {
        const kindId = kindIdOf(item);
        if (kindId && this.HAS_INTRINSIC_POLARITY.has(item.category)) {
            this.magicPolarityRevealed.add(kindId);
        }
        item.magicDetected = true;
        if ((item.category === ItemCategory.WEAPON || item.category === ItemCategory.ARMOR)
            && item.enchantment === 0 && !item.runicType) {
            this.identifyInstance(item);
        }
    }

    /**
     * CE magicPolarityRevealedItemKindCount（Items.c:6609-6624）：某类别某极性里
     * "极性已知"的种类数——**identified 或 magicPolarityRevealed 都算**。
     */
    private static polarityKnownCount(kinds: string[], polarity: 1 | -1): number {
        return kinds.filter(k => this.MAGIC_POLARITY[k] === polarity
            && (this.identifiedItems.has(k) || this.magicPolarityRevealed.has(k))).length;
    }

    /**
     * CE tryIdentifyLastItemKind（Items.c:6634-6653）：某极性类只剩一种未识别时，
     * 若 (a) 该种类的极性已被揭示，或 (b) 对侧极性类的**极性全部已知**
     * （CE :6647-6648 的 oppositeRevealedCount == oppositeCount），则升格。
     *
     * B-1c 更正 B-1a：(b) 此前写成 "对侧全部 identified"，漏掉了 CE 计数函数里
     * 的 `|| magicPolarityRevealed`——那是极性揭示进入升格规则的**第二个**入口。
     * 只接上 isPolarityRevealed 并不能激活它（见报告 §B-1a 预测验证）。
     */
    private static tryIdentifyLastItemKind(category: ItemCategory, polarity: 1 | -1): void {
        const kinds = this.kindsOfFlavoredCategory(category);
        const inClass = kinds.filter(k => this.MAGIC_POLARITY[k] === polarity);
        const unidentified = inClass.filter(k => !this.identifiedItems.has(k));
        if (unidentified.length !== 1) return;
        const lastKind = unidentified[0]!;
        const oppositeCount = kinds.filter(k => this.MAGIC_POLARITY[k] === -polarity).length;
        const oppositeKnownCount = this.polarityKnownCount(kinds, -polarity as 1 | -1);
        if (this.isPolarityRevealed(lastKind) || oppositeKnownCount === oppositeCount) {
            this.identifiedItems.add(lastKind);
        }
    }

    /** CE tryIdentifyLastItemKinds（Items.c:6658-6673）：只对带固有极性的类别跑。 */
    private static tryIdentifyLastItemKinds(category: ItemCategory): void {
        if (this.HAS_INTRINSIC_POLARITY.has(category)) {
            this.tryIdentifyLastItemKind(category, 1);
            this.tryIdentifyLastItemKind(category, -1);
        }
    }

    /**
     * CE tryIdentifyLastItemKinds(HAS_INTRINSIC_POLARITY)（Items.c:8172，
     * detect magic 药水的收口）：对**全部**带固有极性的类别各跑一遍升格。
     */
    public static tryIdentifyLastItemKindsAllPolarityCategories(): void {
        for (const category of this.HAS_INTRINSIC_POLARITY) {
            this.tryIdentifyLastItemKinds(category);
        }
    }

    /**
     * CE identifyItemKind（Items.c:6675-6720）：种类亮 + 两条实例副规则——
     * 附魔 ≤0 的戒指与充能区间退化的魔杖在种类亮时连实例一起亮（无隐藏价值）。
     * 之后对该类别跑"最后一种类升格"。
     */
    public static identifyItemKind(item: Item): void {
        const kindId = (item as any).consumableId ?? (item as any).identityId as string | undefined;
        if (kindId) this.identifiedItems.add(kindId);

        if (item.category === ItemCategory.RING && item.enchantment <= 0) {
            item.identified = true;
        }
        if (item.category === ItemCategory.WAND && this.DEGENERATE_CHARGE_WAND_KINDS.has(kindId ?? '')) {
            item.identified = true;
        }
        if (kindId) this.tryIdentifyLastItemKinds(item.category);
    }

    /**
     * CE identify（Items.c:7636-7648）：这一件全亮（附魔+符文）并亮种类。
     * 鉴定卷轴 / 戒指熟悉度倒计时归零走这里。
     */
    public static identifyInstance(item: Item): void {
        item.identified = true;
        item.canBeIdentified = false;
        if (item.runicType) {
            item.runicKnown = true; // CE: RUNIC_IDENTIFIED | RUNIC_HINTED
        }
        this.identifyItemKind(item);
    }

    /**
     * CE updateIdentifiableItem（Items.c:7699-7713）：维护 ITEM_CAN_BE_IDENTIFIED——
     * "还有没有可学的东西"。鉴定卷轴的目标池按此过滤。
     */
    public static updateIdentifiableItem(item: Item): void {
        const kindId = (item as any).consumableId ?? (item as any).identityId as string | undefined;
        const kindKnown = !!kindId && this.identifiedItems.has(kindId);
        if ((item.category === ItemCategory.SCROLL || item.category === ItemCategory.POTION) && kindKnown) {
            item.canBeIdentified = false;
        } else if ((item.category === ItemCategory.RING || item.category === ItemCategory.STAFF
            || item.category === ItemCategory.WAND) && item.isIdentified && kindKnown) {
            item.canBeIdentified = false;
        } else if ((item.category === ItemCategory.WEAPON || item.category === ItemCategory.ARMOR)
            && item.isIdentified && (!item.runicType || item.runicKnown)) {
            item.canBeIdentified = false;
        } else if (item.category === ItemCategory.FOOD || item.category === ItemCategory.KEY
            || item.category === ItemCategory.CHARM || item.category === ItemCategory.GOLD
            || item.category === ItemCategory.AMULET) {
            item.canBeIdentified = false; // CE NEVER_IDENTIFIABLE
        }
    }

    /**
     * CE decrementWeaponAutoIDTimer（Combat.c:1099-1121）：装备中的未鉴定武器
     * 每击杀一个非无生命敌人扣 1（调用点 Combat.c:1427-1430），归零即实例亮。
     * 返回 true 表示这一次调用恰好揭示了。
     */
    public static decrementWeaponAutoIDTimer(weapon: Item | null): boolean {
        if (!weapon || weapon.isIdentified) return false;
        if (!weapon.charges || weapon.charges <= 0) return false;
        weapon.charges--;
        if (weapon.charges <= 0) {
            weapon.identified = true;
            weapon.canBeIdentified = false;
            return true;
        }
        return false;
    }

    /**
     * CE processIncrementalAutoID（Time.c:1987-2024）的单件扣减：护甲/戒指
     * 装备期间每客观块（100 tick）扣 1；归零时护甲只亮实例（"只表明有符文，
     * 不亮符文种类"），戒指走 identify() 全亮。
     * 返回 'armor' | 'ring' 表示这一次调用恰好揭示了什么，null = 无事发生。
     */
    public static decrementWornFamiliarity(item: Item | null): 'armor' | 'ring' | null {
        if (!item) return null;
        const isRing = item.category === ItemCategory.RING;
        const isArmor = item.category === ItemCategory.ARMOR;
        if (!isRing && !isArmor) return null;
        if (!item.charges || item.charges <= 0) return null;
        // CE 循环条件（Time.c:1995-1997）：实例未亮，或（戒指）种类未亮
        if (item.isIdentified && !(isRing && kindIdOf(item) && !this.identifiedItems.has(kindIdOf(item)!))) {
            return null;
        }
        item.charges--;
        if (item.charges > 0) return null;
        if (isRing) {
            this.identifyInstance(item); // CE: identify(theItem)——亮到真名
            return 'ring';
        }
        item.identified = true; // CE：护甲只亮实例，符文种类不必然揭示
        item.canBeIdentified = false;
        return 'armor';
    }

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
        // B-1b：绰号随新局清零（CE resetItemTableEntry，Items.c:8778-8779）。
        // loadSnapshot 先走本方法再从快照回放，两全。
        this.callTitles.clear();
        // B-1c：极性揭示随新局清零（CE resetItemTableEntry，Items.c:8777）。
        this.magicPolarityRevealed.clear();

        // B-1a：CE 开局清零（shuffleFlavors → resetItemTableEntry，Items.c:8775-8800）
        // 只清五张风味表；护符表预置 identified=true（GlobalsBrogue.c:714-726，
        // 护符无未知态），安卡/护符石实例在 makeItemInto 直接 ITEM_IDENTIFIED。
        // web 对齐：护符/护符的种类 id 开局即入已识别集（显示走真名）。
        for (const c of this.charms) this.identifiedItems.add(c.id);
        for (const a of this.amulets) this.identifiedItems.add(a.id);

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
        // B-1a：未鉴定品实例旗标（CE makeItemInto：CAN_BE_IDENTIFIED）
        potion.identified = false;
        potion.canBeIdentified = true;

        return potion;
    }

    public static spawnScroll(id: string, x: number, y: number): Item | null {
        const data = this.scrolls.find(s => s.id === id);
        if (!data) return null;

        const scroll = new Item(tn(data.trueName), '?', 0xffebcd, ItemCategory.SCROLL);
        scroll.loc = { x, y };
        scroll.weight = 5;
        (scroll as any).consumableId = id;
        scroll.identified = false;
        scroll.canBeIdentified = true;

        return scroll;
    }

    public static spawnFood(id: string, x: number, y: number): Item | null {
        const data = this.food.find(f => f.id === id);
        if (!data) return null;

        const foodItem = new Item(tn(data.trueName), '%', 0xddaa55, ItemCategory.FOOD);
        foodItem.loc = { x, y };
        foodItem.weight = 5;
        (foodItem as any).consumableId = id;
        // CE makeItemInto：食物无未知态，直接 ITEM_IDENTIFIED
        foodItem.identified = true;

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
        // P4-7：CE 按武器种类赋予的物品旗标（Items.c:209-236）随数据下发
        if (data.flags) weapon.flags = [...data.flags];

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

        // B-1a：实例未知态 + 熟悉度计数器（CE Items.c:275 charges=weaponKillsToAutoID，
        // 未鉴定品打 CAN_BE_IDENTIFIED——Items.c:1146-1148 同款）
        weapon.identified = false;
        weapon.canBeIdentified = true;
        weapon.charges = this.WEAPON_KILLS_TO_AUTO_ID;

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

        // B-1a：实例未知态 + 穿着熟悉度计数器（CE Items.c:285 charges=armorDelayToAutoID）
        armor.identified = false;
        armor.canBeIdentified = true;
        armor.charges = this.ARMOR_DELAY_TO_AUTO_ID;

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
        // B-1a：实例未知态（充能连 maxChargesKnown 都不亮，CE Items.c:1611-1634）
        wand.identified = false;
        wand.canBeIdentified = true;
        wand.maxChargesKnown = false;
        wand.timesUsed = 0;
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
        staff.identified = false;
        staff.canBeIdentified = true;
        staff.maxChargesKnown = false;
        return staff;
    }

    public static spawnRing(id: string, x: number, y: number): Item | null {
        const data = this.rings.find((r) => r.id === id);
        if (!data) return null;
        const ring = new Item(tn(data.name), '=', data.color, ItemCategory.RING);
        ring.loc = { x, y };
        ring.weight = data.weight;
        (ring as any).identityId = id;
        // B-1a：实例未知态 + 戴上熟悉度计数器（CE Items.c:353 charges=ringDelayToAutoID）
        ring.identified = false;
        ring.canBeIdentified = true;
        ring.charges = this.RING_DELAY_TO_AUTO_ID;
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
        // CE makeItemInto：护符无未知态，直接 ITEM_IDENTIFIED
        charm.identified = true;
        return charm;
    }

    public static spawnKey(id: string, x: number, y: number): Item | null {
        const data = this.keys.find((k) => k.id === id);
        if (!data) return null;
        const key = new Item(tn(data.name), 'k', data.color, ItemCategory.KEY);
        key.loc = { x, y };
        key.weight = data.weight;
        key.identified = true; // CE makeItemInto：钥匙无未知态
        return key;
    }

    public static spawnAmulet(id: string, x: number, y: number): Item | null {
        const data = this.amulets.find((a) => a.id === id);
        if (!data) return null;
        const amulet = new Item(tn(data.name), ',', data.color, ItemCategory.AMULET);
        amulet.loc = { x, y };
        amulet.weight = data.weight;
        (amulet as any).identityId = id;
        amulet.identified = true; // CE makeItemInto：护符石/安卡直接 ITEM_IDENTIFIED
        return amulet;
    }
}
