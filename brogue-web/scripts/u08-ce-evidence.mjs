// Read-only source evidence. This records local CE authority, not a CE runtime oracle.
import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const root='../BrogueCE-master/src/',dir='ai_docs/reports/u-08-evidence';
const specs={
 'variants/GlobalsBrogue.c':[[83,88]],
 'brogue/Globals.c':[[470,470],[525,526],[681,685],[1067,1068],[1163,1164]],
 'brogue/Monsters.c':[[2544,2575],[2596,2676],[2786,2815],[1834,1842]],
 'brogue/Items.c':[[5419,5468],[5561,5565],[5665,5712],[5787,5811],[5870,5874]],
 'brogue/Architect.c':[[3210,3276],[3278,3330],[3389,3412]],
 'brogue/Time.c':[[290,341],[592,640],[1619,1664]],
 'brogue/Movement.c':[[1397,1425]],
 'brogue/Rogue.h':[[1526,1540]],
};
const evidence={};for(const[f,ranges]of Object.entries(specs)){
 const raw=fs.readFileSync(root+f,'utf8'),lines=raw.split('\n');
 evidence[f]={sha256:crypto.createHash('sha256').update(raw).digest('hex'),excerpts:ranges.map(([a,b])=>({from:a,to:b,text:lines.slice(a-1,b).join('\n')}))};
}
const bolts=fs.readFileSync(root+'variants/GlobalsBrogue.c','utf8').split('\n');
assert(bolts[82].includes('DF_WEB_SMALL, DF_WEB_LARGE'));assert(bolts[87].includes('DF_ANCIENT_SPIRIT_GRASS, DF_ANCIENT_SPIRIT_VINES'));
assert(bolts[82].includes('BF_NOT_LEARNABLE'));assert(!bolts[87].includes('BF_NOT_LEARNABLE'));
fs.writeFileSync(dir+'/ce-source.json',JSON.stringify(evidence,null,2)+'\n');console.log('CE source excerpts and SHA-256 recorded; both bolt rows verified.');
