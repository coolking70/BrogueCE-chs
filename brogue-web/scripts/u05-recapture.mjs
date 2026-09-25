import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const dir='ai_docs/reports/u-05-evidence',fixture='src/test/fixtures/generation_baseline.json';
const read=n=>JSON.parse(fs.readFileSync(`${dir}/${n}.json`));
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
assert.ok(!fs.existsSync(`${dir}/recapture.json`),'One recapture only');
assert.deepEqual(read('drift-attribution').controlDiff,[]);assert.deepEqual(read('drift-attribution').problems,[]);
assert.equal(read('new-tests').success,true);assert.equal(read('counterfactual').negativeControlsCaught,true);
assert.equal(hash(fixture),hash(`${dir}/baseline-before.json`));
const before=hash(fixture);fs.copyFileSync(`${dir}/baseline-candidate.json`,fixture);
fs.writeFileSync(`${dir}/recapture.json`,JSON.stringify({at:new Date().toISOString(),beforeSHA256:before,afterSHA256:hash(fixture),
 attributionSHA256:hash(`${dir}/drift-attribution.json`),independentGuardsSHA256:hash(`${dir}/new-tests.json`),
 counterfactualSHA256:hash(`${dir}/counterfactual.json`),preservedGuard:'t_1_tail AD-A3 remains unchanged pending review'},null,2)+'\n');
console.log(fs.readFileSync(`${dir}/recapture.json`,'utf8'));
