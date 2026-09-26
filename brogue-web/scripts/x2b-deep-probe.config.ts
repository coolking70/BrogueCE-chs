import fs from 'node:fs';
import {defineConfig} from 'vitest/config';
export default defineConfig({plugins:[{name:'x2b-deep-probe',enforce:'pre',load(id){
 if(!id.endsWith('/u_26a_deep_levels.test.ts'))return;
 return fs.readFileSync(id,'utf8').replace("                g.handlePlayerAction('pickup');", "                console.log('X2B_PICKUP_BEFORE',JSON.stringify({depth:d,player:g.player.toSnapshot?.()??g.player,loot:item}));g.handlePlayerAction('pickup'); console.log('X2B_PICKUP_AFTER',JSON.stringify({depth:g.depth,player:g.player.toSnapshot?.()??g.player,itemPresent:g.items.includes(item)}));");
}}],test:{testTimeout:900000,hookTimeout:120000}});
