import fs from 'node:fs';
import { defineConfig } from 'vitest/config';
const variant = process.env.X2E_VARIANT;
const cases: Record<string, [string, string, string]> = {
    duration: ['CharmModel.ts', 'Math.trunc(enchant) - 1', 'Math.trunc(enchant) - 2'],
    fixedpoint: ['CharmModel.ts', 'result * base + Math.trunc(error * base / FP)', 'result * base'],
    short: ['CharmModel.ts', '(value << 16) >> 16', 'value'],
    seizure: ['ItemUseCoordinator.ts', 'player.seized = false;', ''],
    shattering: ['ItemUseCoordinator.ts', 'ports.shatter(charmShattering(item.enchantment))', 'ports.shatter(charmShattering(item.enchantment) + 1)'],
    lifespan: ['ItemUseCoordinator.ts', 'ports.summonGuardian(charmGuardianLifespan(item.enchantment))', 'ports.summonGuardian(18)'],
    placement: ['Game.ts', 'avoidedFlagsForCaster(guardian) & ~T_SPONTANEOUSLY_IGNITES', 'undefined'],
    binding: ['Game.ts', 'guardian.boundToPlayer = true;', 'guardian.boundToPlayer = false;'],
    expiration: ['Game.ts', "guardian.setStatusDuration('lifespan_remaining', lifespan);", ''],
    teleport: ['Game.ts', 'teleport: () => this.teleportPlayerRandom(true)', 'teleport: () => this.teleportPlayerRandom(false)'],
    recharge: ['Game.ts', 'this.rechargeStaffsAndCharms(false)', 'this.rechargeStaffsAndCharms(true)'],
    negation: ['ItemUseCoordinator.ts', 'ports.negate(charmNegationRadius(item.enchantment) + 1)', 'ports.negate(charmNegationRadius(item.enchantment))'],
    cooldown: ['ItemUseCoordinator.ts', 'item.cooldownRemaining = item.cooldownTurns;', 'item.cooldownRemaining = 0;'],
    enchant: ['ArcanaEnchantment.ts', 'item.cooldownRemaining = 0;', 'item.cooldownRemaining = 1;'],
    pool: ['ItemLoader.ts', 'ItemLoader.filterPool(ItemLoader.charms)', 'ItemLoader.filterPool(ItemLoader.charms).slice(0, 6)'],
};
if (!variant || !cases[variant]) throw Error('Unknown X2e counterfactual');
const [file, before, after] = cases[variant]!;
export default defineConfig({
    plugins: [{ name: 'x2e-isolated-counterfactual', enforce: 'pre', load(id) {
        if (!id.endsWith('/' + file)) return;
        const source = fs.readFileSync(id, 'utf8');
        if (!source.includes(before)) throw Error(`Missing mutation: ${variant}`);
        return source.replace(before, after);
    } }],
    test: { testTimeout: 900000, hookTimeout: 120000 },
});
