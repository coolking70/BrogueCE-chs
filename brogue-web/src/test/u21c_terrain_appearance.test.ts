import { describe, expect, it } from 'vitest';
import { TerrainType } from '../engine/Map/Grid';
import { terrainAppearance } from '../engine/UI/Appearance';

describe('U21c CE terrain appearance coverage', () => {
    it('covers every numeric TerrainType and rejects unknown values', () => {
        const terrainValues = Object.values(TerrainType).filter((value): value is number => typeof value === 'number');
        for (const terrain of terrainValues) {
            const visual = terrainAppearance(terrain, true);
            expect(visual.char).toBeDefined();
            expect(visual.color).toMatch(/^#[0-9a-f]{6}$/);
        }
        expect(() => terrainAppearance(9999 as TerrainType, true)).toThrow(/Missing CE appearance/);
    });

    it('uses the CE glyph and base color for the terrain named in K16', () => {
        expect(terrainAppearance(TerrainType.FORCEFIELD, true))
            .toEqual({ char: '#', color: '#003f3f', bgColor: 0x003f3f });
        expect(terrainAppearance(TerrainType.CRYSTAL_WALL, true))
            .toEqual({ char: '#', color: '#666699', bgColor: 0x666699 });
        expect(terrainAppearance(TerrainType.ANCIENT_SPIRIT_VINES, true).char).toBe(':');
        expect(terrainAppearance(TerrainType.RUBBLE, true).char).toBe(',');
    });
});
