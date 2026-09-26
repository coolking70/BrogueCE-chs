// In-memory counterfactuals only. Production files, existing guards and baselines stay untouched.
import { defineConfig } from 'vitest/config';
import fs from 'node:fs';
const variant = process.env.X2D_VARIANT;
export default defineConfig({
    test: { testTimeout: 900_000, hookTimeout: 120_000, maxWorkers: 1 },
    plugins: [{
        name: 'x2d-counterfactual', enforce: 'pre',
        transform(code, id) {
            const file = id.replaceAll('\\', '/').split('?')[0]!;
            if (file.endsWith('/engine/Items/ItemUseCoordinator.ts')) {
                if (variant === 'equipped-only') {
                    const from = '|| item.category === ItemCategory.WEAPON || item.category === ItemCategory.ARMOR';
                    if (!code.includes(from)) throw Error('Missing eligibility anchor');
                    return code.replace(from, '|| item === (player.equippedWeapon ?? player.equippedArmor)');
                }
                if (variant === 'random-runes') {
                    const anchor = 'item.strengthRequired = Math.max';
                    if (!code.includes(anchor)) throw Error('Missing gear anchor');
                    return code.replace(anchor, `
                        if (!item.runicType && rng.randPercent(20)) {
                            const runics = item.category === ItemCategory.WEAPON ? ItemLoader.GENERATED_WEAPON_RUNICS : ItemLoader.GENERATED_ARMOR_RUNICS;
                            item.runicType = runics[rng.randRange(0, runics.length - 1)];
                            item.runicKnown = true;
                            const runicName = i18next.t('runic.name.' + item.runicType);
                            logger.log(i18next.t('item.runic_awakened', { name: item.name, runic: runicName }));
                        }
                        ${anchor}`);
                }
            }
            if (variant === 'old-uncurse-message' && file.endsWith('/engine/Core/Game.ts')) {
                // Restore only the old rendered message; retain all-pack flag-only mutation.
                code = code.replace('let hadEffect = false;\n        for (const item of this.player.inventory.items)', 'const firstCursed = this.player.inventory.items.find(i => i.isCursed);\n        let hadEffect = false;\n        for (const item of this.player.inventory.items)');
                return code.replace("if (hadEffect) logger.log(i18next.t('scroll.remove_curse', {\n            defaultValue: 'Your pack glows with a cleansing light, and a malevolent energy disperses.'\n        }), '#88ffcc');", "if (hadEffect) logger.log(i18next.t('item.uncursed', { name: firstCursed!.name }), '#88ffcc');");
            }
            if (file.endsWith('/locales/zh_CN.json') && ['random-runes', 'old-uncurse-message'].includes(variant ?? '')) {
                const main = JSON.parse(fs.readFileSync(file, 'utf8'));
                const legacy = JSON.parse(fs.readFileSync(file.replace('zh_CN.json', 'zh_CN.legacy.json'), 'utf8'));
                const key = variant === 'random-runes' ? 'item.runic_awakened' : 'item.uncursed';
                main[key] = legacy[key];
                return JSON.stringify(main);
            }
        },
    }],
});
