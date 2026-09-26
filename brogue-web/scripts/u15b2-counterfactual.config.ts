import fs from 'node:fs';
import {defineConfig} from 'vitest/config';
const variant=process.env.U15B2_VARIANT;
export default defineConfig({plugins:[{name:'u15b2-negative',enforce:'pre',load(id){
    if(!/\/src\/(engine|data)\/.*\.(ts|json)$/.test(id))return;
    let s=fs.readFileSync(id,'utf8');const file=id.split('/').at(-1);
    const replace=(a:string,b:string)=>{if(!s.includes(a))throw Error(`Missing mutation: ${variant}`);s=s.replace(a,b);};
    if(file==='ItemLoader.ts'){
        if(variant==='no-birth')replace('ring.enchantment = rng.randClumpedRange(1, 3, 1);','ring.enchantment = 0;');
        if(variant==='no-curse')replace('if (rng.randPercent(16)) {','if (rng.randPercent(0)) {');
        if(variant==='double-birth')replace('const ring = this.spawnRing(id, x, y);','this.spawnRing(id, x, y); const ring = this.spawnRing(id, x, y);');
    }
    if(file==='arcana.json'&&variant==='wrong-order'){
        const data=JSON.parse(s);[data.rings[0],data.rings[1]]=[data.rings[1],data.rings[0]];s=JSON.stringify(data);
    }
    if(file==='RingBonuses.ts'){
        if(variant==='uncapped-e')replace('return ring.isIdentified ? ring.enchantment','return true ? ring.enchantment');
        if(variant==='zero-light')replace('multiplier <= 0 ? multiplier - 1 : multiplier','multiplier');
    }
    if(file==='Game.ts'&&variant==='no-light')replace('lightMultiplier: ringLightMultiplier(this.player.rings()),','lightMultiplier: 1,');
    if(file==='LightCatalog.ts'&&variant==='float-darkness')s=s.replaceAll('Math.trunc(FP_FACTOR / 20)','FP_FACTOR / 20');
    if(file==='Combat.ts'){
        if(variant==='no-reaping')replace("const reaping = ringBonus(attacker.rings(), 'ring_of_reaping');",'const reaping = 0;');
        if(variant==='no-hp-cap')replace('Math.min(damage, defender.hp) * reaping','damage * reaping');
        if(variant==='after-shield')replace('Math.min(damage, defender.hp) * reaping','Math.min(Math.max(0, damage - defender.getStatusDuration(\'shielded\') / 10), defender.hp) * reaping');
        if(variant==='drain-positive')replace('rng.randRange(bound, 0)','rng.randRange(0, -bound)');
    }
    if(file==='ArcanaRecharge.ts'){
        if(variant==='wide-timer')replace('remaining = (remaining - increment << 16) >> 16;','remaining -= increment;');
        if(variant==='no-staff-drain')replace('|| (item.charges > 0 && increment < 0)','|| false');
        if(variant==='drain-ready-charm')replace('(item.cooldownRemaining ?? 0) > 0','(item.cooldownRemaining ?? 0) >= 0');
        if(variant==='wisdom-charm')replace('item.cooldownRemaining! - multiplier','item.cooldownRemaining! - multiplier * ringWisdomRechargeIncrement(wisdom)');
    }
    return s;
}}],test:{testTimeout:120000}});
