// Independent oracle: only local CE C/H inputs; never reads web catalogs.
import fs from 'node:fs';
import crypto from 'node:crypto';
const files=['../BrogueCE-master/src/brogue/Globals.c','../BrogueCE-master/src/brogue/Rogue.h','../BrogueCE-master/src/variants/GlobalsBrogue.c'];
const [ce,h,variants]=files.map(f=>fs.readFileSync(f,'utf8'));
const flags={};
const value=s=>s.replace(/[()\s]/g,'').split('|').reduce((n,k)=>{
 if(/^\d+$/.test(k))return n|Number(k);if(!(k in flags))throw Error(`Unknown CE flag ${k}`);return n|flags[k];
},0);
for(const m of h.matchAll(/^\s*((?:T_|TM_|DFF_)\w+)\s*=\s*([^,\n]+),/gm)) flags[m[1]]=/^Fl\((\d+)\)$/.test(m[2])?1<<Number(m[2].match(/\d+/)[0]):value(m[2]);
const split=s=>s.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(s=>s.trim());
const number=s=>Number(s.trim().replace('DEEPEST_LEVEL-1','39').replace('DEEPEST_LEVEL','40').replace('AMULET_LEVEL','26').replace('DCOLS/2','39'));
const tileNames=['FUNGUS_FOREST','TRAMPLED_FUNGUS_FOREST','SUNLIGHT_POOL','DARKNESS_PATCH','DEEP_WATER_ALGAE_WELL','DEEP_WATER_ALGAE_1','DEEP_WATER_ALGAE_2','NET_TRAP','NET_TRAP_HIDDEN','NETTING','ALARM_TRAP','ALARM_TRAP_HIDDEN','GAS_TRAP_CONFUSION','GAS_TRAP_CONFUSION_HIDDEN','FLOOD_TRAP_HIDDEN','STEAM_VENT','DEWAR_CAUSTIC_GAS','DEWAR_CONFUSION_GAS','DEWAR_PARALYSIS_GAS','DEWAR_METHANE_GAS','BROKEN_GLASS'];
const tiles={};
for(const name of tileNames){
 const line=ce.split('\n').find(l=>l.includes(`/*${name}*/`));if(!line)throw Error(name);
 const f=split(line.slice(line.indexOf('{')+1,line.lastIndexOf('}')));
 tiles[name]={line:ce.split('\n').indexOf(line)+1,drawPriority:+f[3],chanceToIgnite:+f[4],fireType:f[5]==='0'?'':f[5],discoverType:f[6]==='0'?'':f[6],promoteType:f[7]==='0'?'':f[7],promoteChance:+f[8],glowLight:f[9],flags:value(f[10]),mechFlags:value(f[11]),description:JSON.parse(f[12]),flavorText:JSON.parse(f[13]),literal:f};
}
const enumBody=h.match(/enum dungeonFeatureTypes\s*\{([\s\S]*?)\};/)[1].replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,'');
const ids=['NOTHING',...enumBody.split(',').map(x=>x.trim().replace(/\s*=.*$/,'')).filter(Boolean)];
const block=ce.slice(ce.indexOf('dungeonFeature dungeonFeatureCatalog'));
const rows=block.slice(0,block.indexOf('\n};')).split('\n').filter(l=>/^\s*\{/.test(l));
const names=['DF_DEAD_GRASS','DF_FUNGUS_FOREST','DF_SUNLIGHT','DF_DARKNESS','DF_SHOW_CONFUSION_GAS_TRAP','DF_SHOW_FLOOD_TRAP','DF_SHOW_NET_TRAP','DF_SHOW_ALARM_TRAP','DF_STEAM_PUFF','DF_TRAMPLED_FUNGUS_FOREST','DF_FUNGUS_FOREST_REGROW','DF_DEWAR_CAUSTIC','DF_DEWAR_CONFUSION','DF_DEWAR_PARALYSIS','DF_DEWAR_METHANE','DF_DEWAR_GLASS','DF_CARPET_AREA','DF_BUILD_ALGAE_WELL','DF_ALGAE_1','DF_ALGAE_2','DF_ALGAE_REVERT','DF_CONFUSION_GAS_TRAP_CLOUD','DF_NET','DF_AGGRAVATE_TRAP'];
const dfs={};
for(const name of names){
 const id=ids.indexOf(name);if(id<0)throw Error(name);const line=rows[id],f=split(line.slice(line.indexOf('{')+1,line.lastIndexOf('}')));
 dfs[name]={id,line:ce.split('\n').indexOf(line)+1,tile:f[0]==='0'?'NOTHING':f[0],layer:f[1]==='0'?'DUNGEON':f[1],startProbability:+f[2],probabilityDecrement:+f[3],flags:value(f[4]??'0'),description:f[5]?JSON.parse(f[5]):'',lightFlare:f[6]&&f[6]!=='0'?f[6]:'',flashColor:f[7]&&f[7]!=='0'?f[7].replace(/^&/,''):'',effectRadius:number(f[8]??'0'),propagationTerrain:f[9]&&f[9]!=='0'?f[9]:'',subsequentDF:f[10]&&f[10]!=='0'?f[10]:null,literal:f};
}
const machineBlock=h.match(/enum machineTypes\s*\{([\s\S]*?)\};/)[1];
const machines=machineBlock.match(/\bMT_\w+/g);
const autogen=[];
const autoBlock=variants.slice(variants.indexOf('const autoGenerator autoGeneratorCatalog_Brogue'));
for(const l of autoBlock.slice(0,autoBlock.indexOf('\n};')).split('\n').filter(l=>/^    \{/.test(l))){
 const f=split(l.slice(l.indexOf('{')+1,l.lastIndexOf('}')));
 autogen.push({index:autogen.length,line:variants.split('\n').indexOf(l)+1,terrain:f[0],layer:f[1]==='0'?'DUNGEON':f[1],df:f[2],dfId:f[2]==='0'?0:ids.indexOf(f[2]),machine:f[3],machineId:f[3]==='0'?0:machines.indexOf(f[3])+1,foundation:f.slice(4,6),minDepth:number(f[6]),maxDepth:number(f[7]),frequency:+f[8],minNumberIntercept:+f[9],minNumberSlope:+f[10],maxNumber:+f[11]});
}
const output=JSON.stringify({sources:Object.fromEntries(files.map((f,i)=>[f,crypto.createHash('sha256').update([ce,h,variants][i]).digest('hex')])),tiles,dfs,autogen},null,2)+'\n';
const file='src/test/fixtures/u19f-ce-catalog.json';
if(process.argv.includes('--check')){if(fs.readFileSync(file,'utf8')!==output)throw Error('stale CE golden');}else fs.writeFileSync(file,output);
console.log(`${tileNames.length} tiles, ${names.length} DFs, ${autogen.length} autoGen rows`);
