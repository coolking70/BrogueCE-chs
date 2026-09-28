import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import i18next from 'i18next';
import '../i18n';
import content from '../locales/zh_CN.content.json';
import fixture from './fixtures/x4-r5-ce-text.json';
import monsters from '../data/monsters.json';
import { Grid, TerrainType as T } from '../engine/Map/Grid';
import { CE_TERRAIN_TEXT, TERRAIN_TEXT_IDS, REVEALED_TERRAIN, describeTerrain,
    getTerrainDescription, getTerrainTextById, selectKnownTerrain, selectTerrainTextLayer,
    tileFlavor, type CETerrainTextId } from '../engine/UI/TerrainTextCatalog';
import { MONSTER_CE_TEXT_IDS, MONSTER_TEXT_CATALOG, getMonsterAbsorbStatus,
    getMonsterSummonMessage, formatMonsterSummonMessage } from '../engine/UI/MonsterTextCatalog';
import { DF, DUNGEON_FEATURE_CATALOG } from '../engine/Map/DungeonFeatureCatalog';
import { catalogFeature, spawnDungeonFeature, resetDFMessageEligibility } from '../engine/Map/DungeonFeature';
import { Game } from '../engine/Core/Game';

const globals = readFileSync(new URL('../../../BrogueCE-master/src/brogue/Globals.c', import.meta.url), 'utf8').split(/\r?\n/);
const chinese = (text: string) => {
    expect(text.trim()).not.toBe('');
    expect(text).toMatch(/[\u4e00-\u9fff]/);
    expect(text).not.toMatch(/[A-Za-z]/);
};

describe('X4-R5 CE text inventory', () => {
    it('pins all 215 CE rows and all 188 nonempty flavors against the actual C source', () => {
        const tileRows = globals.filter(line => /^\s*\/\*[A-Z_0-9]+,?\*\/\s*\{/.test(line));
        expect(tileRows).toHaveLength(215);
        expect(fixture.tiles).toHaveLength(215);
        expect(Object.keys(CE_TERRAIN_TEXT)).toEqual(fixture.tiles.map(row => row.id));
        expect(fixture.tiles.filter(row => row.flavor)).toHaveLength(188);
        for (const row of fixture.tiles) {
            const source = globals[row.line - 1]!;
            expect(source).toMatch(new RegExp('/\\*' + row.id + ',?\\*/'));
            const strings = Array.from(source.matchAll(/"(?:\\.|[^"\\])*"/g), match => JSON.parse(match[0]) as string);
            expect(strings.slice(-2), row.id).toEqual([row.description, row.flavor]);
            expect(source.includes('TM_IS_SECRET'), row.id).toBe(row.secret);
            const text = CE_TERRAIN_TEXT[row.id as CETerrainTextId];
            chinese(text.description);
            if (row.flavor) chinese(text.flavor);
            else expect(text.flavor, row.id).toBe('');
        }
    });

    it('covers every current web terrain, including the 88 former ground fallbacks and NOTHING', () => {
        const terrains = Object.values(T).filter((value): value is T => typeof value === 'number');
        expect(terrains).toHaveLength(208);
        expect(Object.keys(TERRAIN_TEXT_IDS)).toHaveLength(terrains.length);
        const byId = new Map(fixture.tiles.map(row => [row.id, row]));
        for (const terrain of terrains) {
            const id = TERRAIN_TEXT_IDS[terrain];
            const source = byId.get(id);
            const actual = getTerrainDescription(terrain);
            chinese(actual);
            if (source?.description && source.description !== 'the ground') expect(actual, id).not.toBe('地面');
        }
        const formerFallbacks = `CARPET MARBLE_FLOOR TORCH_WALL CRYSTAL_WALL PORTCULLIS_CLOSED WOODEN_BARRICADE
            HAUNTED_TORCH_DORMANT HAUNTED_TORCH_TRANSITIONING HAUNTED_TORCH WALL_LEVER_HIDDEN_DORMANT
            STATUE_INERT STATUE_DORMANT STATUE_INSTACRACK PORTAL TURRET_DORMANT WALL_MONSTER_DORMANT
            ALTAR_KEYHOLE ALTAR_CAGE_OPEN ALTAR_SWITCH ALTAR_SWITCH_RETRACTING ALTAR_CAGE_RETRACTABLE PEDESTAL
            MONSTER_CAGE_OPEN MONSTER_CAGE_CLOSED COFFIN_CLOSED GAS_TRAP_PARALYSIS FLOOD_TRAP MACHINE_GLYPH
            MACHINE_GLYPH_INACTIVE CHASM_EDGE MACHINE_COLLAPSE_EDGE_SPREADING LAVA_RETRACTABLE LAVA_RETRACTING
            OBSIDIAN BRIDGE BRIDGE_EDGE STONE_BRIDGE MACHINE_FLOOD_WATER_DORMANT MACHINE_FLOOD_WATER_SPREADING
            MACHINE_MUD_DORMANT HOLE HOLE_EDGE FLOOD_WATER_DEEP FLOOD_WATER_SHALLOW DEAD_GRASS GRAY_FUNGUS
            LUMINESCENT_FUNGUS VOMIT ASH PUDDLE BONES RUBBLE ECTOPLASM EMBERS DEAD_FOLIAGE FORCEFIELD FORCEFIELD_MELT
            SACRED_GLYPH MANACLE_T MANACLE_L PLAIN_FIRE GAS_FIRE GAS_EXPLOSION POISON_GAS CONFUSION_GAS STENCH_SMOKE_GAS
            PARALYSIS_GAS METHANE_GAS STEAM BLOODFLOWER_STALK HAVEN_BEDROLL SACRIFICE_CAGE_DORMANT DEMONIC_STATUE
            STATUE_INERT_DOORWAY STATUE_DORMANT_DOORWAY CHASM_WITH_HIDDEN_BRIDGE CHASM_WITH_HIDDEN_BRIDGE_ACTIVE
            MACHINE_CHASM_EDGE RAT_TRAP_WALL_DORMANT ELECTRIC_CRYSTAL_OFF ELECTRIC_CRYSTAL_ON TURRET_LEVER
            WORM_TUNNEL_MARKER_DORMANT WORM_TUNNEL_OUTER_WALL BRAZIER MUD_FLOOR MUD_WALL MUD_DOORWAY`.split(/\s+/);
        expect(formerFallbacks).toHaveLength(88);
        for (const name of formerFallbacks) {
            // CE's dormant worm marker is invisible and has NO description at all.
            if (name === 'WORM_TUNNEL_MARKER_DORMANT') {
                expect(byId.get(name)?.description).toBe('');
                expect(getTerrainDescription(T.WORM_TUNNEL_MARKER_DORMANT)).toBe('地面');
            } else expect(getTerrainDescription(T[name as keyof typeof T]), name).not.toBe('地面');
        }
        expect(getTerrainDescription(T.NOTHING)).toContain('虚空');
        expect(getTerrainDescription(T.STAIRS_UP, { atDungeonExit: true })).toBe('地牢出口');
        expect(getTerrainDescription(T.STAIRS_UP)).toContain('向上');
        expect(getTerrainTextById('ICE_DEEP').flavor).toContain('冰');
    });

    it('registers the content namespace, including the two ancient-spirit terrain keys', () => {
        for (const row of fixture.tiles) {
            const key = `content:terrain.${row.id}.description`;
            expect(i18next.exists(key), key).toBe(true);
            expect(i18next.t(key)).toBe(CE_TERRAIN_TEXT[row.id as CETerrainTextId].description);
            expect(i18next.t(`content:terrain.${row.id}.flavor`)).toBe(CE_TERRAIN_TEXT[row.id as CETerrainTextId].flavor);
        }
        for (const [id, text] of Object.entries(MONSTER_TEXT_CATALOG)) {
            expect(i18next.t(`content:monster.${id}.absorbStatus`)).toBe(text.absorbStatus);
            expect(i18next.t(`content:monster.${id}.summonMessage`)).toBe(text.summonMessage);
        }
        for (const [id, text] of Object.entries(content.webTerrain)) {
            expect(i18next.t(`content:webTerrain.${id}.description`)).toBe(text.description);
        }
        for (const [id, text] of Object.entries(content.dungeonFeature)) {
            expect(i18next.t(`content:dungeonFeature.${id}`)).toBe(text);
        }
        expect(i18next.t('content:terrain.ANCIENT_SPIRIT_VINES.description')).toBe('带刺的藤蔓');
        expect(i18next.t('content:terrain.ANCIENT_SPIRIT_GRASS.description')).toBe('一丛草');
    });
});

describe('X4-R5 CE layer selection and knowledge boundaries', () => {
    it('compares priorities across ALL layers, including gas, with CE tie order and no flavor fallback', () => {
        expect(tileFlavor([T.FLOOR, T.WATER_DEEP, T.POISON_GAS, T.GRASS])).toContain('紫色');
        expect(tileFlavor([T.FLOOR, T.WATER_DEEP, T.POISON_GAS, T.PLAIN_FIRE])).toBe('火焰向上翻腾。');
        expect(tileFlavor([T.DOOR, T.NOTHING, T.POISON_GAS, T.PLAIN_FIRE])).toBe('你穿过了门口。');
        expect(selectTerrainTextLayer([T.FLOOR, T.CHASM, T.NOTHING, T.LAVA])).toBe(T.CHASM);
        expect(selectTerrainTextLayer([T.FLOOR, T.NOTHING, T.POISON_GAS, T.CONFUSION_GAS])).toBe(T.POISON_GAS);
        expect(selectTerrainTextLayer([T.WALL, T.GRANITE, T.NOTHING, T.NOTHING])).toBe(T.WALL);
        expect(tileFlavor([T.DEWAR_CAUSTIC_GAS, T.NOTHING, T.NOTHING, T.GRASS])).toBe('');
        expect(selectTerrainTextLayer([T.NOTHING, T.NOTHING, T.NOTHING, T.NOTHING])).toBe(T.NOTHING);
        expect(tileFlavor([])).toBe('');
    });

    it('keeps all undiscovered secrets disguised and uses the CE discover tile only when explicitly known', () => {
        const secretRows = fixture.tiles.filter(row => row.secret);
        expect(secretRows).toHaveLength(13);
        expect(Object.keys(REVEALED_TERRAIN)).toHaveLength(secretRows.length);
        for (const row of secretRows) {
            const terrain = T[row.id as keyof typeof T];
            const revealed = T[row.revealed as keyof typeof T];
            const disguise = row.description === 'a stone wall' ? T.WALL : T.FLOOR;
            expect(getTerrainDescription(terrain), row.id).toBe(getTerrainDescription(disguise));
            expect(getTerrainDescription(terrain, { secretsRevealed: true }), row.id).toBe(getTerrainDescription(revealed));
            expect(REVEALED_TERRAIN[terrain]).toBe(revealed);
        }
        // Contact flavor exists for CE parity, but is not an inspection disclosure.
        expect(tileFlavor([T.TRAP_DOOR_HIDDEN])).toContain('活板门');
        expect(describeTerrain({ visible: { terrain: T.TRAP_DOOR_HIDDEN } })).toEqual({ description: '地面', flavor: '' });
        expect(getTerrainDescription(T.WALL_LEVER_HIDDEN_DORMANT, { secretsRevealed: true })).toBe(getTerrainDescription(T.WALL));
        expect(getTerrainDescription(T.CHASM_WITH_HIDDEN_BRIDGE, { secretsRevealed: true })).toBe(getTerrainDescription(T.CHASM));
    });

    it('uses the remembered stack and its knowledge, without borrowing current discovery or hazards', () => {
        const remembered = Object.freeze({ layers: Object.freeze([T.SECRET_DOOR, T.NOTHING, T.NOTHING, T.NOTHING]) });
        const visible = Object.freeze({ layers: Object.freeze([T.DOOR, T.NOTHING, T.POISON_GAS, T.PLAIN_FIRE]), secretsRevealed: true });
        expect(selectKnownTerrain({ visible, remembered })).toBe('DOOR');
        expect(selectKnownTerrain({ remembered })).toBe('SECRET_DOOR');
        expect(describeTerrain({ remembered })?.description).toBe(getTerrainDescription(T.WALL));
        expect(describeTerrain({ remembered: { terrain: T.WATER_DEEP } })?.description).toContain('浑浊');
        expect(selectKnownTerrain({ remembered: { layers: [T.NOTHING, T.NOTHING, T.NOTHING, T.NOTHING], terrain: T.LAVA } })).toBe('NOTHING');
        expect(describeTerrain({})).toBeNull();
        expect(describeTerrain({ visible: {}, remembered: { terrain: T.LAVA } })).toBeNull();
        expect(remembered.layers).toEqual([T.SECRET_DOOR, T.NOTHING, T.NOTHING, T.NOTHING]);
    });

    it('accepts an explicit locale without consulting or mutating global game state', () => {
        const other = { ...content, terrain: { ...content.terrain, FLOOR: { description: '测试地面', flavor: '测试风味' } } };
        expect(getTerrainDescription(T.FLOOR, {}, other)).toBe('测试地面');
        expect(tileFlavor([T.FLOOR], {}, other)).toBe('测试风味');
        expect(getTerrainDescription(T.FLOOR)).toBe('地面');
        expect(tileFlavor([T.FLOOR])).toBe('');
    });
});

describe('X4-R5 species-specific monster text', () => {
    it('covers all 67 species and preserves the eight CE summon identities and all status distinctions', () => {
        expect(Object.keys(MONSTER_TEXT_CATALOG).sort()).toEqual(monsters.map(monster => monster.id.toLowerCase()).sort());
        expect(Object.keys(MONSTER_TEXT_CATALOG)).toHaveLength(67);
        expect(fixture.monsters.filter(row => row.summon)).toHaveLength(8);
        const byCE = new Map(fixture.monsters.map(row => [row.id, row]));
        for (const [id, ceId] of Object.entries(MONSTER_CE_TEXT_IDS)) {
            const row = byCE.get(ceId)!;
            expect(row, id).toBeDefined();
            expect(globals[row.line]).toContain(JSON.stringify(row.status));
            const next = fixture.monsters.find(other => other.line > row.line)?.line ?? row.line + 4;
            const block = globals.slice(row.line - 1, next - 1).join('\n');
            if (row.summon) expect(block).toContain(JSON.stringify(row.summon));
            chinese(getMonsterAbsorbStatus(id));
            if (row.summon) {
                chinese(getMonsterSummonMessage(id));
                expect(formatMonsterSummonMessage(id, '测试生物')).toBe('测试生物' + getMonsterSummonMessage(id));
            } else expect(getMonsterSummonMessage(id)).toBe('');
        }
        expect(new Set(Object.values(MONSTER_TEXT_CATALOG).map(row => row.absorbStatus)).size).toBe(23);
        expect(getMonsterAbsorbStatus('rat')).toBe('进食');
        expect(getMonsterAbsorbStatus('goblin')).toBe('吟唱');
        expect(getMonsterAbsorbStatus('Warden_of_Yendor')).toBe('凝视');
        expect(getMonsterAbsorbStatus('mangrove_dryad')).toBe('吸收');
        expect(getMonsterSummonMessage('goblin_warlord')).toContain('战吼');
        expect(getMonsterSummonMessage('phylactery')).toContain('巫妖');
        expect(getMonsterSummonMessage('phoenix_egg')).toContain('凤凰');
        expect(formatMonsterSummonMessage('rat', '老鼠')).toBe('');
        expect(getMonsterAbsorbStatus('unknown_species')).toBe('');
        expect(getMonsterSummonMessage('toString')).toBe('');
    });
});

describe('X4-R5 flood/collapse warnings through the existing DF path', () => {
    it.each([DF.DF_SPREADABLE_WATER, DF.DF_SPREADABLE_COLLAPSE])('restores %s and keeps visibility/once-per-reset eligibility', id => {
        const row = fixture.features[String(id) as keyof typeof fixture.features];
        const entry = DUNGEON_FEATURE_CATALOG[id]!;
        expect(globals[entry.ceLine - 1]).toContain(JSON.stringify(row.ceDescription));
        expect(entry.description).toBe(row.description);
        chinese(entry.description);
        // Game's existing default handles localized descriptions without any Game edit.
        const translate = (Game.prototype as unknown as { dungeonFeatureDescription(text: string): string }).dungeonFeatureDescription;
        expect(translate.call(Game.prototype, entry.description)).toBe(row.description);
        const grid = new Grid(6, 6);
        grid.setTerrain(2, 2, T.FLOOR_FLOODABLE);
        grid.setTerrain(3, 2, T.FLOOR_FLOODABLE);
        const messages: string[] = [];
        const effects = { describe: (feat: { description: string }, pos: { x: number; y: number }) => {
            if (!grid.getCell(pos.x, pos.y)?.isVisible) return false;
            messages.push(translate.call(Game.prototype, feat.description));
            return true;
        } };
        const spawn = (x = 2) => spawnDungeonFeature(grid, x, 2, catalogFeature(id), false, { effects });
        spawn();
        expect(messages).toEqual([]);
        grid.getCell(2, 2)!.isVisible = true;
        grid.getCell(3, 2)!.isVisible = true;
        spawn();
        spawn(3); // same catalog DF, new feature object and a different origin
        expect(messages).toEqual([row.description]);
        resetDFMessageEligibility(grid);
        spawn();
        expect(messages).toEqual([row.description, row.description]);
    });
});
