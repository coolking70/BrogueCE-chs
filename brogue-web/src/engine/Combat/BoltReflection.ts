import type { Creature } from '../../entities/Creature';
import { Monster, monstersAreEnemies } from '../../entities/Monster';
import { Player } from '../../entities/Player';
import { netEnchant, reflectionChance } from './CombatFormulas';
import { rng } from '../Random';

/** CE Globals.c:1416-1432, projected to existing web species IDs. Only used
 * for projectile reflection; item generation and other armor effects are unchanged.
 * MK_GOBLIN_CHIEFTAN / MK_ACID_JELLY / MK_WILL_O_THE_WISP are web aliases. */
const IMMUNITY_CLASSES: Readonly<Record<string, readonly string[]>> = {
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

/** CE Items.c:4960-4992. Called twice on a successful deflection: the second
 * roll chooses the original caster instead of a random direction. Guaranteed
 * monster reflection consumes no RNG. This is execution-only, never targeting. */
export function projectileReflects(defender: Creature, attacker: Creature | null = null): boolean {
    if (defender instanceof Monster) {
        if (defender.hasAbility('MA_REFLECT_100')) return true;
        const chance = defender.reflectChance();
        return chance > 0 && rng.randPercent(chance);
    }
    if (defender instanceof Player) {
        const armor = defender.equippedArmor;
        if (armor?.runicType === 'immunity' && armor.vorpalEnemy && attacker instanceof Monster
            && IMMUNITY_CLASSES[armor.vorpalEnemy]?.includes(attacker.typeId)
            && monstersAreEnemies(attacker, defender)) return true;
        if (armor?.runicType !== 'reflection') return false;
        const level = netEnchant(armor.enchantment ?? 0, defender.strength, armor.strengthRequired ?? 0);
        return level > 0 && rng.randPercent(reflectionChance(level));
    }
    return false;
}

/** CE Monsters.c:2269-2295, including its asymmetric corner sampling. */
export function randomReflectionOffset() {
    const n = rng.randRange(0, 39);
    if (n <= 10) return { x: n - 5, y: -5 };
    if (n <= 21) return { x: n - 16, y: 5 };
    if (n <= 30) return { x: -5, y: n - 26 };
    return { x: 5, y: n - 35 };
}
