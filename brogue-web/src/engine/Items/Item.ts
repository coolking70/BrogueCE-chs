/**
 * src/engine/Items/Item.ts
 * Represents an item in the game world or in an inventory
 */

import type { Entity, Pos } from '../../types';
import i18next from 'i18next';
import { ItemLoader } from './ItemLoader';
import { allocateEntityId } from '../../entities/Creature';

export enum ItemCategory {
    WEAPON,
    ARMOR,
    POTION,
    SCROLL,
    FOOD,
    GOLD,
    WAND,
    STAFF,
    RING,
    CHARM,
    KEY,
    AMULET
}

/** 未识别魔杖的使用次数后缀（CE Items.c:1615-1634：once/twice/N times）。 */
function usedTimesLabel(times: number): string {
    const enDefault = times === 1 ? ' (used once)' : times === 2 ? ' (used twice)' : ` (used ${times} times)`;
    return i18next.t('item.used_times', { times, defaultValue: enDefault });
}

/**
 * B-1b：called 绰号显示（CE itemName 五个风味分支的 called 中间态——
 * "potion called X"/"scroll called X"…，Items.c:1565-1567/1582-1584/
 * 1601-1603/1641-1643/1667-1669）。t() 必须在语句层：i18n 门禁的扫描器
 * 遇到模板字面量会整体跳过（B-1a 教训，p1_30_i18n_gate）。
 */
function calledLabel(categoryWord: 'potion' | 'scroll' | 'wand' | 'staff' | 'ring', title: string): string {
    switch (categoryWord) {
        case 'potion': return i18next.t('item.called_potion', { title, defaultValue: 'potion called {{title}}' });
        case 'scroll': return i18next.t('item.called_scroll', { title, defaultValue: 'scroll called {{title}}' });
        case 'wand': return i18next.t('item.called_wand', { title, defaultValue: 'wand called {{title}}' });
        case 'staff': return i18next.t('item.called_staff', { title, defaultValue: 'staff called {{title}}' });
        case 'ring': return i18next.t('item.called_ring', { title, defaultValue: 'ring called {{title}}' });
    }
}

export class Item implements Entity {
    public id: number;
    public char: string;
    public color: number;
    public name: string;

    // Position is optional if the item is in an inventory
    public loc: Pos;

    // Identity and optional presentation payloads used by ItemLoader/inspectors.
    public identityId?: string;
    public consumableId?: string;
    public description?: string;
    public category: ItemCategory;
    public weight: number;

    // Stats for weapons/armors
    public damage?: string;
    /** CE damage.clumpFactor; independent of the min/max notation. */
    public clumping?: number;
    public armor?: number;
    public strengthRequired?: number;
    /**
     * P4-7：CE 物品旗标（Rogue.h:1376-1380），生成时按武器种类赋予
     * （Items.c:209-236）：whip=ITEM_ATTACKS_EXTEND、spear/war_pike=
     * ITEM_ATTACKS_PENETRATE、axe=ITEM_ATTACKS_ALL_ADJACENT、
     * mace/war_hammer=ITEM_ATTACKS_STAGGER。当前仅武器几何/钝器口径使用。
     */
    public flags?: string[];
    public isCursed: boolean = false;
    /** CE ITEM_PROTECTED：防酸蚀/防负附魔豁免（护甲/武器保护卷轴打上） */
    public isProtected: boolean = false;
    /** Staff E (CE enchant1); independent of remaining charges. W-5 initializes it. */
    public enchantment: number = 0;
    /** CE timesEnchanted: caps a positive unidentified ring's effective enchant. */
    public timesEnchanted: number = 0;
    public runicType?: string;
    public runicKnown: boolean = false;
    /** W-5 schema marker: absent in legacy saves whose staff E was a placeholder. */
    public arcanaInstanceVersion?: 1 | 2;
    /** Staff capacity (= E after creation/enchanting); wand's initial count, not a use cap. */
    public maxCharges?: number;
    /** Current uses; spending these must not change staff E. */
    public charges?: number;
    /**
     * B-1a 两层未知态模型·层 2（实例旗标，CE Rogue.h:1361-1386）：
     * - `identified` ≙ ITEM_IDENTIFIED：这一件的附魔/充能/符文已知。
     *   undefined 视为已鉴定（裸构造的普通物品——金币/食物/测试资产——无未知态，
     *   对齐 CE makeItemInto 只给五类可未知品类发 ITEM_CAN_BE_IDENTIFIED）；
     *   五个可未知类别（武器/护甲/药水/卷轴/杖/魔杖/戒指）由 ItemLoader.spawn*
     *   显式置 false。
     * - `canBeIdentified` ≙ ITEM_CAN_BE_IDENTIFIED：鉴定卷轴的合法目标。
     * - `maxChargesKnown` ≙ ITEM_MAX_CHARGES_KNOWN：杖/魔杖的充能上限已知。
     * - `runicKnown`（既有字段）≙ ITEM_RUNIC_IDENTIFIED。
     * - 武器/护甲/戒指的 `charges` 复用为熟悉度倒计时（CE Items.c:275/285/353：
     *   杀 20 敌 / 穿 1000 回合 / 戴 1500 回合）。
     * 持久化归 B-1b（P1-48）：这些字段当前不进存档。
     */
    public identified?: boolean;
    public canBeIdentified: boolean = false;
    public maxChargesKnown: boolean = false;
    /**
     * B-1c：≙ CE ITEM_MAGIC_DETECTED（Rogue.h:1372）——这一件被 detect magic
     * 照过。它是**实例**旗标，与种类级的 magicPolarityRevealed 并列：
     * CE 的恶意品使用确认（Items.c:7757/8050）读的正是它，背包 sigil
     * （Items.c:3611）也读它。随 GameSnapshotItem 持久化（B-1b 的字段族）。
     */
    public magicDetected: boolean = false;
    /** 魔杖已放电次数（CE enchant2，Items.c:7435；未识别时显示"已使用 N 次"） */
    public timesUsed?: number;
    /** W-6: CE enchant2 countdown in recharge points; absent means initial 500.
     * Independent of E, capacity and legacy ascending rechargeCounter. */
    public staffRechargeRemaining?: number;
    /** Legacy save/data fields only; W-6 natural charging no longer reads these. */
    public rechargeTurns?: number;
    public rechargeCounter?: number;
    public cooldownTurns?: number;
    public cooldownRemaining?: number;

    /** 堆叠数量，对齐 CE item->quantity；开局飞镖（×15）与投掷物生成（5-18 / 3-6）使用 */
    public quantity: number = 1;
    /** CE inventoryLetter: retained when other entries are removed. */
    public inventoryLetter?: string;
    /**
     * B-4a：≙ CE item->quiverNumber（Items.c:271，投掷物生成时
     * rand_range(1, 60000)）；CE 的快速投掷目标轮换键。web 投掷交互
     * 消费此字段前仅作生成侧留形。
     */
    public quiverNumber?: number;
    /**
     * B-4a：≙ CE item->vorpalEnemy（chooseVorpalEnemy 的类别名，Items.c:7667-7679）。
     * 仅 W_SLAYING 武器与 A_IMMUNITY 护甲在生成时写入。战斗侧类别门
     * （Combat.c:133/402/669）web 未接线（monsterClass 成员名册缺失）——
     * 字段为激活留形，激活轮需接类别成员表并重核 CE。
     */
    public vorpalEnemy?: string;

    /**
     * B-4b：≙ CE item->keyLoc[KEY_ID_MAXIMUM]（Rogue.h:1417/1389；
     * keyLocationProfile = { loc, machine, disposableHere }）的最小绑定：
     * 本钥匙对应哪些锁。CE keyMatchesLocation（Items.c:4040-4043）按 loc 或
     * machine 匹配。
     * V-2b-6：解锁消费端接线（Game.keyInPackFor）——disposableHere 补齐
     * （CE Rogue.h:1391-1395 的第三维；useKeyAt Movement.c:636-656 按它决定
     * 开锁后消不消耗钥匙），originDepth 补齐（CE Items.c:4038 的
     * `originDepth == rogue.depthLevel` 判据：跨层带下去的钥匙不认锁）。
     */
    public keyLoc: Array<{ loc: { x: number; y: number }; machine: number; disposableHere?: boolean }> = [];

    /**
     * V-2b-6：≙ CE item->originDepth（Rogue.h:1422）——钥匙生成时的层号。
     * keyMatchesLocation 的第一判据（Items.c:4038）。undefined = 旧存档/测试
     * 裸造的钥匙，按"当层"处理（登记偏差：CE 恒有值）。
     */
    public originDepth?: number;

    constructor(name: string, char: string, color: number, category: ItemCategory) {
        // id 只需唯一：走单调计数器（与 Creature 共用一个序列），
        // 不消耗玩法随机流（原 rng.randRange(1, 100000000) 每件物品烧掉一次抽取）。
        this.id = allocateEntityId();
        this.name = name;
        this.char = char;
        this.color = color;
        this.category = category;
        this.loc = { x: -1, y: -1 };
        this.weight = 0;
    }

    get x(): number { return this.loc.x; }
    get y(): number { return this.loc.y; }

    /** CE ITEM_IDENTIFIED 的读取口径：undefined（裸构造/旧路径）视为已鉴定。 */
    get isIdentified(): boolean { return this.identified !== false; }

    get displayName(): string {
        // Here we hook into the static registry if the item is a consumables
        switch (this.category) {
            case ItemCategory.POTION: {
                const consumableId = (this as any).consumableId;
                if (!consumableId) return this.name;
                const isIdentified = ItemLoader.identifiedItems.has(consumableId);
                if (isIdentified) return this.name;
                // B-1b：called 分支（CE Items.c:1582-1584）——优先级在 identified
                // 之后、风味之前；种类识别后绰号自动失效（上一分支短路）。
                const potionCall = ItemLoader.callTitles.get(consumableId);
                if (potionCall) return calledLabel('potion', potionCall);
                const flavor = ItemLoader.potionFlavorMap.get(consumableId);
                return flavor ? flavor.name : ItemLoader.translateName('Unknown Potion');
            }
            case ItemCategory.SCROLL: {
                const consumableId = (this as any).consumableId;
                if (!consumableId) return this.name;
                const isIdentified = ItemLoader.identifiedItems.has(consumableId);
                if (isIdentified) return this.name;
                // B-1b：called 分支（CE Items.c:1565-1567）
                const scrollCall = ItemLoader.callTitles.get(consumableId);
                if (scrollCall) return calledLabel('scroll', scrollCall);
                return ItemLoader.scrollFlavorMap.get(consumableId) || ItemLoader.translateName('Unknown Scroll');
            }
            case ItemCategory.WEAPON:
            case ItemCategory.ARMOR: {
                // B-1a 反泄露（CE Items.c:1488-1493）：附魔后缀仅在 ITEM_IDENTIFIED
                // 后显示；诅咒绝不进名字（CE 无此分支——玩家经"摘不下"得知，
                // Items.c:7110/8377）。未知符文提示：实例已鉴定且带符文但符文种类
                // 未知时追加"（未知符文）"（CE Items.c:1518-1523）。
                let outName = this.name;
                if (this.isIdentified) {
                    if (this.enchantment > 0) outName += ` +${this.enchantment}`;
                    else if (this.enchantment < 0) outName += ` ${this.enchantment}`;
                }
                if (this.runicType) {
                    if (this.runicKnown) {
                          const runicName = i18next.t('runic.name.' + this.runicType, { defaultValue: '未知符文' });
                          outName += ` {${runicName}}`;
                    } else if (this.isIdentified) {
                        // 注意：t() 不能写进模板字符串的 ${} 里——i18n 门禁的扫描器
                        // 会整体跳过模板字面量（p1_30_i18n_gate），调用须在语句层。
                        const unknownRunic = i18next.t('item.unknown_runic', { defaultValue: '(unknown runic)' });
                        outName += ` ${unknownRunic}`;
                    }
                }
                return outName;
            }
            case ItemCategory.WAND:
            case ItemCategory.STAFF: {
                // B-1a 反泄露（CE Items.c:1611-1634 / 1650-1653）：充能标注跟在
                // "当前名字"（未识别种类时是风味名）之后，且只在实例层已知
                // （ITEM_IDENTIFIED / ITEM_MAX_CHARGES_KNOWN）时显示；未识别魔杖
                // 显示使用次数（enchant2 计数）而非充能。
                const identityId = (this as any).identityId as string | undefined;
                const kindKnown = !identityId || ItemLoader.identifiedItems.has(identityId);
                const flavor = identityId ? ItemLoader.arcanaFlavorMap.get(identityId) : undefined;
                const usedTimes = this.timesUsed ?? 0;
                // B-1b：called 分支替换名根（CE Items.c:1601-1603/1641-1643）——
                // 充能/使用次数详情仍拼在绰号之后（CE includeDetails 与名根正交）。
                const arcanaCall = (!kindKnown && identityId) ? ItemLoader.callTitles.get(identityId) : undefined;
                const root = kindKnown
                    ? this.name
                    : arcanaCall
                        ? calledLabel(this.category === ItemCategory.WAND ? 'wand' : 'staff', arcanaCall)
                        : (flavor ?? this.name);

                if (this.category === ItemCategory.WAND) {
                    if (this.isIdentified || this.maxChargesKnown) {
                        return `${root} [${this.charges}]`;
                    }
                    if (usedTimes > 0) {
                        return root + usedTimesLabel(usedTimes);
                    }
                    return root;
                }
                // STAFF：实例已鉴定 → [剩余/上限]；仅上限已知 → [?/上限]
                if (this.isIdentified
                    && typeof this.charges === 'number' && typeof this.maxCharges === 'number') {
                    return `${root} [${this.charges}/${this.maxCharges}]`;
                }
                if (this.maxChargesKnown && typeof this.maxCharges === 'number') {
                    return `${root} [?/${this.maxCharges}]`;
                }
                return root;
            }
            case ItemCategory.RING: {
                const identityId = (this as any).identityId as string | undefined;
                if (identityId && !ItemLoader.identifiedItems.has(identityId)) {
                    // B-1b：called 分支（CE Items.c:1667-1669）
                    const ringCall = ItemLoader.callTitles.get(identityId);
                    if (ringCall) return calledLabel('ring', ringCall);
                    const flavor = ItemLoader.arcanaFlavorMap.get(identityId);
                    if (flavor) return flavor;
                }
                return this.name;
            }
            case ItemCategory.CHARM: {
                const identityId = (this as any).identityId as string | undefined;
                if (identityId && !ItemLoader.identifiedItems.has(identityId)) {
                    const flavor = ItemLoader.arcanaFlavorMap.get(identityId);
                    if (flavor) return flavor;
                }
                return this.name;
            }
            default:
                return this.name;
        }
    }
}
