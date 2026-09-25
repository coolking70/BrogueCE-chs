// CE-only catalog oracle. Does not import the web implementation.
import fs from 'node:fs';import crypto from 'node:crypto';
const globals='../BrogueCE-master/src/brogue/Globals.c',header='../BrogueCE-master/src/brogue/Rogue.h';
const ce=fs.readFileSync(globals,'utf8'),h=fs.readFileSync(header,'utf8');
const flags={};
const value=s=>s.replace(/[()\s]/g,'').split('|').reduce((n,k)=>{
 if(/^\d+$/.test(k))return n|Number(k);if(!(k in flags))throw Error(`Unknown CE flag ${k}`);return n|flags[k];
},0);
for(const m of h.matchAll(/^\s*((?:T_|TM_|DFF_)\w+)\s*=\s*([^,\n]+),/gm)) flags[m[1]]=/^Fl\((\d+)\)$/.test(m[2])?1<<Number(m[2].match(/\d+/)[0]):value(m[2]);
const split=s=>s.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(s=>s.trim());
const names=['MACHINE_METHANE_VENT_DORMANT','MACHINE_METHANE_VENT','PILOT_LIGHT','MACHINE_PARALYSIS_VENT','MACHINE_POISON_GAS_VENT_DORMANT','MACHINE_POISON_GAS_VENT','GAS_TRAP_POISON','FLAMETHROWER','PILOT_LIGHT_DORMANT'];
const tiles={};
for(const name of names){
 const line=ce.split('\n').find(l=>l.includes(`/*${name}*/`));const fields=split(line.slice(line.indexOf('{')+1,line.lastIndexOf('}')));
 tiles[name]={line:ce.split('\n').indexOf(line)+1,drawPriority:+fields[3],chanceToIgnite:+fields[4],fireType:fields[5]==='0'?'':fields[5],discoverType:fields[6]==='0'?'':fields[6],promoteType:fields[7]==='0'?'':fields[7],promoteChance:+fields[8],glowLight:fields[9],flags:value(fields[10]),mechFlags:value(fields[11]),description:JSON.parse(fields[12]),flavorText:JSON.parse(fields[13])};
}
const enumBody=h.match(/enum dungeonFeatureTypes\s*\{([\s\S]*?)\};/)[1].replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,'');
const ids=['NOTHING', ...enumBody.split(',').map(x=>x.trim().replace(/\s*=.*$/,'')).filter(Boolean)];
const rows=ce.slice(ce.indexOf('dungeonFeatureCatalog')).split('\n').filter(l=>/^\s*\{/.test(l));
const dfs={};
for(const name of ['DF_SHOW_METHANE_VENT','DF_METHANE_VENT_OPEN','DF_PILOT_LIGHT','DF_DISCOVER_PARALYSIS_VENT','DF_REVEAL_PARALYSIS_VENT_SILENTLY','DF_SHOW_POISON_GAS_VENT','DF_POISON_GAS_VENT_OPEN','DF_SHOW_POISON_GAS_TRAP','DF_SHOW_FLAMETHROWER_TRAP','DF_VENT_SPEW_METHANE','DF_PARALYSIS_VENT_SPEW','DF_VENT_SPEW_POISON_GAS','DF_POISON_GAS_CLOUD','DF_FLAMETHROWER','DF_ARMOR_IMMOLATION']){
 const id=ids.indexOf(name);if(id<0)throw Error(name);const line=rows[id];const f=split(line.slice(line.indexOf('{')+1,line.lastIndexOf('}')));
 dfs[name]={id,tile:f[0]==='0'?'NOTHING':f[0],layer:f[1]==='0'?'DUNGEON':f[1],startProbability:+f[2],probabilityDecrement:+f[3],flags:value(f[4]??'0'),description:f[5]?JSON.parse(f[5]):'',lightFlare:f[6]&&f[6]!=='0'?f[6]:'',flashColor:f[7]&&f[7]!=='0'?f[7].replace(/^&/,''):'',effectRadius:+(f[8]??0),propagationTerrain:f[9]&&f[9]!=='0'?f[9]:'',subsequentDF:f[10]&&f[10]!=='0'?f[10]:null};
}
const output=JSON.stringify({sources:Object.fromEntries([globals,header].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),tiles,dfs},null,2)+'\n';
const file='src/test/fixtures/u17d-ce-catalog.json';
if(process.argv.includes('--check')){if(fs.readFileSync(file,'utf8')!==output)throw Error('stale CE catalog golden');}else fs.writeFileSync(file,output);
console.log('CE oracle: 9 tiles / 15 DF rows');
