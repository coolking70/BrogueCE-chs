/** CE Globals.c:1167-1393 monsterText[].attack, in damage-percentile order.
 * MK_GOBLIN_CHIEFTAN / ACID_JELLY / WILL_O_THE_WISP use existing web aliases. */
export const ATTACK_VERBS: Readonly<Record<string, readonly string[]>> = {
    "player": [
        "hit"
    ],
    "rat": [
        "scratches",
        "bites"
    ],
    "kobold": [
        "clubs",
        "bashes"
    ],
    "jackal": [
        "claws",
        "bites",
        "mauls"
    ],
    "eel": [
        "shocks",
        "bites"
    ],
    "monkey": [
        "tweaks",
        "bites",
        "punches"
    ],
    "bloat": [
        "bumps"
    ],
    "pit_bloat": [
        "bumps"
    ],
    "goblin": [
        "cuts",
        "stabs",
        "skewers"
    ],
    "goblin_conjurer": [
        "thumps",
        "whacks",
        "wallops"
    ],
    "goblin_mystic": [
        "slaps",
        "punches",
        "kicks"
    ],
    "goblin_totem": [
        "hits"
    ],
    "pink_jelly": [
        "smears",
        "slimes",
        "drenches"
    ],
    "toad": [
        "slimes",
        "slams"
    ],
    "vampire_bat": [
        "nips",
        "bites"
    ],
    "arrow_turret": [
        "shoots"
    ],
    "acid_mound": [
        "slimes",
        "douses",
        "drenches"
    ],
    "centipede": [
        "pricks",
        "stings"
    ],
    "ogre": [
        "cudgels",
        "clubs",
        "batters"
    ],
    "bog_monster": [
        "squeezes",
        "strangles",
        "crushes"
    ],
    "ogre_totem": [
        "hits"
    ],
    "spider": [
        "bites",
        "stings"
    ],
    "spark_turret": [
        "shocks"
    ],
    "wisp": [
        "scorches",
        "burns"
    ],
    "wraith": [
        "clutches",
        "claws",
        "bites"
    ],
    "zombie": [
        "hits",
        "bites"
    ],
    "troll": [
        "cudgels",
        "clubs",
        "bludgeons",
        "pummels",
        "batters"
    ],
    "ogre_shaman": [
        "cudgels",
        "clubs"
    ],
    "naga": [
        "claws",
        "bites",
        "tail-whips"
    ],
    "salamander": [
        "whips",
        "lashes"
    ],
    "explosive_bloat": [
        "bumps"
    ],
    "dar_blademaster": [
        "grazes",
        "cuts",
        "slices",
        "slashes",
        "stabs"
    ],
    "dar_priestess": [
        "cuts",
        "slices"
    ],
    "dar_battlemage": [
        "cuts"
    ],
    "acidic_jelly": [
        "burns"
    ],
    "centaur": [
        "shoots"
    ],
    "underworm": [
        "slams",
        "bites",
        "tail-whips"
    ],
    "sentinel": [
        "hits"
    ],
    "dart_turret": [
        "pricks"
    ],
    "kraken": [
        "slaps",
        "smites",
        "batters"
    ],
    "lich": [
        "touches"
    ],
    "phylactery": [
        "touches"
    ],
    "pixie": [
        "pokes"
    ],
    "phantom": [
        "hits"
    ],
    "flame_turret": [
        "pricks"
    ],
    "imp": [
        "slices",
        "cuts"
    ],
    "fury": [
        "drubs",
        "fustigates",
        "castigates"
    ],
    "revenant": [
        "hits"
    ],
    "tentacle_horror": [
        "slaps",
        "batters",
        "crushes"
    ],
    "golem": [
        "backhands",
        "punches",
        "kicks"
    ],
    "dragon": [
        "claws",
        "tail-whips",
        "bites"
    ],
    "goblin_warlord": [
        "slashes",
        "cuts",
        "stabs",
        "skewers"
    ],
    "black_jelly": [
        "smears",
        "slimes",
        "drenches"
    ],
    "vampire": [
        "grazes",
        "bites",
        "buries $HISHER fangs in"
    ],
    "flamedancer": [
        "singes",
        "burns",
        "immolates"
    ],
    "spectral_blade": [
        "nicks"
    ],
    "spectral_image": [
        "hits"
    ],
    "guardian": [
        "strikes"
    ],
    "winged_guardian": [
        "strikes"
    ],
    "charm_guardian": [
        "strikes"
    ],
    "warden_of_yendor": [
        "strikes"
    ],
    "eldritch_totem": [
        "strikes"
    ],
    "mirrored_totem": [
        "strikes"
    ],
    "unicorn": [
        "pokes",
        "stabs",
        "gores"
    ],
    "ifrit": [
        "cuts",
        "slashes",
        "lacerates"
    ],
    "phoenix": [
        "pecks",
        "scratches",
        "claws"
    ],
    "phoenix_egg": [
        "touches"
    ],
    "ancient_spirit": [
        "whips",
        "lashes",
        "thrashes",
        "lacerates"
    ]
};

/** CE Combat.c:868-896; integer division and clamp, zero RNG. */
export function attackVerb(typeId: string, percentile: number, unarmed = false, anonymous = false): string {
    if (typeId === 'player' && unarmed) return 'punch';
    if (anonymous) return 'hits';
    const verbs = ATTACK_VERBS[typeId] ?? ['hits'];
    const increment = Math.floor(100 / verbs.length);
    const clamped = Math.max(0, Math.min(percentile, increment * verbs.length - 1));
    return verbs[Math.floor(clamped / increment)]!;
}
