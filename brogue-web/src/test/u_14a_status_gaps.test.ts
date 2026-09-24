import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Player } from '../entities/Player';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import { type Creature } from '../entities/Creature';
import { Game } from '../engine/Core/Game';
import { CombatSystem } from '../engine/Combat/Combat';
import { monsterDamageAdjustmentAmount, monsterAccuracyAdjusted, monsterDefenseAdjusted, strengthModifier, netEnchant, playerDefense } from '../engine/Combat/CombatFormulas';
import { projectileReflects } from '../engine/Combat/BoltReflection';
import { negateCreatureStatusEffects, negationWillAffectMonster } from '../engine/Combat/Negation';
import { creatureStatusRows } from '../engine/Status/statusConfig';
import { generateMonsterDetail } from '../engine/UI/DetailGenerator';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { TerrainType as T, DungeonLayer } from '../engine/Map/Grid';
import { rng } from '../engine/Random';
import monsters from '../data/monsters.json';
import { createHeadlessGame } from './harness';
const golden = JSON.parse(readFileSync('ai_docs/reports/u-14a-evidence/ce-weakness.json','utf8')) as Array<Record<string,number>>;
const mob = (id='rat',x=12,y=8) => { const m=new Monster(x,y,(monsters as MonsterData[]).find(d=>d.id===id)!); m.state=MonsterState.HUNTING; return m; };
function scene() {
    const g=createHeadlessGame(1414,'test'); g.monsters=[];g.dormantMonsters=[];g.items=[];g.animationEnabled=false;
    for(let x=2;x<30;x++)for(let y=2;y<20;y++) {g.grid.setTerrain(x,y,T.FLOOR);g.grid.getCell(x,y)!.layers[DungeonLayer.GAS]=T.NOTHING;}
    g.player.loc={x:8,y:8};g.player.hp=g.player.maxHp=100;g.player.equippedWeapon=null;g.player.equippedArmor=null;
    return g;
}
const wait=(g:Game)=>g.handlePlayerAction('wait',undefined,'system');
const step=(g:Game)=>g.handlePlayerAction('move',{x:1,y:0},'system');
const applyAll=(c:Creature)=>{ c.weaken(300);c.weaken(200);c.applyStatus('nauseous',20);c.applyStatus('darkness',15);c.applyStatus('magical_fear',12); };
afterEach(()=>vi.restoreAllMocks());

describe('U14a compiled CE weakness goldens and actual combat',()=>{
    it.each(golden)('all consumers, weakness=$weakness',r=>{
        const w=r.weakness!;
        expect(monsterDamageAdjustmentAmount(w)*65536).toBe(r.damageFP);
        expect(monsterAccuracyAdjusted(120,w)).toBe(r.accuracy);
        expect(monsterDefenseAdjusted(160,w)).toBe(r.defense);
        expect(strengthModifier(18-w,17)*65536).toBe(r.strengthModifierFP);
        expect(netEnchant(2,18-w,17)*65536).toBe(r.netEnchantFP);
        expect(playerDefense(4,2,18-w,17)).toBe(r.playerDefense);
        const p=new Player(8,8),m=mob();p.strength=18;p.weaknessAmount=w;p.hp=p.maxHp=1000;
        const weapon=ItemLoader.spawnWeapon('sword',0,0)!;Object.assign(weapon,{damage:'10-20',clumping:2,strengthRequired:17,enchantment:2,runicType:undefined});p.equippedWeapon=weapon;m.isCaged=true;m.hp=m.maxHp=1000;
        const roll=vi.spyOn(rng,'randRange').mockImplementation(lo=>lo);
        expect(CombatSystem.attack(p,m).damage).toBe(r.weaponLow);
        roll.mockImplementation((_lo,hi)=>hi);expect(CombatSystem.attack(p,m).damage).toBe(r.weaponHigh);
        const g=Object.create(Game.prototype) as Game;g.player=p;
        expect((g as any).throwMaxDistance()).toBe(r.throwDistance);
        p.equippedWeapon=null;m.isCaged=false;m.damageString='20';m.weaknessAmount=w;m.accuracy=120;
        const chance=vi.spyOn(rng,'randPercent').mockReturnValue(true);
        expect(CombatSystem.attack(m,p).damage).toBe(Math.trunc(20*r.damageFP!/65536));
        expect(chance).toHaveBeenLastCalledWith(Math.min(100,r.accuracy!));
    });
    it('repeat doses cap at ten, refresh both maxima, expiration clears layers',()=>{
        const p=new Player(0,0);for(let i=0;i<12;i++)p.weaken(30);
        expect(p.weaknessAmount).toBe(10);p.tickStatuses();p.weaken(10);
        expect(p.statusDurations.weakened).toBe(29);expect(p.maxStatus.weakened).toBe(30);
        p.weaken(80);expect(p.statusDurations.weakened).toBe(80);expect(p.maxStatus.weakened).toBe(80);
        p.setStatusDuration('weakened',1);p.tickStatuses();expect(p.weaknessAmount).toBe(0);expect(p.effectiveStrength).toBe(12);
    });
    it.each(['player','monster','shielded','inanimate','killed'] as const)('CE contact weakness: %s',target=>{
        const m=mob('centipede'),d=target==='player'?new Player(1,1):mob();d.hp=d.maxHp=500;
        if(target==='shielded')d.applyShield(5000);
        if(target==='killed')d.hp=1;
        if(target==='inanimate')(d as Monster).behaviorFlags.add('MONST_INANIMATE');
        vi.spyOn(rng,'randPercent').mockReturnValue(true);
        CombatSystem.attack(m,d);CombatSystem.attack(m,d);
        expect(d.weaknessAmount).toBe(target==='inanimate'||target==='killed'?0:2);
        expect(d.getStatusDuration('weakened')).toBe(target==='inanimate'||target==='killed'?0:300);
    });
    it('strength potion clears layers immediately, keeps countdown one until tick',()=>{
        const g=scene();g.player.weaken(300);g.player.weaken(300);const p=ItemLoader.spawnPotion('potion_of_strength',0,0)!;g.player.inventory.addItem(p);
        vi.spyOn(g as any,'playerTurnEnded').mockImplementation(()=>{});g.quaffItem(p);
        expect(g.player.strength).toBe(13);expect(g.player.weaknessAmount).toBe(0);expect(g.player.getStatusDuration('weakened')).toBe(1);
    });
});

describe('U14a carriers, healing, negation and clocks',()=>{
    it.each([1,2])('panacea preserves weakness at one, clears it above one (%i)',duration=>{
        const p=new Player(0,0);applyAll(p);p.setStatusDuration('weakened',duration);p.heal(100,true);
        expect(p.weaknessAmount).toBe(duration===1?2:0);expect(p.getStatusDuration('weakened')).toBe(duration===1?1:0);
        expect(p.getStatusDuration('nauseous')).toBe(1);expect(p.hasStatus('darkness')).toBe(false);expect(p.getStatusDuration('magical_fear')).toBe(12);
    });
    it.each([false,true])('catalog negation player=%s',isPlayer=>{
        const c=isPlayer?new Player(0,0):mob();applyAll(c);negateCreatureStatusEffects(c,isPlayer);
        expect(c.getStatusDuration('weakened')).toBe(300);expect(c.weaknessAmount).toBe(2);expect(c.getStatusDuration('nauseous')).toBe(20);
        expect(c.hasStatus('magical_fear')).toBe(false);expect(c.hasStatus('darkness')).toBe(false);
        if(c instanceof Monster)expect(c.state).toBe(MonsterState.FLEEING); // CE negation does not reset AI state.
    });
    it('refresh rules preserve darkness historical max and refresh nausea max to current',()=>{
        const p=new Player(0,0);p.applyStatus('darkness',20);p.applyStatus('nauseous',30);p.tickStatuses();p.applyStatus('darkness',5);p.applyStatus('nauseous',20);
        expect(p.maxStatus.darkness).toBe(20);expect(p.getStatusDuration('darkness')).toBe(19);expect(p.maxStatus.nauseous).toBe(29);
        p.applyStatus('darkness',40);expect(p.maxStatus.darkness).toBe(40);
    });
    it.each(['weakened','nauseous','darkness','magical_fear'] as const)('%s runs on objective time for both actors',id=>{
        const g=scene(),m=mob();g.monsters.push(m);m.ticksUntilTurn=100000;
        g.player.applyStatus(id,10);m.applyStatus(id,10);g.player.applyStatus('hasted',20);
        wait(g);expect(g.player.getStatusDuration(id)).toBe(10);expect(m.getStatusDuration(id)).toBe(10);
        wait(g);expect(g.player.getStatusDuration(id)).toBe(9);expect(m.getStatusDuration(id)).toBe(9);
        g.player.setStatusDuration('hasted',0);g.player.applyStatus('slowed',20);g.player.refreshSpeeds();
        wait(g);expect(g.player.getStatusDuration(id)).toBe(7);expect(m.getStatusDuration(id)).toBe(7);
    });
    it('darkness never changes the miner light/FOV input in U14a',()=>{
        const g=scene();(g as any).updateVision();const before=JSON.stringify(g.lightMap);
        g.player.applyStatus('darkness',50);(g as any).updateVision();expect(JSON.stringify(g.lightMap)).toBe(before);
        g.player.setStatusDuration('darkness',1);g.player.tickStatuses();expect(g.player.hasStatus('darkness')).toBe(false);
    });
});

describe('U14a nausea physical intent and real stench source',()=>{
    it.each(['player','visible sleeper','hidden sleeper','inanimate','invulnerable','respiration'] as const)('terrain exposure: %s',kind=>{
        const g=scene(),m=mob('rat',8,8),c=kind==='player'||kind==='respiration'?g.player:m;g.monsters.push(m);m.state=MonsterState.ASLEEP;
        if(kind==='visible sleeper')g.visibleMonsters.add(m);
        if(kind==='inanimate')m.behaviorFlags.add('MONST_INANIMATE');if(kind==='invulnerable')m.behaviorFlags.add('MONST_INVULNERABLE');
        if(kind==='respiration'){g.player.equippedArmor=ItemLoader.spawnArmor('leather_armor',0,0)!;g.player.equippedArmor.runicType='respiration';}
        g.grid.getCell(8,8)!.layers[DungeonLayer.GAS]=T.STENCH_SMOKE_GAS;g.grid.getCell(8,8)!.volume=0;
        (g as any).applyEnvironmentalEffects(c);
        const exempt=['inanimate','invulnerable','respiration'].includes(kind);
        expect(c.getStatusDuration('nauseous')).toBe(exempt?0:20);
        expect(m.state).toBe(kind==='visible sleeper'?MonsterState.HUNTING:MonsterState.ASLEEP);
    });
    it.each(['move','melee','entranced'] as const)('vomit replaces %s with movement time and DF, not damage',kind=>{
        const g=scene();g.player.applyStatus('nauseous',20);const m=mob('rat',9,8);if(kind==='melee')g.monsters.push(m);
        const before={pos:{...g.player.loc},hp:g.player.hp,nutrition:g.player.nutrition,turn:g.stats.turns};
        const chance=vi.spyOn(rng,'randPercent').mockImplementation(n=>n===25);
        if(kind==='entranced'){m.applyStatus('nauseous',20);m.applyStatus('entranced',10);g.monsters=[m];m.moveEntranced(g,1,0);expect(m.loc).toEqual({x:9,y:8});expect(m.ticksUntilTurn).toBe(m.movementSpeed);}
        else {m.ticksUntilTurn=100000;step(g);expect(g.player.loc).toEqual(before.pos);expect(g.player.hp).toBe(before.hp);expect(g.stats.turns).toBe(before.turn+1);expect(g.player.nutrition).toBe(before.nutrition-1);}
        expect(chance.mock.calls.filter(([n])=>n===25)).toHaveLength(1);
        expect(g.grid.getCell(kind==='entranced'?9:8,8)!.layers).toContain(T.VOMIT);
    });
    it('no vomit check for rest or failed wall move; failed nausea roll permits movement',()=>{
        const g=scene();g.player.applyStatus('nauseous',20);const chance=vi.spyOn(rng,'randPercent').mockReturnValue(false);
        wait(g);g.grid.setTerrain(9,8,T.WALL);step(g);expect(chance.mock.calls.some(([n])=>n===25)).toBe(false);
        g.grid.setTerrain(9,8,T.FLOOR);step(g);expect(g.player.x).toBe(9);expect(chance.mock.calls.filter(([n])=>n===25)).toHaveLength(1);
    });
    it('monster physical intent vomits before melee and moving, not spell dispatch',()=>{
        const g=scene(),m=mob('rat',9,8);g.monsters=[m];m.applyStatus('nauseous',20);m.hp=m.maxHp=100;
        vi.spyOn(rng,'randPercent').mockImplementation(n=>n===25);const attack=vi.spyOn(CombatSystem,'attack');m.takeTurn(g,20);
        expect(attack).not.toHaveBeenCalled();expect(m.loc).toEqual({x:9,y:8});expect(m.ticksUntilTurn).toBe(100);
        m.loc={x:12,y:8};(m as any).tryMoveTo(11,8,g);expect(m.x).toBe(12);
        const cast=vi.spyOn(m as any,'tryUseBolt').mockReturnValue(true);const vomit=vi.spyOn(g,'tryVomit');m.takeTurn(g,20);expect(cast).toHaveBeenCalled();expect(vomit).not.toHaveBeenCalled();
    });
});

describe('U14a fear lifecycle and persistence/display',()=>{
    it('fear cannot recover from full HP or attack when cornered; ordinary fleeing can',()=>{
        const g=scene(),m=mob('rat',9,8);g.monsters=[m];m.applyStatus('magical_fear',10);
        for(let x=8;x<=10;x++)for(let y=7;y<=9;y++)if(!(x===8&&y===8)&&!(x===9&&y===8))g.grid.setTerrain(x,y,T.WALL);
        const attack=vi.spyOn(CombatSystem,'attack');m.takeTurn(g,20);expect(m.state).toBe(MonsterState.FLEEING);expect(attack).not.toHaveBeenCalled();
        m.setStatusDuration('magical_fear',0);m.takeTurn(g,20);expect(attack).toHaveBeenCalled();
    });
    it('fear refresh, expiry and ally restoration; ordinary fleeing is untouched by status ticks',()=>{
        const m=mob();m.isAlly=true;m.applyStatus('magical_fear',2);m.applyStatus('magical_fear',1);expect(m.getStatusDuration('magical_fear')).toBe(2);
        m.tickStatuses();expect(m.state).toBe(MonsterState.FLEEING);m.tickStatuses();expect(m.state).toBe(MonsterState.HUNTING);expect(m.isAlly).toBe(true);
        m.state=MonsterState.FLEEING;m.tickStatuses();expect(m.state).toBe(MonsterState.FLEEING);
    });
    it('melee misses shorten fear to one, environmental damage does not',()=>{
        const m=mob(),p=new Player(0,0);m.applyStatus('magical_fear',20);m.takeDamage(1);expect(m.getStatusDuration('magical_fear')).toBe(20);
        vi.spyOn(rng,'randPercent').mockReturnValue(false);CombatSystem.attack(p,m);expect(m.getStatusDuration('magical_fear')).toBe(1);
    });
    it('thrown misses shorten fear and alert target; normal fleeing remains',()=>{
        const m=mob(),p=new Player(0,0),dart=ItemLoader.spawnWeapon('dart',0,0)!;m.applyStatus('magical_fear',20);
        vi.spyOn(rng,'randPercent').mockReturnValue(false);CombatSystem.resolveThrownWeapon(p,m,dart);expect(m.getStatusDuration('magical_fear')).toBe(1);expect(m.state).toBe(MonsterState.HUNTING);
        m.setStatusDuration('magical_fear',0);m.state=MonsterState.FLEEING;CombatSystem.resolveThrownWeapon(p,m,dart);expect(m.state).toBe(MonsterState.FLEEING);
    });
    it('direct monster bolt clears magical fear but preserves ordinary fleeing; auto-negation sees fear',()=>{
        const g=scene(),caster=mob('rat',10,8),target=mob('rat',14,8);g.monsters=[caster,target];target.hp=target.maxHp=100;target.applyStatus('magical_fear',20);
        expect(negationWillAffectMonster(target)).toBe(true);g.castMonsterBolt(caster,target,'SPARK');expect(target.hasStatus('magical_fear')).toBe(false);expect(target.state).toBe(MonsterState.HUNTING);
        target.state=MonsterState.FLEEING;g.castMonsterBolt(caster,target,'SPARK');expect(target.state).toBe(MonsterState.FLEEING);
    });
    it('player, active/dormant monsters and clones round-trip amounts and independent maxStatus',()=>{
        const g=scene(),m=mob(),d=mob('rat',18,8);applyAll(g.player);applyAll(m);applyAll(d);d.isDormant=true;g.monsters=[m];g.dormantMonsters=[d];
        const clone=g.cloneMonster(m)!;expect(clone.weaknessAmount).toBe(2);clone.maxStatus.darkness=99;expect(m.maxStatus.darkness).toBe(15);
        const playerClone=g.cloneMonster(g.player)!;expect(playerClone.weaknessAmount).toBe(2);playerClone.maxStatus.nauseous=99;expect(g.player.maxStatus.nauseous).toBe(20);
        const saved=JSON.parse(JSON.stringify(g.toSnapshot()));const restored=scene();expect(restored.loadSnapshot(saved)).toBe(true);
        expect(restored.player.weaknessAmount).toBe(2);expect(restored.player.maxStatus).toEqual(g.player.maxStatus);expect(restored.player.statusDurations).toEqual(g.player.statusDurations);
        expect(restored.monsters.find(c=>c.id===m.id)!.maxStatus).toEqual(m.maxStatus);expect(restored.dormantMonsters[0]!.weaknessAmount).toBe(2);
        const rows=creatureStatusRows(restored.player);expect(rows.map(r=>r.label)).toEqual(['虚弱 -2','恶心','黑暗','魔法恐惧']);expect(rows[0]!.value).toBe('300/300');
        const detail=JSON.stringify(generateMonsterDetail(m,100,12,0,null,0,12));expect(detail).toContain('虚弱 -2');expect(detail).toContain('魔法恐惧');
        restored.player.setStatusDuration('weakened',1);restored.player.tickStatuses();expect(restored.player.effectiveStrength).toBe(12);
    });
    it('CE fear source is commented; do not invent fear scroll or darkness potion catalog entry',()=>{
        const ce=readFileSync('../BrogueCE-master/src/brogue/Items.c','utf8');expect(ce).toContain('//void causeFear(');
        expect(ItemLoader.potions.find(p=>p.id==='potion_of_darkness')).toBeUndefined();
        expect(ItemLoader.scrolls.find(p=>p.id==='scroll_of_fear')).toBeUndefined();
    });
});


describe('U14a integration boundaries',()=>{
    it('weakness immediately feeds the reflection armor enchantment',()=>{
        const p=new Player(0,0);p.strength=12;p.equippedArmor=ItemLoader.spawnArmor('leather_armor',0,0)!;
        Object.assign(p.equippedArmor,{strengthRequired:12,enchantment:2,runicType:'reflection'});
        const roll=vi.spyOn(rng,'randPercent').mockReturnValue(true);expect(projectileReflects(p)).toBe(true);
        roll.mockClear();p.weaken(300);expect(projectileReflects(p)).toBe(false);expect(roll).not.toHaveBeenCalled();
    });
    it('objective stench contact is before monster decay and after player decay',()=>{
        const g=scene(),m=mob();g.monsters=[m];m.ticksUntilTurn=100000;
        for(const c of [g.player,m]) {const cell=g.grid.getCell(c.x,c.y)!;cell.layers[DungeonLayer.GAS]=T.STENCH_SMOKE_GAS;cell.volume=50;}
        vi.spyOn(g.environment,'updateGases').mockImplementation(()=>{});wait(g);
        expect(g.player.getStatusDuration('nauseous')).toBe(20);expect(m.getStatusDuration('nauseous')).toBe(19);
        expect(g.player.maxStatus.nauseous).toBe(20);expect(m.maxStatus.nauseous).toBe(20);
    });
    it('magical fleeing permits summoning but cannot cast attack bolts',()=>{
        const g=scene(),m=mob();g.monsters=[m];m.applyStatus('magical_fear',12);
        const summon=vi.spyOn(m as any,'trySummon').mockReturnValue(false),bolt=vi.spyOn(m as any,'tryUseBolt').mockReturnValue(true);
        m.takeTurn(g,20);expect(summon).toHaveBeenCalled();expect(bolt).not.toHaveBeenCalled();
    });
});
