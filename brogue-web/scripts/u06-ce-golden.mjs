// Compile the current local CE functions verbatim; enumerate every dice tuple.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const dir = 'ai_docs/reports/u-06-evidence';
fs.mkdirSync(dir, { recursive: true });
const read = n => fs.readFileSync(`../BrogueCE-master/src/brogue/${n}`, 'utf8');
const fn = (s, sig) => {
    const start = s.indexOf(sig); assert(start >= 0, sig);
    const o = s.indexOf('{', start); let depth = 1, i = o + 1;
    for (; depth; i++) { if (s[i] === '{') depth++; if (s[i] === '}') depth--; }
    return s.slice(start, i);
};
const header = read('Rogue.h');
const c = `#include <stdio.h>
${header.match(/^typedef .* fixpt;/m)[0]}
${header.match(/^#define FP_BASE .*$/m)[0]}
${header.match(/^#define FP_FACTOR .*$/m)[0]}
long tuple; int calls, lows[16], highs[16];
long rand_range(long lo, long hi) {
    lows[calls]=lo; highs[calls++]=hi;
    long n=lo+tuple%(hi-lo+1); tuple/=hi-lo+1; return n;
}
${fn(read('Math.c'), 'short randClumpedRange(')}
${fn(read('PowerTables.c'), 'short staffDamageLow(')}
${fn(read('PowerTables.c'), 'short staffDamageHigh(')}
${fn(read('PowerTables.c'), 'short staffDamage(')}
int main(void) {
    int magnitudes[]={1,4,18};
    for(int i=0;i<3;i++) {
        int e=magnitudes[i], counts[256]={0}; calls=0; tuple=0;
        int low=staffDamage(e*FP_FACTOR); long total=1; int dice=calls;
        printf("%d %d %d %d",e,staffDamageLow(e*FP_FACTOR),staffDamageHigh(e*FP_FACTOR),dice);
        for(int j=0;j<dice;j++){total*=highs[j]-lows[j]+1;printf(" %d %d",lows[j],highs[j]);}
        for(long n=0;n<total;n++){tuple=n;calls=0;counts[staffDamage(e*FP_FACTOR)]++;}
        printf(" %ld",total);
        for(int v=low;v<=staffDamageHigh(e*FP_FACTOR);v++)printf(" %d",counts[v]);
        printf("\\n");
    }
}
`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'u06-ce-'));
try {
    fs.writeFileSync(`${tmp}/golden.c`, c);
    execFileSync('clang', ['-std=c11', '-Wall', '-Werror', `${tmp}/golden.c`, '-o', `${tmp}/golden`]);
    const output = execFileSync(`${tmp}/golden`, { encoding: 'utf8' });
    const rows = output.trim().split('\n').map(line => {
        const [magnitude, low, high, clumps, ...tail] = line.split(' ').map(Number);
        const dice = Array.from({ length: clumps }, (_, i) => tail.slice(2 * i, 2 * i + 2));
        const combinations = tail[2 * clumps], weights = tail.slice(2 * clumps + 1);
        assert.equal(weights.length, high - low + 1); assert.equal(weights.reduce((a, b) => a + b), combinations);
        return { magnitude, low, high, clumps, dice, combinations, weights };
    });
    assert.deepEqual(rows.map(r => [r.magnitude, r.low, r.high, r.clumps]), [[1, 2, 6, 1], [4, 4, 14, 2], [18, 15, 49, 7]]);
    fs.writeFileSync(`${dir}/ce-staff-damage.c`, c);
    fs.writeFileSync(`${dir}/ce-staff-damage.txt`, output);
    fs.writeFileSync(`${dir}/ce-staff-damage.json`, JSON.stringify(rows, null, 2) + '\n');
    console.log(JSON.stringify(rows));
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
