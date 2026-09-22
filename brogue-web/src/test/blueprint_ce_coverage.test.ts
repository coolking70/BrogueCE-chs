import { describe, expect, it } from 'vitest';
import data from '../data/blueprints.json';

// Runtime metadata validation deliberately accepts unknown: a TS assertion must not
// hide absent fields, string IDs, fractions, or null without a provenance reason.
type Metadata = { id: string; ceBlueprintId?: unknown; ceOrigin?: unknown };

// Audited against GlobalsBrogue.c:173–622, including every feature column.
// This is catalog identity coverage, not a claim of complete gameplay parity.
// Missing CE 8: outsourced permanent-item reward (no room, four alternative
// features); none of the web-only reward rooms implements that blueprint.
// Missing CE 48: CE itself sets frequency=0 and says DISABLED (Not fun enough.);
// no web entry. CE 13/14 are present since 9d. Keep zero-frequency/quarantined
// CE entries (including 15/18/52/55/65/66) in the identity coverage set.
const EXPECTED_CE_IDS = [
    1, 2, 3, 4, 5, 6, 7,
    9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
    31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
    41, 42, 43, 44, 45, 46, 47,
    49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60,
    61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71,
];

// Pin ownership as well as the set: swapping CE 15 and 43 preserves coverage
// and uniqueness, but their identical names describe different features.
// Swapping CE 52 silently quarantines the wrong blueprint in blueprintQualifies.
const EXPECTED_MAPPING: Record<string, number | null> = {
    reward_library: null,
    reward_consumables: null,
    reward_treasure_room: 3,
    reward_pedestal_permanent: 4,
    reward_pedestal_consumable: 5,
    reward_kennel: 10,
    reward_commutation: 6,
    reward_mixed_library: 1,
    reward_single_category_library: 2,
    reward_resurrection_altar: 7,
    reward_statuary: 15,
    vestibule_locked: 16,
    vestibule_secret_door: 17,
    vestibule_flammable_barricade: 19,
    vestibule_statue_doorway: 20,
    vestibule_pit_trap_field: 23,
    vestibule_secret_lever: 18,
    vestibule_throwing_tutorial: 22,
    vestibule_beckoning_obstacle: 24,
    vestibule_guardian_obstacle: 25,
    vestibule_flammable: null,
    vestibule_guardian: null,
    vestibule_pit_traps: null,
    key_rat_trap: null,
    key_fire_trap: null,
    key_flood_trap: null,
    key_poison_gas: 40,
    key_pit_trap: 35,
    key_web_room: null,
    key_lava_moat: null,
    key_boss: null,
    key_secret_room: 27,
    key_nested_library: 26,
    key_throwing_tutorial_cage: 28,
    trap_paralysis_revealed: 67,
    trap_paralysis_hidden: 68,
    vestibule_statue_monster: 21,
    key_rat_trap_dormant: 29,
    key_explosive_trap: 41,
    key_statuary: 43,
    key_worm_trap: 50,
    key_turret_trap: 56,
    area_trick_statue: 69,
    area_worm: 70,
    reward_chained_allies: 9,
    reward_vampire_lair: 11,
    reward_legendary_ally: 12,
    key_fun_with_fire: 30,
    key_thief_area: 33,
    key_burning_grass: 42,
    key_guardian_gauntlet: 45,
    key_guardian_corridor: 46,
    key_sacrifice_altar: 47,
    key_beckoning_obstacle: 49,
    key_zombie_crypt: 53,
    key_worm_tunnels: 55,
    key_boss_secret_room: 57,
    ce_58_bloodwort: 58,
    ce_59_shrine: 59,
    ce_60_idyll: 60,
    ce_61_swamp: 61,
    ce_62_camp: 62,
    ce_63_remnant: 63,
    ce_64_dismal: 64,
    ce_71_sentinels: 71,
    ce_31_environment: 31,
    ce_34_environment: 34,
    ce_36_environment: 36,
    ce_37_environment: 37,
    ce_38_environment: 38,
    ce_39_environment: 39,
    ce_44_environment: 44,
    ce_65_environment: 65,
    ce_66_environment: 66,
    key_fire_trap_room: 32,
    key_mud_pit: 51,
    key_electric_crystals: 52,
    key_haunted_house: 54,
    reward_goblin_warren: 13,
    reward_sentinel_sanctuary: 14,
};

function assertValidIndices(rows: readonly Metadata[]): void {
    for (const b of rows) {
        expect(Object.prototype.hasOwnProperty.call(b, 'ceBlueprintId'), `${b.id}: missing ceBlueprintId`).toBe(true);
        const id = b.ceBlueprintId;
        expect(id === null || (typeof id === 'number' && Number.isInteger(id) && id >= 1 && id <= 71),
            `${b.id}: ceBlueprintId must be null or an integer in 1–71; received ${String(id)}`).toBe(true);
    }
}

function assertCoverage(rows: readonly Metadata[]): void {
    const ids = rows.map(b => b.ceBlueprintId).filter((id): id is number => typeof id === 'number');
    expect([...new Set(ids)].sort((a, b) => a - b),
        'CE identity coverage changed; audit every feature and document added/missing IDs').toEqual(EXPECTED_CE_IDS);
}

function assertUnique(rows: readonly Metadata[]): void {
    const owners = new Map<number, string>();
    for (const b of rows) {
        if (typeof b.ceBlueprintId !== 'number') continue;
        expect(owners.has(b.ceBlueprintId),
            `CE ${b.ceBlueprintId}: duplicate owners ${owners.get(b.ceBlueprintId)} / ${b.id}`).toBe(false);
        owners.set(b.ceBlueprintId, b.id);
    }
}

function assertOrigins(rows: readonly Metadata[]): void {
    for (const b of rows.filter(b => b.ceBlueprintId === null)) {
        expect(typeof b.ceOrigin === 'string' && b.ceOrigin.trim().length > 0,
            `${b.id}: web-only blueprint must explain ceOrigin`).toBe(true);
    }
}

function assertMapping(rows: readonly Metadata[]): void {
    const pairs = rows.map(b => [b.id, b.ceBlueprintId] as const);
    // Compare arrays, not Object.fromEntries: duplicate web IDs must stay visible.
    expect(pairs.sort((a, b) => a[0].localeCompare(b[0])),
        'Audited web ID → CE ID ownership changed (especially same-name CE 15/43 and quarantined CE 52)')
        .toEqual(Object.entries(EXPECTED_MAPPING).sort((a, b) => a[0].localeCompare(b[0])));
}

describe('authoritative CE blueprint mapping', () => {
    it('requires an explicit null or integer CE index on every row', () => assertValidIndices(data));
    it('covers exactly the audited CE set', () => assertCoverage(data));
    it('allows only one web owner for each CE index', () => assertUnique(data));
    it('requires a nonempty reason for every web-only entry', () => assertOrigins(data));
    it('preserves all 80 audited owners, including distinct statuary entries and CE 52', () => assertMapping(data));
});

// Exercise the same guards with in-memory defects; never edit generation data or
// recapture the baseline to prove that the guards reject bad metadata.
describe('mapping guard counterexamples', () => {
    it('rejects a newly added blueprint whose CE field was forgotten', () => {
        expect(() => assertValidIndices([...data, { id: 'unmapped_new_blueprint' }])).toThrow(/unmapped_new_blueprint/);
    });
    it.each([undefined, 0, 72, 1.5, '52'])('rejects an invalid explicit index %s', ceBlueprintId => {
        expect(() => assertValidIndices([{ id: 'invalid_index', ceBlueprintId }])).toThrow(/invalid_index/);
    });
    it('rejects duplicate claims even when the coverage set is unchanged', () => {
        expect(() => assertUnique([...data, { id: 'duplicate_statuary', ceBlueprintId: 43 }])).toThrow(/duplicate_statuary/);
    });
    it.each([undefined, '', '   '])('rejects a null origin without a useful reason: %s', ceOrigin => {
        expect(() => assertOrigins([{ id: 'unexplained_web_blueprint', ceBlueprintId: null, ceOrigin }]))
            .toThrow(/unexplained_web_blueprint/);
    });
    it('rejects losing an implemented CE blueprint', () => {
        expect(() => assertCoverage(data.filter(b => b.ceBlueprintId !== 13))).toThrow(/coverage changed/);
    });
    it.each([[15, 43], [52, 43]])('rejects swapping CE %s and %s while preserving set and uniqueness', (a, b) => {
        const swapped = data.map(row => ({ ...row,
            ceBlueprintId: row.ceBlueprintId === a ? b : row.ceBlueprintId === b ? a : row.ceBlueprintId,
        }));
        assertCoverage(swapped);
        assertUnique(swapped);
        expect(() => assertMapping(swapped)).toThrow(/ownership changed/);
    });
});
