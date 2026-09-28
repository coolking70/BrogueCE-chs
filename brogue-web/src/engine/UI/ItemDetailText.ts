import i18next from 'i18next';
import zhCN from '../../locales/zh_CN.json';

/** Chinese fallback retains the existing detail API in headless/empty-locale
 * clients. All prose, including interpolated labels, belongs to locale keys. */
export function detailText(key: string, values: Record<string, string | number> = {}): string {
    const fallback = (zhCN as Record<string, string>)['detail.item.' + key] ?? '';
    // Some pure headless callers have never initialized i18next. Do not mutate
    // global locale state just to inspect an item; interpolate the same resource.
    if (!i18next.isInitialized) return fallback.replace(/\{\{(\w+)\}\}/g, (token, name: string) => String(values[name] ?? token));
    return i18next.t('detail.item.' + key, {
        ...values, defaultValue: fallback,
        interpolation: { escapeValue: false },
    });
}

export const signed = (n: number): string => (n > 0 ? '+' : '') + String(Math.round(n * 100) / 100);
