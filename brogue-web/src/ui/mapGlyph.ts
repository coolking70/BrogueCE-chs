/** Keep CE glyph data untouched; force browser/Pixi text rather than color emoji.
 * Emoji includes text-default symbols (e.g. ♠) as well as emoji-default ♈.
 * Replace existing presentation selectors so the operation is idempotent.
 */
export function normalizeMapGlyph(text: string): string {
    return text.replace(/(\p{Emoji})[\uFE0E\uFE0F]*/gu, '$1\uFE0E');
}
