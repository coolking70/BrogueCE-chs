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
const names=['RAT_TRAP_WALL_CRACKING','STATUE_CRACKING','COFFIN_OPEN','WORM_TUNNEL_MARKER_ACTIVE','FLOOR_FLOODABLE','PORTAL_LIGHT'];
const tiles={};
for(const name of names){
 const line=ce.split('\n').find(l=>l.includes(`/*${name}*/`));const fields=split(line.slice(line.indexOf('{')+1,line.lastIndexOf('}')));
 tiles[name]={line:ce.split('\n').indexOf(line)+1,drawPriority:+fields[3],chanceToIgnite:+fields[4],fireType:fields[5]==='0'?'':fields[5],discoverType:fields[6]==='0'?'':fields[6],promoteType:fields[7]==='0'?'':fields[7],promoteChance:+fields[8],glowLight:fields[9],flags:value(fields[10]),mechFlags:value(fields[11]),description:JSON.parse(fields[12]),flavorText:JSON.parse(fields[13])};
}
const enumBody=h.match(/enum dungeonFeatureTypes\s*\{([\s\S]*?)\};/)[1].replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,'');
const ids=['NOTHING', ...enumBody.split(',').map(x=>x.trim().replace(/\s*=.*$/,'')).filter(Boolean)];
const rows=ce.slice(ce.indexOf('dungeonFeatureCatalog')).split('\n').filter(l=>/^\s*\{/.test(l));
const dfs={};
for(const name of ['DF_WALL_CRACK','DF_CRACKING_STATUE','DF_COFFIN_BURSTS','DF_WORM_TUNNEL_MARKER_ACTIVE','DF_ALTAR_RETRACT','DF_PORTAL_ACTIVATE','DF_GRANITE_CRUMBLES','DF_TUNNELIZE','DF_RUBBLE','DF_STATUE_SHATTER','DF_WALL_SHATTER']){
 const id=ids.indexOf(name);if(id<0)throw Error(name);const line=rows[id];const f=split(line.slice(line.indexOf('{')+1,line.lastIndexOf('}')));
 dfs[name]={id,tile:f[0]==='0'?'NOTHING':f[0],layer:f[1]==='0'?'DUNGEON':f[1],startProbability:+f[2],probabilityDecrement:+f[3],flags:value(f[4]??'0'),description:f[5]?JSON.parse(f[5]):'',lightFlare:f[6]&&f[6]!=='0'?f[6]:'',flashColor:f[7]&&f[7]!=='0'?f[7].replace(/^&/,''):'',effectRadius:+(f[8]??0),propagationTerrain:f[9]&&f[9]!=='0'?f[9]:'',subsequentDF:f[10]&&f[10]!=='0'?f[10]:null};
}
const variants='../BrogueCE-master/src/variants/GlobalsBrogue.c';
const blueprintFeatures=[];let blueprint=0,index=0,active=false;
for(const [i,line] of fs.readFileSync(variants,'utf8').split('\n').entries()){
 if(line.startsWith('const blueprint blueprintCatalog_Brogue'))active=true;
 if(!active)continue;if(line.startsWith('};'))break;
 if(/^    \{"/.test(line)){blueprint++;index=0;}
 if(/^        \{/.test(line)){
  if([11,12,21,29,42,43,53,55,69].includes(blueprint)){
   const first=line.match(/\{\s*(\w+),\s*(\w+),/);
   blueprintFeatures.push({blueprint,index,line:i+1,terrain:first[2],featureDF:first[1]==='0'?null:first[1],
    itemFlags:line.match(/ITEM_[A-Z_]+/g)??[]});
  }index++;
 }
}
const output=JSON.stringify({sources:Object.fromEntries([globals,header,variants].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),tiles,dfs,blueprintFeatures},null,2)+'\n';
const file='src/test/fixtures/u17f-ce-catalog.json';
if(process.argv.includes('--check')){if(fs.readFileSync(file,'utf8')!==output)throw Error('stale CE catalog golden');}else fs.writeFileSync(file,output);
console.log('CE oracle: 6 tiles / 11 DF rows');
