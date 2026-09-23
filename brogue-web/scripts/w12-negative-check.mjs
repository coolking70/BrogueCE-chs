// Independent semantic mutants, restored byte-for-byte after each named test.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const dir = 'ai_docs/reports/w-12-evidence';
const game = 'src/engine/Core/Game.ts', trace = 'src/engine/Combat/BoltTrajectory.ts';
const sha = s => createHash('sha256').update(s).digest('hex');
const mutants = [
    ['constant-range', trace, 'return Math.trunc(2 + 2 * enchantment);', 'return 6;', 'moves exactly'],
    ['charges-for-E', game, "? { kind: 'staff', enchantment: item.enchantment } : { kind: 'catalog' }", "? { kind: 'staff', enchantment: item.charges ?? 0 } : { kind: 'catalog' }", 'moves exactly'],
    ['naive-reverse', game, '{ reverseBlink: true }', '{ reverseBlink: false }', 'reverses the forward tuned diagonal'],
    ['no-adjacency-gate', game, 'if (distance <= 1) return false;', 'if (distance <= 0) return false;', 'adjacent \\(.*never releases'],
    ['wrong-pickup-order', game, 'this.placeCreature(result.caster, result.landingPos, { pickupBeforeVision: true })', 'this.placeCreature(result.caster, result.landingPos)', 'CE pickup precedes blink vision'],
    ['no-wait', game, 'target.ticksUntilTurn = Math.max(target.ticksUntilTurn, this.player.attackSpeed + 1);', '// deliberately removed wait', 'distance .*ends adjacent'],
    ['gold-capacity', game, 'else if (!this.player.inventory.addItem(item)) return;', 'else if (!this.player.inventory.addItem(item)) return;\n        if (item.category === ItemCategory.GOLD && !this.player.inventory.addItem(item)) return;', 'destination gold'],
];
const results = [];
for (const [name, file, needle, replacement, test] of mutants) {
    const original = fs.readFileSync(file, 'utf8');
    if (original.split(needle).length !== 2) throw Error(`ambiguous/missing mutation ${name}`);
    let run, data;
    try {
        fs.writeFileSync(file, original.replace(needle, replacement));
        run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'src/test/w_12_blink_beckoning.test.ts', '-t', test,
            '--reporter=json', `--outputFile=${dir}/negative-${name}.json`], { encoding: 'utf8' });
        fs.writeFileSync(`${dir}/negative-${name}.log`, run.stdout + run.stderr);
        data = JSON.parse(fs.readFileSync(`${dir}/negative-${name}.json`, 'utf8'));
    } finally { fs.writeFileSync(file, original); }
    const result = { name, file, test, exitCode: run.status, failed: data.numFailedTests,
        before: sha(original), restored: sha(fs.readFileSync(file)), restoredExactly: fs.readFileSync(file, 'utf8') === original };
    results.push(result);
    console.log(JSON.stringify(result));
    if (run.status !== 1 || data.numFailedTests < 1 || !result.restoredExactly) throw Error(`mutant escaped: ${name}`);
}
fs.writeFileSync(`${dir}/negative-summary.json`, JSON.stringify(results, null, 2) + '\n');
