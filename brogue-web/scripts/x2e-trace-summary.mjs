import fs from 'node:fs';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
const out = 'ai_docs/reports/x2e-evidence';
const read = p => JSON.parse(p.endsWith('.gz') ? gunzipSync(fs.readFileSync(p)) : fs.readFileSync(p));
const flatten = value => {
    const rows = [];
    for (const [seed, run] of Object.entries(value)) {
        run.depths.forEach((r, i) => rows.push({ path: `${seed}/depths/${i}`, ...r.hash }));
        for (const k of ['revisit', 'returnTo26', 'loaded']) rows.push({ path: `${seed}/${k}`, ...run[k].hash });
        rows.push({ path: `${seed}/fall`, ...run.fall });
    }
    return rows;
};
const stages = ['s0', 'effects', 'pool'];
const data = stages.map(s => flatten(read(`${out}/ur3-audit-${s}.json.gz`)));
const charmNames = new Set(read('src/data/arcana.json').charms.map(c => c.name));
const observationDiff = (a, b, path = '', rows = []) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return rows;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') {
        rows.push({ path, before: a, after: b });
    } else {
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
            observationDiff(a[key], b[key], `${path}/${key}`, rows);
    }
    return rows;
};
const explainedNames = [];
const unexplainedObservation = (a, b, path) => {
    const differences = observationDiff(a.observations, b.observations);
    for (const d of differences) {
        assert.match(d.path, /^\/\d+\/products\/\d+\/name$/);
        const parent = d.path.split('/').slice(1, -1);
        assert.equal(parent.reduce((v, k) => v[k], a.observations).kind, 'item');
        assert.equal(parent.reduce((v, k) => v[k], b.observations).kind, 'item');
        assert(charmNames.has(d.before) && charmNames.has(d.after));
        explainedNames.push({ sample: path, ...d });
    }
    // Missing raw data is not accepted as proof for a differing observation hash.
    return differences.length === 0;
};
for (let i = 0; i < stages.length; i++) {
    const original = read(`${out}/ur3-${stages[i]}.json.gz`);
    for (const row of data[i]) {
        let expected = row.path.split('/').reduce((v, k) => v[k], original);
        if (!row.path.endsWith('/fall')) expected = expected.hash;
        assert.equal(row.originalHash, expected, `Original UR3 observer changed: ${stages[i]}/${row.path}`);
    }
}
const comparisons = stages.slice(1).map((to, i) => ({
    from: stages[i], to, samples: data[i].length,
    changedOriginalHashes: data[i + 1].filter((r, j) => r.originalHash !== data[i][j].originalHash).length,
    remainingDifferences: data[i + 1].flatMap((r, j) => {
        const prior = data[i][j];
        if (r.canonicalHash === prior.canonicalHash) return [];
        const difference = {
            path: r.path,
            snapshotParts: Object.keys(r.canonicalParts).filter(k => r.canonicalParts[k] !== prior.canonicalParts[k]),
            rng: r.rngHash !== prior.rngHash,
            log: JSON.stringify(r.log) !== JSON.stringify(prior.log),
            observations: r.observationsHash !== prior.observationsHash
                && unexplainedObservation(prior, r, r.path),
        };
        return difference.snapshotParts.length || difference.rng || difference.log || difference.observations ? [difference] : [];
    }),
}));
const traces = read(`${out}/trace-attribution.json`);
assert(traces.every(t => t.headMatchesGolden));
assert(traces.find(t => t.trace === 2).stages.every(s => s.changes.length === 0));
assert(traces.find(t => t.trace === 4).stages.every(s => s.changes.every(p => /\/state\/(identifiedItems|flavors\/arcana)\//.test(p))));
fs.writeFileSync(`${out}/trace-audit-summary.json`, JSON.stringify({
    comparisons,
    normalizedOnly: ['identifiedItems: charm IDs', 'flavors.arcana: charm IDs',
        'CHARM instances: identityId, name, color, cooldownTurns'],
    explainedMachineProductNames: explainedNames,
    originalHashesMatchAllStages: true,
    ur2Unchanged: true, ur4OnlyCatalogMetadata: true,
}, null, 2) + '\n');
console.log(JSON.stringify(comparisons, null, 2));
assert(comparisons.every(c => c.remainingDifferences.length === 0), 'UR3 has unattributed fields');
