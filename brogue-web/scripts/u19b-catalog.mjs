import fs from 'node:fs';import crypto from 'node:crypto';
const file='../BrogueCE-master/src/variants/GlobalsBrogue.c',source=fs.readFileSync(file,'utf8'),web=JSON.parse(fs.readFileSync('src/data/blueprints.json','utf8'));
let ce=0,index=0,active=false;const rows=[];
for(const [i,line] of source.split('\n').entries()){
 if(line.startsWith('const blueprint blueprintCatalog_Brogue'))active=true;
 if(!active)continue;if(line.startsWith('};'))break;
 if(/^    \{"/.test(line)){ce++;index=0;}
 if(/^        \{/.test(line)){rows.push({ce,index,line:i+1,flags:line.match(/MF_[A-Z_]+/g)??[],literal:line.trim()});index++;}
}
const machines=web.filter(bp=>Number.isInteger(bp.ceBlueprintId)).map(bp=>{
 const sources=rows.filter(r=>r.ce===bp.ceBlueprintId),producers=bp.features.flatMap((f,i)=>f.flags.includes('MF_GENERATE_ITEM')||f.flags.includes('MF_ADOPT_ITEM')||f.flags.includes('MF_GENERATE_HORDE')||f.monsterId?[{feature:i,ground:!!((f.flags.includes('MF_GENERATE_ITEM')||f.flags.includes('MF_ADOPT_ITEM'))&&!f.flags.includes('MF_OUTSOURCE_ITEM_TO_MACHINE')&&!f.flags.includes('MF_MONSTER_TAKE_ITEM')),monster:!!(f.flags.includes('MF_GENERATE_HORDE')||f.monsterId),dormant:f.flags.includes('MF_MONSTERS_DORMANT'),laterFeatures:bp.features.slice(i+1).map((_,j)=>i+j+1),literal:sources.find(r=>r.index===i)}]:[]);
 return {ce:bp.ceBlueprintId,id:bp.id,frequency:bp.frequency,flags:bp.flags,producers,vestibuleFeatures:bp.features.flatMap((f,i)=>f.flags.includes('MF_BUILD_VESTIBULE')?[i]:[]),clearMembership:bp.flags.includes('BP_NO_INTERIOR_FLAG')};
});
const result={file,sha256:crypto.createHash('sha256').update(source).digest('hex'),machines:machines.filter(m=>m.producers.length||m.flags.includes('BP_VESTIBULE'))};
fs.writeFileSync('ai_docs/reports/u-19b-evidence/catalog.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({producersWithLaterScan:machines.filter(m=>m.producers.some(p=>p.laterFeatures.length)).map(m=>m.ce),vestibule:machines.filter(m=>m.flags.includes('BP_VESTIBULE')).map(m=>m.ce),rewardWithVestibule:machines.filter(m=>m.vestibuleFeatures.length).map(m=>m.ce),clearMembership:machines.filter(m=>m.clearMembership&&m.producers.length).map(m=>m.ce)},null,2));
