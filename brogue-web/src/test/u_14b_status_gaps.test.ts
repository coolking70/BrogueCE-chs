import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Player } from '../entities/Player';
import { Creature } from '../entities/Creature';
import { Monster, MonsterState, specificallyValidBoltTarget, type MonsterData } from '../entities/Monster';
import { MONSTER_BOLT_TABLE } from '../engine/Combat/Bolt';
import { CombatSystem } from '../engine/Combat/Combat';
import { playerDefense, hitProbability } from '../engine/Combat/CombatFormulas';
import { blinkAllyFlees, monsterAvoidsCorridor, monsterBlinkAvoids } from '../engine/Combat/MonsterBlink';
import { negateCreatureStatusEffects } from '../engine/Combat/Negation';
import { creatureStatusRows } from '../engine/Status/statusConfig';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { TerrainType as T, DungeonLayer as L } from '../engine/Map/Grid';
import { rng } from '../engine/Random';
import { generateMonsterDetail } from '../engine/UI/DetailGenerator';
import monsters from '../data/monsters.json';
import { createHeadlessGame } from './harness';
const golden = JSON.parse(readFileSync('ai_docs/reports/u-14b-evidence/ce-donning.json', 'utf8')) as Array<Record<string, number>>;
const mob = (id='rat', x=12, y=8) => { const m = new Monster(x,y,(monsters as MonsterData[]).find(d=>d.id===id)!); m.state=MonsterState.HUNTING; return m; };
function scene() {
    const g=createHeadlessGame(1414,'test');g.monsters=[];g.dormantMonsters=[];g.items=[];g.animationEnabled=false;
    for(let x=2;x<30;x++)for(let y=2;y<20;y++) {g.grid.setTerrain(x,y,T.FLOOR);g.grid.getCell(x,y)!.layers[L.GAS]=T.NOTHING;}
    g.player.loc={x:8,y:8};g.player.hp=g.player.maxHp=100;g.player.equippedWeapon=null;g.player.equippedArmor=null;
    return g;
}
type Scene = ReturnType<typeof scene>;
const wait=(g:Scene)=>g.handlePlayerAction('wait',undefined,'system');
const step=(g:Scene)=>g.handlePlayerAction('move',{x:1,y:0},'system');
const web=(g:Scene,c:Creature,t=T.WEB)=>g.grid.setTerrainLayer(c.x,c.y,L.SURFACE,t);
const states=['stuck','donning','enraged','lifespan_remaining'] as const;
afterEach(()=>vi.restoreAllMocks());

describe('U14b STUCK is a counter with real terrain contact',()=>{
    it.each([3,7])('source draws 3–7 once and never refreshes (%i)',roll=>{
        const g=scene();web(g,g.player);const r=vi.spyOn(rng,'randRange').mockReturnValue(roll);
        g.applyEntanglementFromTerrain(g.player);expect(r).toHaveBeenCalledWith(3,7);
        expect(g.player.maxStatus.stuck).toBe(roll);g.player.setStatusDuration('stuck',2);
        g.applyEntanglementFromTerrain(g.player);expect(r).toHaveBeenCalledTimes(1);expect(g.player.getStatusDuration('stuck')).toBe(2);
        g.player.tickStatuses();expect(g.player.getStatusDuration('stuck')).toBe(2);
    });
    it.each(['ordinary','flying','inanimate','immune','invulnerable','turret'])('contact gates: %s',kind=>{
        const g=scene(),m=mob();web(g,m);if(kind==='flying')m.applyStatus('levitating',20);
        if(kind==='inanimate')m.behaviorFlags.add('MONST_INANIMATE');if(kind==='immune')m.behaviorFlags.add('MONST_IMMUNE_TO_WEBS');if(kind==='invulnerable')m.behaviorFlags.add('MONST_INVULNERABLE');if(kind==='turret')m.behaviorFlags.add('MONST_TURRET');
        const r=vi.spyOn(rng,'randRange');g.applyEntanglementFromTerrain(m);
        expect(m.hasStatus('stuck')).toBe(!['immune','invulnerable','turret'].includes(kind));expect(r).toHaveBeenCalledTimes(['immune','invulnerable','turret'].includes(kind)?0:1);
    });
    it('real entry, waits, 3 attempts, last attempt releases surface and moves',()=>{
        const g=scene();g.grid.setTerrainLayer(9,8,L.SURFACE,T.WEB);vi.spyOn(rng,'randRange').mockImplementation(lo=>lo);
        step(g);expect(g.player.x).toBe(9);expect(g.player.getStatusDuration('stuck')).toBe(3);
        wait(g);expect(g.player.getStatusDuration('stuck')).toBe(3);
        step(g);expect(g.player.x).toBe(9);expect(g.player.getStatusDuration('stuck')).toBe(2);
        step(g);expect(g.player.x).toBe(9);expect(g.player.getStatusDuration('stuck')).toBe(1);
        step(g);expect(g.player.x).toBe(10);expect(g.player.hasStatus('stuck')).toBe(false);expect(g.grid.getCell(9,8)!.layers[L.SURFACE]).toBe(T.NOTHING);
    });
    it('player attacks occupied destination before struggling; wall does not consume a count',()=>{
        const g=scene(),m=mob('rat',9,8);m.hp=m.maxHp=1000;m.ticksUntilTurn=100000;g.monsters=[m];web(g,g.player);g.player.applyStatus('stuck',4);
        step(g);expect(g.player.x).toBe(8);expect(g.player.getStatusDuration('stuck')).toBe(4);
        g.monsters=[];g.grid.setTerrain(9,8,T.WALL);step(g);expect(g.player.getStatusDuration('stuck')).toBe(4);
    });
    it.each([T.WEB,T.ANCIENT_SPIRIT_VINES])('monster counter and final move preserve base/liquid (%i)',tile=>{
        const g=scene(),m=mob();g.monsters=[m];web(g,m,tile);g.grid.setTerrainLayer(12,8,L.LIQUID,T.WATER_SHALLOW);m.applyStatus('stuck',2);
        const r=vi.spyOn(rng,'randPercent');(m as any).tryMoveTo(13,8,g);expect(m.x).toBe(12);expect(m.getStatusDuration('stuck')).toBe(1);expect(m.ticksUntilTurn).toBe(m.movementSpeed);
        (m as any).tryMoveTo(13,8,g);expect(m.x).toBe(13);expect(m.hasStatus('stuck')).toBe(false);expect(r).not.toHaveBeenCalled();
        expect(g.grid.getCell(12,8)!.layers.slice(0,3)).toEqual([T.FLOOR,T.WATER_SHALLOW,T.NOTHING]);
    });
    it('monster melee on occupied target does not decrement STUCK',()=>{
        const g=scene(),m=mob('rat',9,8);web(g,m);m.applyStatus('stuck',5);m.behaviorFlags.add('MONST_ALWAYS_HUNTING');g.monsters=[m];m.takeTurn(g,100);
        expect(m.getStatusDuration('stuck')).toBe(5);expect(m.x).toBe(9);
    });
    it('all layers hold; final attempt clears only surface; terrain loss clears on tick',()=>{
        const g=scene(),m=mob();g.monsters=[m];web(g,m);g.grid.setTerrainLayer(12,8,L.LIQUID,T.WEB);m.applyStatus('stuck',1);
        (m as any).tryMoveTo(13,8,g);expect(g.grid.getCell(12,8)!.layers[L.LIQUID]).toBe(T.WEB);expect(g.grid.getCell(12,8)!.layers[L.SURFACE]).toBe(T.NOTHING);
        web(g,m);g.applyEntanglementFromTerrain(m);g.grid.setTerrainLayer(13,8,L.SURFACE,T.NOTHING);(g as any).tickCreatureStatuses();expect(m.hasStatus('stuck')).toBe(false);
    });
    it.each(['stuck','terrain'])('bolt eligibility consumes counter, not occupation (%s)',source=>{
        const g=scene(),m=mob('spider'),t=mob('rat',16,8);t.isAlly=true;
        if(source==='stuck')t.applyStatus('stuck',3);else web(g,t);
        const before=rng.randomNumbersGenerated;expect(specificallyValidBoltTarget(m,t,'SPIDERWEB',g)).toBe(source==='terrain');expect(rng.randomNumbersGenerated).toBe(before);
    });
    it('entranced forced follow gates on counter, including away from terrain',()=>{
        const g=scene(),m=mob();g.monsters=[m];m.applyStatus('entranced',20);m.applyStatus('stuck',3);m.moveEntranced(g,1,0);expect(m.x).toBe(12);
        m.setStatusDuration('stuck',0);web(g,m);m.moveEntranced(g,1,0);expect(m.x).toBe(13);
    });
    it('blink releases even when landing in another web; unsuccessful placement retains count',()=>{
        const g=scene();web(g,g.player);g.player.applyStatus('stuck',2);g.grid.setTerrainLayer(13,8,L.SURFACE,T.WEB);
        vi.spyOn(rng,'randRange').mockImplementation(lo=>lo);
        expect((g as any).finishBlink({caster:g.player,landingPos:{x:13,y:8}})).toBe(true);expect(g.player.getStatusDuration('stuck')).toBe(3);expect(g.grid.getCell(8,8)!.layers[L.SURFACE]).toBe(T.WEB);
        g.grid.setTerrain(14,8,T.WALL);expect((g as any).finishBlink({caster:g.player,landingPos:{x:14,y:8}})).toBe(false);expect(g.player.getStatusDuration('stuck')).toBe(3);
        expect((g as any).finishBlink({caster:g.player,landingPos:{x:15,y:8}})).toBe(true);expect(g.player.hasStatus('stuck')).toBe(false);
    });
    it('STUCK auto-hits without RNG or a sneak multiplier, even inanimate',()=>{
        const p=new Player(8,8),m=mob();m.hp=m.maxHp=1000;m.defense=10000;m.applyStatus('stuck',3);m.behaviorFlags.add('MONST_INANIMATE');
        const r=vi.spyOn(rng,'randPercent').mockReturnValue(false),d=vi.spyOn(rng,'randRange').mockImplementation(lo=>lo);
        const hit=CombatSystem.attack(p,m);expect(hit.hit).toBe(true);expect(hit.backstab).toBe(false);expect(hit.damage).toBe(1);expect(r).not.toHaveBeenCalled();expect(d).toHaveBeenCalled();
        const dagger=ItemLoader.spawnWeapon('dagger',0,0)!;dagger.runicType=undefined;r.mockClear();CombatSystem.resolveThrownWeapon(p,m,dagger);expect(r).not.toHaveBeenCalled();
    });
});

describe('U14b DONNING CE original function goldens and equipment flow',()=>{
    it.each(golden)('weakness $weakness / donning $donning: defense $playerDefense',row=>{
        expect(playerDefense(4,2,18-row.weakness!,17,row.donning!)).toBe(row.playerDefense);
    });
    it('ordinary equip starts armor/10, refresh replaces; forced starting equipment and unequip clear',()=>{
        const g=scene(),armor=ItemLoader.spawnArmor('chain_mail',0,0)!;armor.armor=4.8;armor.enchantment=2;armor.strengthRequired=12;
        vi.spyOn(g as any,'playerTurnEnded').mockImplementation(()=>{});g.equipItem(armor);expect(g.player.getStatusDuration('donning')).toBe(4);expect(g.player.maxStatus.donning).toBe(4);
        g.player.tickStatuses();g.equipItem(armor);expect(g.player.getStatusDuration('donning')).toBe(4);g.unequipItem(armor);expect(g.player.hasStatus('donning')).toBe(false);
        g.player.equip(armor);expect(g.player.hasStatus('donning')).toBe(false);
    });
    it('actual armor hit chance and detail include donning, without a damage penalty',()=>{
        const g=scene(),m=mob(),armor=ItemLoader.spawnArmor('chain_mail',0,0)!;armor.armor=4;armor.enchantment=2;armor.strengthRequired=12;
        g.player.equip(armor,false);const r=vi.spyOn(rng,'randPercent').mockReturnValue(true);m.damageString='5';m.accuracy=100;
        expect(CombatSystem.attack(m,g.player).damage).toBe(5);expect(r).toHaveBeenLastCalledWith(hitProbability(100,20));
        const detail=JSON.stringify(generateMonsterDetail(m,100,12,0,null,0,12,4,2,12,false,4));expect(detail).toContain(`${hitProbability(100,20)}%`);
        g.player.tickStatuses();CombatSystem.attack(m,g.player);expect(r).toHaveBeenLastCalledWith(hitProbability(100,30));
    });
    it.each(['hasted','slowed'] as const)('objective clock, %s equipment/action timing',speed=>{
        const g=scene(),m=mob();m.ticksUntilTurn=100000;g.monsters=[m];g.player.applyStatus('donning',8);m.applyStatus('enraged',8);m.applyStatus('lifespan_remaining',8);web(g,g.player);g.player.applyStatus('stuck',6);g.player.applyStatus(speed,20);
        wait(g);const delta=speed==='hasted'?0:2;expect(g.player.getStatusDuration('donning')).toBe(8-delta);expect(m.getStatusDuration('enraged')).toBe(8-delta);expect(m.getStatusDuration('lifespan_remaining')).toBe(8-delta);expect(g.player.getStatusDuration('stuck')).toBe(6);
        if(speed==='hasted'){wait(g);expect(g.player.getStatusDuration('donning')).toBe(7);expect(m.getStatusDuration('lifespan_remaining')).toBe(7);}
    });
});

describe('U14b ENRAGED aggression and corridor exemption',()=>{
    it.each(['hit','miss','shield','immune','dead','ordinary','environment'])('source gate %s',kind=>{
        const p=new Player(8,8),m=mob();m.hp=m.maxHp=100;m.abilityFlags.add('MA_AVOID_CORRIDORS');if(kind==='ordinary')m.abilityFlags.clear();if(kind==='shield')m.applyShield(10000);if(kind==='immune')m.behaviorFlags.add('MONST_IMMUNE_TO_WEAPONS');if(kind==='dead')m.hp=1;
        vi.spyOn(rng,'randPercent').mockReturnValue(kind!=='miss');vi.spyOn(rng,'randRange').mockImplementation(lo=>lo);
        if(kind==='environment')m.takeDamage(1);else CombatSystem.attack(p,m);
        expect(m.getStatusDuration('enraged')).toBe(['miss','dead','ordinary','environment'].includes(kind)?0:4);
        if(m.hasStatus('enraged')){m.tickStatuses();m.enrageAfterAttack();expect(m.maxStatus.enraged).toBe(4);expect(m.getStatusDuration('enraged')).toBe(4);}
    });
    it('monster damage bolt and thrown weapon activate the same survivor source',()=>{
        const g=scene(),m=mob('goblin'),caster=mob('dar_blademaster');m.hp=m.maxHp=1000;m.abilityFlags.add('MA_AVOID_CORRIDORS');g.monsters=[m,caster];
        (g as any).applyMonsterBoltHit(caster,m,'SPARK',MONSTER_BOLT_TABLE.SPARK);expect(m.getStatusDuration('enraged')).toBe(4);
        m.setStatusDuration('enraged',0);m.applyStatus('stuck',3);CombatSystem.resolveThrownWeapon(g.player,m,ItemLoader.spawnWeapon('dagger',0,0)!);expect(m.getStatusDuration('enraged')).toBe(4);
    });
    it('only grouped hunters at <= half HP ignore safe-room to corridor avoidance while enraged',()=>{
        const g=scene(),m=mob('goblin',12,8),leader=mob('goblin',10,8);g.monsters=[m,leader];m.abilityFlags.add('MA_AVOID_CORRIDORS');m.leader=leader;m.hp=m.maxHp=100;
        for(const [x,y] of [[11,7],[11,8],[11,9],[12,7],[12,9],[13,7],[13,9]])g.grid.setTerrain(x!,y!,T.WALL);const dest={x:13,y:8};
        expect(monsterAvoidsCorridor(g,m,dest)).toBe(true);m.applyStatus('enraged',4);expect(monsterAvoidsCorridor(g,m,dest)).toBe(true);
        m.hp=50;expect(monsterAvoidsCorridor(g,m,dest)).toBe(false);expect(monsterBlinkAvoids(g,m,dest)).toBe(false);
        m.setStatusDuration('enraged',0);expect(monsterBlinkAvoids(g,m,dest)).toBe(true);(m as any).tryMoveTo(13,8,g);expect(m.x).toBe(12);
        m.applyStatus('enraged',4);(m as any).tryMoveTo(13,8,g);expect(m.x).toBe(13);
    });
});

describe('U14b LIFESPAN, persistence and display',()=>{
    it.each(['shield','invulnerable','poison'])('expiration kills directly, including %s',kind=>{
        const g=scene(),m=mob();g.monsters=[m];m.applyStatus('lifespan_remaining',1);m.applyShield(10000);m.ticksUntilTurn=100000;
        if(kind==='invulnerable')m.behaviorFlags.add('MONST_INVULNERABLE');if(kind==='turret')m.behaviorFlags.add('MONST_TURRET');if(kind==='poison')m.addPoison(10,1000);
        const kills=g.stats.kills;(g as any).tickCreatureStatuses();expect(m.hp).toBe(0);expect(m.maxStatus.lifespan_remaining).toBe(1);expect(g.stats.kills).toBe(kills);
        (g as any).removeDeadMonsters();expect(g.monsters).not.toContain(m);
    });
    it('earlier burning death does not also consume/announce lifespan expiry',()=>{
        const g=scene(),m=mob();g.monsters=[m];m.hp=1;m.applyStatus('lifespan_remaining',1);
        (m.statusDurations as Record<string,number>).burning=2;vi.spyOn(rng,'randRange').mockImplementation(lo=>lo);
        (g as any).tickCreatureStatuses();expect(m.hp).toBe(0);expect(m.getStatusDuration('lifespan_remaining')).toBe(1);
    });
    it('timed allies never flee; ordinary low HP allies retain their flee decision',()=>{
        const g=scene(),m=mob(),enemy=mob('rat',13,8);m.isAlly=true;m.hp=1;m.maxHp=100;m.regenTurns=10;m.behaviorFlags.add('MONST_FLEES_NEAR_DEATH');
        expect(blinkAllyFlees(g,m,enemy)).toBe(true);m.applyStatus('lifespan_remaining',3);expect(blinkAllyFlees(g,m,enemy)).toBe(false);
    });
    it.each([false,true])('all four non-negatable and unaffected by panacea (player=%s)',player=>{
        const c=player?new Player(1,1):mob();for(const id of states)c.applyStatus(id,7);
        negateCreatureStatusEffects(c,player);c.heal(100,true);for(const id of states)expect(c.getStatusDuration(id)).toBe(7);
    });
    it('ordinary lifespan has no negation death, DIES_IF_NEGATED remains an independent flag',()=>{
        const g=scene(),m=mob();g.monsters=[m];m.applyStatus('lifespan_remaining',7);(g as any).negateCreatureMagic(m);expect(m.hp).toBeGreaterThan(0);expect(m.getStatusDuration('lifespan_remaining')).toBe(7);
        m.behaviorFlags.add('MONST_DIES_IF_NEGATED');(g as any).negateCreatureMagic(m);expect(m.hp).toBe(0);
    });
    it('current/max persist for player, active and dormant monsters; clones own independent maps',()=>{
        const g=scene(),m=mob(),d=mob('rat',18,8);d.isDormant=true;g.monsters=[m];g.dormantMonsters=[d];
        for(const c of [g.player,m,d])for(const id of states)c.applyStatus(id,7);
        const clone=g.cloneMonster(m)!;clone.maxStatus.stuck=19;clone.setStatusDuration('stuck',3);expect(m.maxStatus.stuck).toBe(7);expect(m.getStatusDuration('stuck')).toBe(7);
        const save=JSON.parse(JSON.stringify(g.toSnapshot()));expect(g.loadSnapshot(save)).toBe(true);
        for(const c of [g.player,g.monsters.find(c=>c.id===m.id)!,g.dormantMonsters[0]!])for(const id of states){expect(c.getStatusDuration(id)).toBe(7);expect(c.maxStatus[id]).toBe(7);}
        const rows=creatureStatusRows(g.player);expect(rows.map(r=>r.label)).toEqual(['缠绕','穿甲','寿命']);expect(rows.map(r=>r.value)).toEqual(['7/7','7/7','7/7']);
        const restored=g.monsters.find(c=>c.id===m.id)!;restored.setStatusDuration('lifespan_remaining',1);restored.tickStatuses();expect(restored.hp).toBe(0);
    });
    it('conjuration blades still have 1 HP and no lifespan; no expansion of retired sources',()=>{
        const g=scene();(g as any).conjureBladesAt({x:14,y:8},2);expect(g.monsters.length).toBeGreaterThan(0);
        for(const blade of g.monsters){expect(blade.hp).toBe(1);expect(blade.hasStatus('lifespan_remaining')).toBe(false);expect(blade.maxStatus.lifespan_remaining).toBeUndefined();}
    });
});
