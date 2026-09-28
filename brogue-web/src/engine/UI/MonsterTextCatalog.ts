/** X4-R5: CE Globals.c monsterText / Rogue.h monsterWords.
 * Only absorbingStatus and summonMessage live here. Existing absorbingVerb
 * mappings remain owned by MonsterAbsorption and must not be replaced by these.
 */
import zhContent from '../../locales/zh_CN.content.json';

export interface MonsterText {
    readonly absorbStatus: string;
    /** CE's phrase follows the monster name; empty means no species message. */
    readonly summonMessage: string;
}

export type MonsterTextId = keyof typeof zhContent.monster;
export const MONSTER_TEXT_CATALOG: Readonly<Record<MonsterTextId, MonsterText>> = zhContent.monster;

/** All 67 non-player species, including web aliases and CE's CHIEFTAN spelling.
 * Normalize Warden_of_Yendor to lowercase at the lookup boundary.
 */
export const MONSTER_CE_TEXT_IDS = {
    rat: 'MK_RAT',
    kobold: 'MK_KOBOLD',
    jackal: 'MK_JACKAL',
    eel: 'MK_EEL',
    monkey: 'MK_MONKEY',
    bloat: 'MK_BLOAT',
    pit_bloat: 'MK_PIT_BLOAT',
    goblin: 'MK_GOBLIN',
    goblin_conjurer: 'MK_GOBLIN_CONJURER',
    goblin_mystic: 'MK_GOBLIN_MYSTIC',
    goblin_totem: 'MK_GOBLIN_TOTEM',
    pink_jelly: 'MK_PINK_JELLY',
    toad: 'MK_TOAD',
    vampire_bat: 'MK_VAMPIRE_BAT',
    arrow_turret: 'MK_ARROW_TURRET',
    acid_mound: 'MK_ACID_MOUND',
    centipede: 'MK_CENTIPEDE',
    ogre: 'MK_OGRE',
    bog_monster: 'MK_BOG_MONSTER',
    ogre_totem: 'MK_OGRE_TOTEM',
    spider: 'MK_SPIDER',
    spark_turret: 'MK_SPARK_TURRET',
    wisp: 'MK_WILL_O_THE_WISP',
    wraith: 'MK_WRAITH',
    zombie: 'MK_ZOMBIE',
    troll: 'MK_TROLL',
    ogre_shaman: 'MK_OGRE_SHAMAN',
    naga: 'MK_NAGA',
    salamander: 'MK_SALAMANDER',
    explosive_bloat: 'MK_EXPLOSIVE_BLOAT',
    dar_blademaster: 'MK_DAR_BLADEMASTER',
    dar_priestess: 'MK_DAR_PRIESTESS',
    dar_battlemage: 'MK_DAR_BATTLEMAGE',
    acidic_jelly: 'MK_ACID_JELLY',
    centaur: 'MK_CENTAUR',
    underworm: 'MK_UNDERWORM',
    sentinel: 'MK_SENTINEL',
    dart_turret: 'MK_DART_TURRET',
    kraken: 'MK_KRAKEN',
    lich: 'MK_LICH',
    phylactery: 'MK_PHYLACTERY',
    pixie: 'MK_PIXIE',
    phantom: 'MK_PHANTOM',
    flame_turret: 'MK_FLAME_TURRET',
    imp: 'MK_IMP',
    fury: 'MK_FURY',
    revenant: 'MK_REVENANT',
    tentacle_horror: 'MK_TENTACLE_HORROR',
    golem: 'MK_GOLEM',
    dragon: 'MK_DRAGON',
    goblin_warlord: 'MK_GOBLIN_CHIEFTAN',
    black_jelly: 'MK_BLACK_JELLY',
    vampire: 'MK_VAMPIRE',
    flamedancer: 'MK_FLAMEDANCER',
    spectral_blade: 'MK_SPECTRAL_BLADE',
    spectral_sword: 'MK_SPECTRAL_IMAGE',
    stone_guardian: 'MK_GUARDIAN',
    winged_guardian: 'MK_WINGED_GUARDIAN',
    guardian_spirit: 'MK_CHARM_GUARDIAN',
    warden_of_yendor: 'MK_WARDEN_OF_YENDOR',
    eldritch_totem: 'MK_ELDRITCH_TOTEM',
    mirrored_totem: 'MK_MIRRORED_TOTEM',
    unicorn: 'MK_UNICORN',
    ifrit: 'MK_IFRIT',
    phoenix: 'MK_PHOENIX',
    phoenix_egg: 'MK_PHOENIX_EGG',
    mangrove_dryad: 'MK_ANCIENT_SPIRIT',
} as const satisfies Record<MonsterTextId, string>;

export function getMonsterText(typeId: string, locale = zhContent): MonsterText | null {
    const id = typeId.toLowerCase();
    return Object.prototype.hasOwnProperty.call(locale.monster, id)
        ? locale.monster[id as MonsterTextId] : null;
}

/** Unknown species return empty text, never a fabricated CE state. */
export function getMonsterAbsorbStatus(typeId: string, locale = zhContent): string {
    return getMonsterText(typeId, locale)?.absorbStatus ?? '';
}

export function getMonsterSummonMessage(typeId: string, locale = zhContent): string {
    return getMonsterText(typeId, locale)?.summonMessage ?? '';
}

/** Pass the already localized/perceived name (including hallucination policy).
 * This formatter does not decide visibility, success, or whether to log.
 */
export function formatMonsterSummonMessage(typeId: string, perceivedName: string, locale = zhContent): string {
    const message = getMonsterSummonMessage(typeId, locale);
    return message ? perceivedName + message : '';
}
