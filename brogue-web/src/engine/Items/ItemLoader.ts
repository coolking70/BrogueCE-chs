/**
 * src/engine/Items/ItemLoader.ts
 * Parses item JSON files and spawns Item instances
 */

import { Item, ItemCategory } from './Item';
import weaponsData from '../../data/weapons.json';
import armorsData from '../../data/armors.json';
import consumablesData from '../../data/consumables.json';
import arcanaData from '../../data/arcana.json';
import { rng } from '../Random';
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
}

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

    // Mappings from true ID to fake name/color
    public static potionFlavorMap = new Map<string, { name: string, color: number }>();
    public static scrollFlavorMap = new Map<string, string>();
    public static arcanaFlavorMap = new Map<string, string>();

    // Which IDs have been identified by the player
    public static identifiedItems = new Set<string>();

    private static potionColors = [
        { name: 'Red Potion', color: 0xff4444 },
        { name: 'Blue Potion', color: 0x4444ff },
        { name: 'Green Potion', color: 0x44ff44 },
        { name: 'Bubbly Potion', color: 0xffffff },
        { name: 'Viscous Potion', color: 0x884400 },
        { name: 'Smoky Potion', color: 0x555555 },
        { name: 'Golden Potion', color: 0xffdd44 },
        { name: 'Purple Potion', color: 0xaa44ff }
    ];

    /** Translate a name string via i18next. */
    public static translateName(name: string): string { return tn(name); }

    private static scrollNames = [
        'Scroll titled "KOU MURA"',
        'Scroll titled "YU GENG"',
        'Scroll titled "FEI LU"',
        'Scroll titled "XIN BAO"',
        'Scroll titled "DAO ZANG"',
        'Scroll titled "GU QIN"',
        'Scroll titled "MING YUE"',
        'Scroll titled "QING FENG"'
    ];

    private static wandFlavorNames = [
        'Copper Wand',
        'Oak Wand',
        'Crystal Wand',
        'Ivory Wand',
        'Carved Wand',
        'Runed Wand'
    ];

    private static staffFlavorNames = [
        'Ashwood Staff',
        'Bronze Staff',
        'Blackwood Staff',
        'Marble Staff',
        'Twisted Staff',
        'Polished Staff'
    ];

    private static ringFlavorNames = [
        'Agate Ring',
        'Copper Ring',
        'Jade Ring',
        'Silver Ring',
        'Iron Ring',
        'Gold Ring'
    ];

    private static charmFlavorNames = [
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

        // Shuffle flavors
        const shuffledPotions = [...this.potionColors];
        rng.shuffleList(shuffledPotions);

        const shuffledScrolls = [...this.scrollNames];
        rng.shuffleList(shuffledScrolls);

        // Assign to potions
        this.potions.forEach((p, index) => {
            if (index < shuffledPotions.length) {
                const orig = shuffledPotions[index]!;
                this.potionFlavorMap.set(p.id, { name: tn(orig.name), color: orig.color });
            }
        });

        // Assign to scrolls
        this.scrolls.forEach((s, index) => {
            if (index < shuffledScrolls.length) {
                this.scrollFlavorMap.set(s.id, tn(shuffledScrolls[index]!));
            }
        });

        const assignArcanaFlavors = (pool: ArcanaConfig[], flavors: string[]) => {
            const shuffled = [...flavors];
            rng.shuffleList(shuffled);
            pool.forEach((entry, index) => {
                if (index < shuffled.length) {
                    this.arcanaFlavorMap.set(entry.id, tn(shuffled[index]!));
                }
            });
        };

        assignArcanaFlavors(this.wands, this.wandFlavorNames);
        assignArcanaFlavors(this.staffs, this.staffFlavorNames);
        assignArcanaFlavors(this.rings, this.ringFlavorNames);
        assignArcanaFlavors(this.charms, this.charmFlavorNames);
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
            const runics = ['paralyzing', 'venom', 'quietus', 'vampirism', 'speed', 'confusion', 'force', 'slaying', 'mercy'];
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
            const runics = ['reflection', 'dampening', 'mutuality', 'respiration', 'vitality', 'absorption', 'reprisal', 'immunity'];
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
