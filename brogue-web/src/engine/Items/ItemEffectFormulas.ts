/** Pure projections shared by execution and itemDetails. No Item mutation,
 * knowledge lookup or RNG. CE Items.c heal/haste/discord/enchant, Time.c stealth. */
export const staffHealingPercent = (enchantment: number): number => Math.min(100, 10 * enchantment);
export const staffHasteDuration = (enchantment: number): number => 2 + 4 * enchantment;
export const staffDiscordDuration = (enchantment: number): number => 4 * enchantment;
export const armorStealthAdjustment = (strengthRequired: number): number => Math.max(0, strengthRequired - 12);

export function enchantedEquipment(enchantment: number, strengthRequired: number) {
    return { enchantment: enchantment + 1, strengthRequired: Math.max(0, strengthRequired - 1) };
}

export const ringStealthAdjustment = (bonus: number): number => bonus < 0 ? -4 * bonus : -bonus;
export const ringAwarenessBonus = (bonus: number): number => 20 * bonus;
export const ringClairvoyanceRadius = (bonus: number): number => bonus === 0 ? 0 : Math.abs(bonus) + 1;
export const ringTransferencePercent = (bonus: number): number => 5 * bonus;
