/** CE Globals.c:1416-1433 monsterClassCatalog membership (not generation weights). */
const MEMBERS: Record<string, readonly string[]> = {
    abomination: ['bog_monster', 'underworm', 'kraken', 'tentacle_horror'],
    dar: ['dar_blademaster', 'dar_priestess', 'dar_battlemage'],
    animal: ['rat', 'monkey', 'jackal', 'eel', 'toad', 'vampire_bat', 'centipede', 'spider'],
    goblin: ['goblin', 'goblin_conjurer', 'goblin_mystic', 'goblin_totem', 'goblin_warlord', 'spectral_blade'],
    ogre: ['ogre', 'ogre_shaman', 'ogre_totem'],
    dragon: ['dragon'],
    undead: ['zombie', 'wraith', 'vampire', 'phantom', 'lich', 'revenant'],
    jelly: ['pink_jelly', 'black_jelly', 'acidic_jelly'],
    turret: ['arrow_turret', 'spark_turret', 'dart_turret', 'flame_turret'],
    infernal: ['flamedancer', 'imp', 'revenant', 'fury', 'phantom', 'ifrit'],
    mage: ['goblin_conjurer', 'goblin_mystic', 'ogre_shaman', 'dar_priestess', 'dar_battlemage', 'pixie', 'lich'],
    waterborne: ['eel', 'naga', 'kraken'],
    airborne: ['vampire_bat', 'wisp', 'pixie', 'phantom', 'fury', 'ifrit', 'phoenix'],
    fireborne: ['wisp', 'salamander', 'flamedancer', 'phoenix'],
    troll: ['troll'],
};

export function monsterIsInClass(typeId: string, className?: string): boolean {
    return !!className && (MEMBERS[className]?.includes(typeId) ?? false);
}
