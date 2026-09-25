import fs from 'node:fs';
import { createHeadlessGame } from '../src/test/harness';
import { setMachineObservationHook, type MachineTrace } from '../src/engine/Generator/MachineObservation';
import { normalizeSeed } from '../src/engine/Seed';

const [seedText, depthText, third, fourth] = process.argv.slice(2);
const outPrefix = third === '--id' ? undefined : third;
const lookupId = fourth;
const depth = Number(depthText);
if (!seedText || !Number.isInteger(depth) || depth < 1 || depth > 26) {
    throw new Error('Usage: node scripts/u25-machine-inventory.mjs SEED DEPTH [OUTPUT_PREFIX] [INSTANCE_ID], or SEED DEPTH --id INSTANCE_ID');
}
const seed = normalizeSeed(seedText);
const traces: MachineTrace[] = [];
setMachineObservationHook(trace => traces.push(trace));
try {
    const game: any = createHeadlessGame(seed as unknown as number);
    for (let d = 2; d <= depth; d++) { game.depth = d; game.generateDepth(false, false); }
} finally { setMachineObservationHook(null); }
const machines = traces.filter(t => t.seed === seed && t.depth === depth);
const products = machines.flatMap(m => m.products.map(p => ({ machineNumber: m.machineNumber,
    blueprintId: m.blueprintId, ceBlueprintId: m.ceBlueprintId, ...p })));
const matches = lookupId === undefined ? undefined : products.filter(p => String(p.instanceId) === lookupId);
const output = { seed, depth, machines, products, ...(matches ? { matches } : {}) };
const lines = [`seed ${seed} / D${depth}: ${machines.filter(m => m.status === 'committed').length} machines, ${products.length} products`];
if (matches) lines.push(`instance #${lookupId}: ${matches.length} match(es)${matches.map(p => `; machine #${p.machineNumber} CE${p.ceBlueprintId ?? '?'} feature #${p.featureIndex ?? '?'} source #${p.sourceMachineNumber ?? p.machineNumber}/#${p.sourceFeatureIndex ?? p.featureIndex ?? '?'}`).join('')}`);
for (const m of machines) {
    lines.push(`machine #${m.machineNumber} CE${m.ceBlueprintId ?? '?'} ${m.blueprintId} ${m.status}${m.reason ? `: ${m.reason}` : ''}${m.interiorIterations ? `; interior expansion ${m.interiorIterations} iterations, +${m.interiorAddedCells} cells` : ''}`);
    for (const f of m.features) lines.push(`  feature #${f.index} ${f.status} ${f.placements.length} placements / ${f.iterations} iterations; request=${JSON.stringify(f.request)}`);
    for (const p of m.products) lines.push(`  ${p.kind} #${p.instanceId ?? '-'} ${p.name ?? ''} @${p.pos.x},${p.pos.y} from feature #${p.featureIndex ?? '?'}${p.sourceMachineNumber && p.sourceMachineNumber !== m.machineNumber ? ` (source machine #${p.sourceMachineNumber} feature #${p.sourceFeatureIndex ?? '?'})` : ''}${p.owner ? ` owner=${p.owner}${p.ownerId ? `:${p.ownerId}` : ''}` : ''}${p.outcome ? ` ${p.outcome}` : ''}`);
}
const readable = lines.join('\n') + '\n';
if (outPrefix) {
    fs.writeFileSync(`${outPrefix}.json`, JSON.stringify(output, null, 2) + '\n');
    fs.writeFileSync(`${outPrefix}.txt`, readable);
    console.log(`${outPrefix}.json\n${outPrefix}.txt`);
} else {
    console.log(JSON.stringify(output, null, 2));
    console.error(readable);
}
