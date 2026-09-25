import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createHeadlessGame } from '../src/test/harness';
import { Game } from '../src/engine/Core/Game';
const dir = 'ai_docs/reports/u-03-evidence';
const game = createHeadlessGame(7); game.animationEnabled = false;
const start = performance.now();
for (let depth = 2; depth <= 26; depth++) { game.depth = depth; (game as any).generateDepth(); }
const generationMs = performance.now() - start;
const results = [];
const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
for (let i = 0; i < 3; i++) {
    const a = performance.now(), snapshot = game.toSnapshot(), b = performance.now();
    const json = JSON.stringify(snapshot), c = performance.now();
    const parsed = JSON.parse(json), d = performance.now();
    assert.equal(game.loadSnapshot(parsed), true);
    const e = performance.now(), after = game.toSnapshot();
    delete (parsed as any).savedAt; delete (after as any).savedAt;
    assert.deepEqual(JSON.parse(JSON.stringify(after)), parsed);
    assert.equal(Game.isSnapshot(snapshot), true);
    results.push({ iteration: i, floors: snapshot.levels.length + 1,
        cells: [snapshot, ...snapshot.levels].reduce((n, l) => n + l.grid.length, 0),
        utf8Bytes: Buffer.byteLength(json), jsonCodeUnits: json.length,
        snapshotMs: b - a, stringifyMs: c - b, parseMs: d - c, restoreMs: e - d,
        stateSHA256: hash(JSON.stringify(parsed)), fullEquality: true });
}
fs.writeFileSync(`${dir}/measurement.json`, JSON.stringify({ seed: '7', generationMs, results }, null, 2) + '\n');
console.log(JSON.stringify({ generationMs, results }, null, 2));
