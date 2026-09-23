import { Monster, monstersAreTeammates } from '../../entities/Monster';
import type { Player } from '../../entities/Player';
import type { Creature } from '../../entities/Creature';
import type { Grid } from '../Map/Grid';
import { cellTerrainFlags } from '../Map/DungeonFeature';
import { T_OBSTRUCTS_PASSABILITY, T_OBSTRUCTS_VISION } from '../Map/TerrainCatalog';
import type { Item } from '../Items/Item';
import { ItemLoader } from '../Items/ItemLoader';
import { boltLine } from './BoltTrajectory';
import { wandDominate } from './Domination';
import { CE_BOLT_CATALOG, CE_ITEM_BOLT_TYPES, CEBoltEffect, CEBoltFlags } from './BoltCatalog';

/** CE IO.c canSeeMonster/monsterRevealed: use perception, not merely a lit tile.
 * No new submerged bookkeeping or clairvoyance is introduced here. */
export function canObserveBoltCreature(player: Player, grid: Grid, creature: Creature): boolean {
    if (creature === player) return true;
    if (!(creature instanceof Monster) || creature.isDormant) return false;
    if (player.hasStatus('telepathy')) return true;
    return !!grid.getCell(creature.loc.x, creature.loc.y)?.isVisible
        && (creature.isAlly || (!creature.isTrulyInvisible() && !creature.hasStatus('invisible')));
}

/** CE Items.c:5935-6032. Eligibility is ONLY for automatic candidates;
 * manual aiming and collisions must not use this filter. No RNG. */
export function arcanaTargetCandidates(player: Player, grid: Grid, monsters: readonly Monster[], item: Item): Monster[] {
    const id = (item as Item & { identityId?: string }).identityId ?? '';
    const type = CE_ITEM_BOLT_TYPES[id];
    const bolt = type === undefined ? undefined : CE_BOLT_CATALOG[type];
    const known = ItemLoader.identifiedItems.has(id);
    const polarityKnown = item.magicDetected || item.identified === true || ItemLoader.isPolarityRevealed(id);
    const polarity = polarityKnown ? ItemLoader.itemMagicPolarity(item) : 0;
    return monsters.filter(m => {
        if (m.hp <= 0 || !canObserveBoltCreature(player, grid, m)) return false;
        // CE openPathBetween also rejects creatures and terrain in intervening cells.
        const line = boltLine(grid, player.loc, m.loc);
        const aimIndex = line.findIndex(p => p.x === m.loc.x && p.y === m.loc.y);
        if (line.slice(0, aimIndex).some(p =>
            (cellTerrainFlags(grid, p.x, p.y) & (T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_VISION))
            || monsters.some(other => other !== m && other.hp > 0 && !other.isDormant
                && (other.isAlly || (!other.isTrulyInvisible() && !other.hasStatus('invisible'))) && other.loc.x === p.x && other.loc.y === p.y))) return false;
        if (player.hasStatus('hallucinating') && !player.hasStatus('telepathy')
            && !m.hasBehavior('MONST_INANIMATE') && !m.isInvulnerable()) return false;
        const ally = monstersAreTeammates(player, m) || m.isCaged;
        if (!ally && m.hasAbility('MA_REFLECT_100')) return false;
        if (known && bolt) {
            if (bolt.forbiddenMonsterFlags.some(flag => m.hasBehavior(flag))) return false;
            const distance = Math.max(Math.abs(m.loc.x - player.loc.x), Math.abs(m.loc.y - player.loc.y));
            if (bolt.effect === CEBoltEffect.DOMINATION
                && (m.hasBehavior('MONST_TURRET') || (!ally && wandDominate(m) <= 0))) return false;
            if (!ally && bolt.effect === CEBoltEffect.BECKONING && distance <= 1) return false;
            if (!ally && (bolt.flags & CEBoltFlags.FIERY) && m.hasStatus('immune_fire')) return false;
            if (ally && bolt.effect === CEBoltEffect.HEALING && !m.hasBehavior('MONST_REFLECT_50') && m.hp >= m.maxHp) return false;
            return !!(bolt.flags & (ally ? CEBoltFlags.TARGET_ALLIES : CEBoltFlags.TARGET_ENEMIES));
        }
        // Unknown kind: never infer flags/forbidden traits from its hidden identity.
        if (polarity) return ally ? polarity < 0 : polarity > 0;
        return !ally;
    }).sort((a, b) => {
        const distance = (m: Monster) => Math.max(Math.abs(m.loc.x - player.loc.x), Math.abs(m.loc.y - player.loc.y));
        return distance(a) - distance(b) || a.id - b.id;
    });
}
