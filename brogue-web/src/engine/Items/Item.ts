/**
 * src/engine/Items/Item.ts
 * Represents an item in the game world or in an inventory
 */

import type { Entity, Pos } from '../../types';
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

export class Item implements Entity {
    public id: number;
    public char: string;
    public color: number;
    public name: string;

    // Position is optional if the item is in an inventory
    public loc: Pos;

    public category: ItemCategory;
    public weight: number;

    // Stats for weapons/armors
    public damage?: string;
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
    public enchantment: number = 0;
    public runicType?: string;
    public runicKnown: boolean = false;
    public maxCharges?: number;
    public charges?: number;
    public rechargeTurns?: number;
    public rechargeCounter?: number;
    public cooldownTurns?: number;
    public cooldownRemaining?: number;

    /** 堆叠数量，对齐 CE item->quantity；当前仅开局飞镖（×15）使用 */
    public quantity: number = 1;

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

    get displayName(): string {
        // Here we hook into the static registry if the item is a consumables
        switch (this.category) {
            case ItemCategory.POTION: {
                const consumableId = (this as any).consumableId;
                if (!consumableId) return this.name;
                const isIdentified = ItemLoader.identifiedItems.has(consumableId);
                if (isIdentified) return this.name;
                const flavor = ItemLoader.potionFlavorMap.get(consumableId);
                return flavor ? flavor.name : ItemLoader.translateName('Unknown Potion');
            }
            case ItemCategory.SCROLL: {
                const consumableId = (this as any).consumableId;
                if (!consumableId) return this.name;
                const isIdentified = ItemLoader.identifiedItems.has(consumableId);
                if (isIdentified) return this.name;
                return ItemLoader.scrollFlavorMap.get(consumableId) || ItemLoader.translateName('Unknown Scroll');
            }
            case ItemCategory.WEAPON:
            case ItemCategory.ARMOR: {
                let suffix = '';
                if (this.enchantment > 0) suffix = ` +${this.enchantment}`;
                else if (this.enchantment < 0) suffix = ` ${this.enchantment}`;

                let outName = `${this.name}${suffix}`;
                if (this.isCursed) outName = `${ItemLoader.translateName('Cursed')} ${outName}`;
                if (this.runicKnown && this.runicType) {
                    outName = `${outName} {${this.runicType}}`;
                }
                return outName;
            }
            case ItemCategory.WAND:
            case ItemCategory.STAFF:
            case ItemCategory.RING:
            case ItemCategory.CHARM: {
                const identityId = (this as any).identityId as string | undefined;
                if (identityId && !ItemLoader.identifiedItems.has(identityId)) {
                    const flavor = ItemLoader.arcanaFlavorMap.get(identityId);
                    if (flavor) return flavor;
                }
            }
        }

        switch (this.category) {
            case ItemCategory.WAND:
            case ItemCategory.STAFF: {
                if (typeof this.charges === 'number' && typeof this.maxCharges === 'number') {
                    return `${this.name} [${this.charges}/${this.maxCharges}]`;
                }
                return this.name;
            }
            default:
                return this.name;
        }
    }
}
