/** W-1: CE identity/configuration data only; no routing, RNG, formulas or DF execution.
 * Source: Rogue.h:905-936,1824-1875; GlobalsBrogue.c:58-90.
 * Keep the CE catalog separate from the web execution table in Bolt.ts.
 */

export enum CEBoltType {
    NONE = 0,
    TELEPORT = 1,
    SLOW = 2,
    POLYMORPH = 3,
    NEGATION = 4,
    DOMINATION = 5,
    BECKONING = 6,
    PLENTY = 7,
    INVISIBILITY = 8,
    EMPOWERMENT = 9,
    LIGHTNING = 10,
    FIRE = 11,
    POISON = 12,
    TUNNELING = 13,
    BLINKING = 14,
    ENTRANCEMENT = 15,
    OBSTRUCTION = 16,
    DISCORD = 17,
    CONJURATION = 18,
    HEALING = 19,
    HASTE = 20,
    SLOW_2 = 21,
    SHIELDING = 22,
    SPIDERWEB = 23,
    SPARK = 24,
    DRAGONFIRE = 25,
    DISTANCE_ATTACK = 26,
    POISON_DART = 27,
    ANCIENT_SPIRIT_VINES = 28,
    WHIP = 29,
}

export enum CEBoltEffect {
    NONE = 0,
    ATTACK = 1,
    TELEPORT = 2,
    SLOW = 3,
    POLYMORPH = 4,
    NEGATION = 5,
    DOMINATION = 6,
    BECKONING = 7,
    PLENTY = 8,
    INVISIBILITY = 9,
    EMPOWERMENT = 10,
    DAMAGE = 11,
    POISON = 12,
    TUNNELING = 13,
    BLINKING = 14,
    ENTRANCEMENT = 15,
    OBSTRUCTION = 16,
    DISCORD = 17,
    CONJURATION = 18,
    HEALING = 19,
    HASTE = 20,
    SHIELDING = 21,
}

/** Rogue.h:1849-1860: bit 5 is intentionally unused. */
export enum CEBoltFlags {
    PASSES_THRU_CREATURES = 1 << 0,
    HALTS_BEFORE_OBSTRUCTION = 1 << 1,
    TARGET_ALLIES = 1 << 2,
    TARGET_ENEMIES = 1 << 3,
    FIERY = 1 << 4,
    NEVER_REFLECTS = 1 << 6,
    NOT_LEARNABLE = 1 << 7,
    NOT_NEGATABLE = 1 << 8,
    ELECTRIC = 1 << 9,
    DISPLAY_CHAR_ALONG_LENGTH = 1 << 10,
}

export interface CEBoltDefinition {
    readonly type: CEBoltType;
    readonly name: string;
    readonly description: string;
    readonly abilityDescription: string;
    /** Literal glyph or CE glyph token; null is the CE zero glyph. */
    readonly theChar: string | null;
    /** CE color symbols, not web RGB values. */
    readonly foreColor: string | null;
    readonly backColor: string | null;
    readonly effect: CEBoltEffect;
    readonly magnitude: number;
    /** Symbolic references only; zero stays null, including obstruction. */
    readonly pathDF: string | null;
    readonly targetDF: string | null;
    /** Auto-target eligibility metadata, NOT universal on-hit immunity. */
    readonly forbiddenMonsterFlags: readonly string[];
    readonly flags: number;
}

const T = CEBoltType, E = CEBoltEffect, F = CEBoltFlags;

export const CE_BOLT_CATALOG: Readonly<Record<CEBoltType, CEBoltDefinition>> = {
    // GlobalsBrogue.c:59: {{0}} sentinel.
    [T.NONE]: { type: T.NONE, name: '', description: '', abilityDescription: '',
        theChar: null, foreColor: null, backColor: null, effect: E.NONE, magnitude: 0,
        pathDF: null, targetDF: null, forbiddenMonsterFlags: [], flags: 0 },
    // GlobalsBrogue.c:61
    [T.TELEPORT]: { type: T.TELEPORT, name: "teleportation spell", description: "casts a teleport spell", abilityDescription: "can teleport other creatures",
        theChar: null, foreColor: null, backColor: "blue", effect: E.TELEPORT, magnitude: 10,
        pathDF: null, targetDF: null, forbiddenMonsterFlags: ["MONST_IMMOBILE"], flags: F.TARGET_ENEMIES },
    // GlobalsBrogue.c:62
    [T.SLOW]: { type: T.SLOW, name: "slowing spell", description: "casts a slowing spell", abilityDescription: "can slow $HISHER enemies",
        theChar: null, foreColor: null, backColor: "green", effect: E.SLOW, magnitude: 10,
        pathDF: null, targetDF: null, forbiddenMonsterFlags: ["MONST_INANIMATE"], flags: F.TARGET_ENEMIES },
    // GlobalsBrogue.c:63
    [T.POLYMORPH]: { type: T.POLYMORPH, name: "polymorph spell", description: "casts a polymorphism spell", abilityDescription: "can polymorph other creatures",
        theChar: null, foreColor: null, backColor: "purple", effect: E.POLYMORPH, magnitude: 10,
        pathDF: null, targetDF: null, forbiddenMonsterFlags: ["MONST_INANIMATE"], flags: F.TARGET_ENEMIES },
    // GlobalsBrogue.c:64
    [T.NEGATION]: { type: T.NEGATION, name: "negation magic", description: "casts a negation spell", abilityDescription: "can cast negation",
        theChar: null, foreColor: null, backColor: "pink", effect: E.NEGATION, magnitude: 10,
        pathDF: null, targetDF: null, forbiddenMonsterFlags: [], flags: F.TARGET_ENEMIES },
    // GlobalsBrogue.c:65
    [T.DOMINATION]: { type: T.DOMINATION, name: "domination spell", description: "casts a domination spell", abilityDescription: "can dominate other creatures",
        theChar: null, foreColor: null, backColor: "dominationColor_Brogue", effect: E.DOMINATION, magnitude: 10,
        pathDF: null, targetDF: null, forbiddenMonsterFlags: ["MONST_INANIMATE"], flags: F.TARGET_ENEMIES },
    // GlobalsBrogue.c:66
    [T.BECKONING]: { type: T.BECKONING, name: "beckoning spell", description: "casts a beckoning spell", abilityDescription: "can cast beckoning",
        theChar: null, foreColor: null, backColor: "beckonColor_Brogue", effect: E.BECKONING, magnitude: 10,
        pathDF: null, targetDF: null, forbiddenMonsterFlags: ["MONST_IMMOBILE"], flags: F.TARGET_ENEMIES },
    // GlobalsBrogue.c:67
    [T.PLENTY]: { type: T.PLENTY, name: "spell of plenty", description: "casts a spell of plenty", abilityDescription: "can duplicate other creatures",
        theChar: null, foreColor: null, backColor: "rainbow", effect: E.PLENTY, magnitude: 10,
        pathDF: null, targetDF: null, forbiddenMonsterFlags: ["MONST_INANIMATE"], flags: F.TARGET_ALLIES | F.NOT_LEARNABLE },
    // GlobalsBrogue.c:68
    [T.INVISIBILITY]: { type: T.INVISIBILITY, name: "invisibility magic", description: "casts invisibility magic", abilityDescription: "can turn creatures invisible",
        theChar: null, foreColor: null, backColor: "darkBlue", effect: E.INVISIBILITY, magnitude: 10,
        pathDF: null, targetDF: null, forbiddenMonsterFlags: ["MONST_INANIMATE"], flags: F.TARGET_ALLIES },
    // GlobalsBrogue.c:69
    [T.EMPOWERMENT]: { type: T.EMPOWERMENT, name: "empowerment sorcery", description: "casts empowerment", abilityDescription: "can cast empowerment",
        theChar: null, foreColor: null, backColor: "empowermentColor_Brogue", effect: E.EMPOWERMENT, magnitude: 10,
        pathDF: null, targetDF: null, forbiddenMonsterFlags: ["MONST_INANIMATE"], flags: F.TARGET_ALLIES | F.NOT_LEARNABLE },
    // GlobalsBrogue.c:70
    [T.LIGHTNING]: { type: T.LIGHTNING, name: "lightning", description: "casts lightning", abilityDescription: "can hurl lightning bolts",
        theChar: null, foreColor: null, backColor: "lightningColor_Brogue", effect: E.DAMAGE, magnitude: 10,
        pathDF: null, targetDF: null, forbiddenMonsterFlags: [], flags: F.PASSES_THRU_CREATURES | F.TARGET_ENEMIES | F.ELECTRIC },
    // GlobalsBrogue.c:71
    [T.FIRE]: { type: T.FIRE, name: "flame", description: "casts a gout of flame", abilityDescription: "can hurl gouts of flame",
        theChar: null, foreColor: null, backColor: "fireBoltColor_Brogue", effect: E.DAMAGE, magnitude: 4,
        pathDF: null, targetDF: null, forbiddenMonsterFlags: ["MONST_IMMUNE_TO_FIRE"], flags: F.TARGET_ENEMIES | F.FIERY },
    // GlobalsBrogue.c:72
    [T.POISON]: { type: T.POISON, name: "poison ray", description: "casts a poison ray", abilityDescription: "can cast poisonous bolts",
        theChar: null, foreColor: null, backColor: "poisonColor_Brogue", effect: E.POISON, magnitude: 10,
        pathDF: null, targetDF: null, forbiddenMonsterFlags: ["MONST_INANIMATE"], flags: F.TARGET_ENEMIES },
    // GlobalsBrogue.c:73
    [T.TUNNELING]: { type: T.TUNNELING, name: "tunneling magic", description: "casts tunneling", abilityDescription: "can tunnel",
        theChar: null, foreColor: null, backColor: "brown", effect: E.TUNNELING, magnitude: 10,
        pathDF: null, targetDF: null, forbiddenMonsterFlags: [], flags: F.PASSES_THRU_CREATURES },
    // GlobalsBrogue.c:74
    [T.BLINKING]: { type: T.BLINKING, name: "blink trajectory", description: "blinks", abilityDescription: "can blink",
        theChar: null, foreColor: null, backColor: "white", effect: E.BLINKING, magnitude: 5,
        pathDF: null, targetDF: null, forbiddenMonsterFlags: [], flags: F.HALTS_BEFORE_OBSTRUCTION },
    // GlobalsBrogue.c:75
    [T.ENTRANCEMENT]: { type: T.ENTRANCEMENT, name: "entrancement ray", description: "casts entrancement", abilityDescription: "can cast entrancement",
        theChar: null, foreColor: null, backColor: "yellow", effect: E.ENTRANCEMENT, magnitude: 10,
        pathDF: null, targetDF: null, forbiddenMonsterFlags: ["MONST_INANIMATE"], flags: F.TARGET_ENEMIES },
    // GlobalsBrogue.c:76
    [T.OBSTRUCTION]: { type: T.OBSTRUCTION, name: "obstruction magic", description: "casts obstruction", abilityDescription: "can cast obstruction",
        theChar: null, foreColor: null, backColor: "forceFieldColor_Brogue", effect: E.OBSTRUCTION, magnitude: 10,
        pathDF: null, targetDF: null, forbiddenMonsterFlags: [], flags: F.HALTS_BEFORE_OBSTRUCTION },
    // GlobalsBrogue.c:77
    [T.DISCORD]: { type: T.DISCORD, name: "spell of discord", description: "casts a spell of discord", abilityDescription: "can cast discord",
        theChar: null, foreColor: null, backColor: "discordColor", effect: E.DISCORD, magnitude: 10,
        pathDF: null, targetDF: null, forbiddenMonsterFlags: ["MONST_INANIMATE"], flags: F.TARGET_ENEMIES },
    // GlobalsBrogue.c:78
    [T.CONJURATION]: { type: T.CONJURATION, name: "conjuration magic", description: "casts a conjuration bolt", abilityDescription: "can cast conjuration",
        theChar: null, foreColor: null, backColor: "spectralBladeColor_Brogue", effect: E.CONJURATION, magnitude: 10,
        pathDF: null, targetDF: null, forbiddenMonsterFlags: ["MONST_IMMUNE_TO_WEAPONS"], flags: F.HALTS_BEFORE_OBSTRUCTION | F.TARGET_ENEMIES },
    // GlobalsBrogue.c:79
    [T.HEALING]: { type: T.HEALING, name: "healing magic", description: "casts healing", abilityDescription: "can heal $HISHER allies",
        theChar: null, foreColor: null, backColor: "darkRed", effect: E.HEALING, magnitude: 5,
        pathDF: null, targetDF: null, forbiddenMonsterFlags: [], flags: F.TARGET_ALLIES },
    // GlobalsBrogue.c:80
    [T.HASTE]: { type: T.HASTE, name: "haste spell", description: "casts a haste spell", abilityDescription: "can haste $HISHER allies",
        theChar: null, foreColor: null, backColor: "orange", effect: E.HASTE, magnitude: 2,
        pathDF: null, targetDF: null, forbiddenMonsterFlags: ["MONST_INANIMATE"], flags: F.TARGET_ALLIES },
    // GlobalsBrogue.c:81
    [T.SLOW_2]: { type: T.SLOW_2, name: "slowing spell", description: "casts a slowing spell", abilityDescription: "can slow $HISHER enemies",
        theChar: null, foreColor: null, backColor: "green", effect: E.SLOW, magnitude: 2,
        pathDF: null, targetDF: null, forbiddenMonsterFlags: ["MONST_INANIMATE"], flags: F.TARGET_ENEMIES },
    // GlobalsBrogue.c:82
    [T.SHIELDING]: { type: T.SHIELDING, name: "protection magic", description: "casts protection", abilityDescription: "can cast protection",
        theChar: null, foreColor: null, backColor: "shieldingColor_Brogue", effect: E.SHIELDING, magnitude: 5,
        pathDF: null, targetDF: null, forbiddenMonsterFlags: ["MONST_INANIMATE"], flags: F.TARGET_ALLIES },
    // GlobalsBrogue.c:83
    [T.SPIDERWEB]: { type: T.SPIDERWEB, name: "spiderweb", description: "launches a sticky web", abilityDescription: "can launch sticky webs",
        theChar: "*", foreColor: "white", backColor: null, effect: E.NONE, magnitude: 10,
        pathDF: "DF_WEB_SMALL", targetDF: "DF_WEB_LARGE", forbiddenMonsterFlags: ["MONST_IMMOBILE", "MONST_IMMUNE_TO_WEBS"], flags: F.TARGET_ENEMIES | F.NEVER_REFLECTS | F.NOT_LEARNABLE },
    // GlobalsBrogue.c:84
    [T.SPARK]: { type: T.SPARK, name: "spark", description: "shoots a spark", abilityDescription: "can throw sparks of lightning",
        theChar: null, foreColor: null, backColor: "lightningColor_Brogue", effect: E.DAMAGE, magnitude: 1,
        pathDF: null, targetDF: null, forbiddenMonsterFlags: [], flags: F.PASSES_THRU_CREATURES | F.TARGET_ENEMIES | F.ELECTRIC },
    // GlobalsBrogue.c:85
    [T.DRAGONFIRE]: { type: T.DRAGONFIRE, name: "dragonfire", description: "breathes a gout of white-hot flame", abilityDescription: "can breathe gouts of white-hot flame",
        theChar: null, foreColor: null, backColor: "dragonFireColor_Brogue", effect: E.DAMAGE, magnitude: 18,
        pathDF: "DF_OBSIDIAN", targetDF: null, forbiddenMonsterFlags: ["MONST_IMMUNE_TO_FIRE"], flags: F.TARGET_ENEMIES | F.FIERY | F.NOT_LEARNABLE },
    // GlobalsBrogue.c:86
    [T.DISTANCE_ATTACK]: { type: T.DISTANCE_ATTACK, name: "arrow", description: "shoots an arrow", abilityDescription: "attacks from a distance",
        theChar: "G_WEAPON", foreColor: "gray", backColor: null, effect: E.ATTACK, magnitude: 1,
        pathDF: null, targetDF: null, forbiddenMonsterFlags: ["MONST_IMMUNE_TO_WEAPONS"], flags: F.TARGET_ENEMIES | F.NEVER_REFLECTS | F.NOT_LEARNABLE },
    // GlobalsBrogue.c:87
    [T.POISON_DART]: { type: T.POISON_DART, name: "poisoned dart", description: "fires a dart", abilityDescription: "fires strength-sapping darts",
        theChar: "G_WEAPON", foreColor: "centipedeColor_Brogue", backColor: null, effect: E.ATTACK, magnitude: 1,
        pathDF: null, targetDF: null, forbiddenMonsterFlags: [], flags: F.TARGET_ENEMIES | F.NEVER_REFLECTS | F.NOT_LEARNABLE },
    // GlobalsBrogue.c:88
    [T.ANCIENT_SPIRIT_VINES]: { type: T.ANCIENT_SPIRIT_VINES, name: "growing vines", description: "releases carnivorous vines into the ground", abilityDescription: "conjures carnivorous vines",
        theChar: "G_GRASS", foreColor: "tanColor", backColor: null, effect: E.NONE, magnitude: 5,
        pathDF: "DF_ANCIENT_SPIRIT_GRASS", targetDF: "DF_ANCIENT_SPIRIT_VINES", forbiddenMonsterFlags: ["MONST_INANIMATE", "MONST_IMMUNE_TO_WEBS"], flags: F.TARGET_ENEMIES | F.NEVER_REFLECTS },
    // GlobalsBrogue.c:89
    [T.WHIP]: { type: T.WHIP, name: "whip", description: "whips", abilityDescription: "wields a whip",
        theChar: "*", foreColor: "tanColor", backColor: null, effect: E.ATTACK, magnitude: 1,
        pathDF: null, targetDF: null, forbiddenMonsterFlags: ["MONST_IMMUNE_TO_WEAPONS"], flags: F.TARGET_ENEMIES | F.NEVER_REFLECTS | F.NOT_LEARNABLE | F.DISPLAY_CHAR_ALONG_LENGTH },
};

/** Identity aliases from Globals.c:1642-1653 / GlobalsBrogue.c:702-710.
 * This is NOT an item/config/generation registry. Missing items stay unavailable.
 * The three web inventions intentionally have no CE item identity here.
 */
export const CE_ITEM_BOLT_TYPES: Readonly<Record<string, CEBoltType>> = {
    wand_of_teleportation: T.TELEPORT,
    wand_of_slowness: T.SLOW,
    wand_of_polymorphism: T.POLYMORPH,
    wand_of_negation: T.NEGATION,
    wand_of_domination: T.DOMINATION,
    wand_of_beckoning: T.BECKONING,
    wand_of_plenty: T.PLENTY,
    wand_of_invisibility: T.INVISIBILITY,
    wand_of_empowerment: T.EMPOWERMENT,
    staff_of_lightning: T.LIGHTNING,
    staff_of_fire: T.FIRE,
    staff_of_poison: T.POISON,
    staff_of_tunneling: T.TUNNELING,
    staff_of_blinking: T.BLINKING,
    staff_of_entrancement: T.ENTRANCEMENT,
    staff_of_obstruction: T.OBSTRUCTION,
    staff_of_discord: T.DISCORD,
    staff_of_conjuration: T.CONJURATION,
    staff_of_healing: T.HEALING,
    staff_of_haste: T.HASTE,
    staff_of_protection: T.SHIELDING,
};

/** Meaning of CE magnitude at the effect consumer, not an evaluated effect value.
 * "unused-by-effect" can still affect the CE animation (Items.c:5594).
 */
export const CE_MAGNITUDE_USE = {
    [E.NONE]: 'unused-by-effect',
    [E.ATTACK]: 'unused-by-effect', // Items.c:5136-5144: attack(caster, hit), not staffDamage.
    [E.TELEPORT]: 'unused-by-effect',
    [E.SLOW]: 'slow-duration', // Items.c:5243: magnitude * 5 turns.
    [E.POLYMORPH]: 'unused-by-effect',
    [E.NEGATION]: 'unused-by-effect',
    [E.DOMINATION]: 'unused-by-effect',
    [E.BECKONING]: 'unused-by-effect', // Items.c:5076-5089 derives a second blink from distance.
    [E.PLENTY]: 'unused-by-effect',
    [E.INVISIBILITY]: 'invisibility-duration', // Items.c:5270: magnitude * 15 turns.
    [E.EMPOWERMENT]: 'unused-by-effect',
    [E.DAMAGE]: 'staff-damage', // PowerTables.c:49-51: enchantment input, not HP damage.
    [E.POISON]: 'poison-duration', // PowerTables.c:60-69; concentration is separate.
    [E.TUNNELING]: 'tunneling-budget', // Items.c:5813: successful obstruction openings.
    [E.BLINKING]: 'blink-distance', // PowerTables.c:52: enchantment input, not caster-as-aim.
    [E.ENTRANCEMENT]: 'entrancement-duration', // PowerTables.c:56.
    [E.OBSTRUCTION]: 'forcefield-decay', // Items.c:5479-5489, NOT a fixed targetDF.
    [E.DISCORD]: 'discord-duration', // PowerTables.c:55.
    [E.CONJURATION]: 'blade-count', // PowerTables.c:54.
    [E.HEALING]: 'healing-percent', // Items.c:5367: magnitude * 10 percent of max HP.
    [E.HASTE]: 'haste-duration', // PowerTables.c:53.
    [E.SHIELDING]: 'shielding-tenths-hp', // PowerTables.c:57-59; Combat.c:1811-1818.
} as const satisfies Record<CEBoltEffect, string>;

export type CEBoltMagnitudeSource =
    | { readonly kind: 'staff'; readonly enchantment: number }
    | { readonly kind: 'wand' | 'monster' | 'catalog' };

export interface CEBoltMagnitude {
    readonly source: CEBoltMagnitudeSource['kind'];
    readonly value: number;
    readonly use: (typeof CE_MAGNITUDE_USE)[CEBoltEffect];
}

/** Items.c:7353-7355: STAFF replaces catalog magnitude with instance enchant1;
 * WAND and monster bolts keep the catalog value. No charges, RNG, defaults,
 * formula evaluation or writes. Legacy item enchantment=0 is NOT migrated here.
 */
export function resolveCEBoltMagnitude(type: CEBoltType, source: CEBoltMagnitudeSource): CEBoltMagnitude {
    const definition = CE_BOLT_CATALOG[type];
    return {
        source: source.kind,
        value: source.kind === 'staff' ? source.enchantment : definition.magnitude,
        use: CE_MAGNITUDE_USE[definition.effect],
    };
}
