/** R1 localized additions in the application's existing translation resource.
 * R5/R6 select the known/remembered tile before calling these text-only readers.
 * No initialization side effects and no hidden-world lookup.
 */
import i18next from 'i18next';
import zhCN from '../../locales/zh_CN.json';
import { TerrainType } from '../Map/TerrainType';

const chinese: Readonly<Record<string, string>> = zhCN;

export function worldTerrainText(tile: TerrainType, field: 'description' | 'flavor'): string | undefined {
    const name = TerrainType[tile];
    const suffix = `${name}.${field}`;
    const fallback = chinese['world.terrain.' + suffix];
    if (fallback === undefined) return undefined;
    return i18next.t('world.terrain.' + suffix, { defaultValue: fallback }) ?? fallback;
}

export function worldFeatureText(description: string): string | undefined {
    const name = description === 'the glyph beneath you glows, and the guardians take a step!'
        ? 'DF_GUARDIAN_STEP'
        : description === 'the mirrored totem flashes, reflecting the red glow of the glyph beneath you.'
            ? 'DF_MIRROR_TOTEM_STEP' : undefined;
    return name === undefined ? undefined
        : i18next.t(`world.df.${name}`, { defaultValue: chinese[`world.df.${name}`] }) ?? chinese[`world.df.${name}`];
}

export function worldHealingText(): string {
    return i18next.t('world.healing', { defaultValue: zhCN['world.healing'] }) ?? zhCN['world.healing'];
}
