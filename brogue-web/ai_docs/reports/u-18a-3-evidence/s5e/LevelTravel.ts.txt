/** U03b: RogueMain.startLevel / Time.monsterEntersLevel and Architect.restoreMonster. */
import { Monster, MonsterState } from '../../entities/Monster';
import type { Creature } from '../../entities/Creature';
import type { Pos } from '../../types';
import { Grid, TerrainType } from '../Map/Grid';
import { cellTerrainFlags } from '../Map/DungeonFeature';
import { T_PATHING_BLOCKER, T_OBSTRUCTS_PASSABILITY, T_OBSTRUCTS_DIAGONAL_MOVEMENT,
    T_SACRED, T_AUTO_DESCENT, T_DIVIDES_LEVEL, T_HARMFUL_TERRAIN, T_IS_DF_TRAP,
    T_CAUSES_POISON, T_CAUSES_DAMAGE, T_CAUSES_PARALYSIS, T_CAUSES_CONFUSION } from '../Map/TerrainCatalog';
import { teleportForbiddenFlags, type PlacementWorld } from './CreaturePlacement';
import { rng } from '../Random';

export const APPROACHING_DOWNSTAIRS = 1;
export const APPROACHING_UPSTAIRS = 2;
export const APPROACHING_PIT = 4;
export const TRAVEL_DIRECTIONS = [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[-1,1],[1,-1],[1,1]] as const;
const matrix = (g: Grid, n: number) => Array.from({length:g.width}, () => Array<number>(g.height).fill(n));

/** Uniform CE distance scan. Obstructions block diagonal corners; forbidden
 * hazards and damage-immune stationary monsters do not. Secret doors cost 1. */
export function travelDistanceMap(grid: Grid, monsters: readonly Monster[], origin: Pos, blocking: number,
    secretDoors = true, placement = false): number[][] {
    const cost = matrix(grid, 1), distance = matrix(grid, 30000);
    for (let x=0;x<grid.width;x++) for (let y=0;y<grid.height;y++) {
        const flags=cellTerrainFlags(grid,x,y);
        if (x===0 || y===0 || x===grid.width-1 || y===grid.height-1) cost[x]![y]=-2;
        else if (!placement && monsters.some(m=>m.hp>0 && m.x===x && m.y===y
            && (m.hasCEBehavior('MONST_IMMUNE_TO_WEAPONS') || m.hasCEBehavior('MONST_INVULNERABLE'))
            && (m.hasCEBehavior('MONST_IMMOBILE') || m.hasCEBehavior('MONST_GETS_TURN_ON_ACTIVATION')))) cost[x]![y]=-1;
        else if (secretDoors && grid.getCell(x,y)!.layers.includes(TerrainType.SECRET_DOOR)) cost[x]![y]=1;
        else if ((flags & T_OBSTRUCTS_DIAGONAL_MOVEMENT) && (!placement || (blocking & (T_OBSTRUCTS_DIAGONAL_MOVEMENT|T_OBSTRUCTS_PASSABILITY)))) cost[x]![y]=-2;
        else if (flags & (blocking | (placement ? 0 : T_OBSTRUCTS_PASSABILITY))) cost[x]![y]=-1;
    }
    if (!grid.isValidPos(origin.x,origin.y) || (!placement && (origin.x === 0 || origin.y === 0 || origin.x === grid.width - 1 || origin.y === grid.height - 1))) return distance;
    distance[origin.x]![origin.y]=0;
    if (placement) cost[origin.x]![origin.y]=1;
    const queue=[{...origin}];
    for (let i=0;i<queue.length;i++) {
        const p=queue[i]!;
        for (const [dx,dy] of TRAVEL_DIRECTIONS) {
            const x=p.x+dx,y=p.y+dy;
            if ((cost[x]?.[y]??-2)<0 || distance[x]![y]!==30000) continue;
            if (dx && dy && (cost[p.x+dx]?.[p.y]===-2 || cost[p.x]?.[p.y+dy]===-2)) continue;
            distance[x]![y]=distance[p.x]![p.y]!+1;queue.push({x,y});
        }
    }
    return distance;
}

export function scheduleLevelFollowers(grid: Grid, monsters: readonly Monster[], exit: Pos, direction: -1|0|1): void {
    let origin={...exit};
    if (cellTerrainFlags(grid,exit.x,exit.y)&T_AUTO_DESCENT) {
        const neighbor=TRAVEL_DIRECTIONS.map(([dx,dy])=>({x:exit.x+dx,y:exit.y+dy}))
            .find(p=>grid.isValidPos(p.x,p.y) && !(cellTerrainFlags(grid,p.x,p.y)&T_PATHING_BLOCKER));
        if (neighbor) origin=neighbor;
    }
    for (const flying of [false,true]) {
        const map=travelDistanceMap(grid,monsters,origin,(flying?T_OBSTRUCTS_PASSABILITY:T_PATHING_BLOCKER)|T_SACRED);
        for (const m of monsters) {
            const levitating=m.hasStatus('levitating'), flags=cellTerrainFlags(grid,m.x,m.y);
            // Web separates allegiance from state; magical fear temporarily leaves CE ALLY.
            const ally=m.isAlly && m.state!==MonsterState.FLEEING;
            if (m.hp<=0 || m.isDormant || !(ally || (m.state===MonsterState.HUNTING && (direction!==0 || levitating)))) continue;
            if (direction===0 && m.hp<=10 && !levitating) continue;
            if (flying!==!!(levitating || (flags&T_PATHING_BLOCKER) || (cellTerrainFlags(grid,origin.x,origin.y)&T_AUTO_DESCENT))) continue;
            if (m.isCaged || m.hasCEBehavior('MONST_WILL_NOT_USE_STAIRS') || m.hasCEBehavior('MONST_RESTRICTED_TO_LIQUID')
                || (flags&T_OBSTRUCTS_PASSABILITY) || m.hasStatus('entranced') || m.hasStatus('paralyzed')) continue;
            const distance=map[m.x]?.[m.y]??30000;
            if (distance>=30000 && !ally) continue;
            m.entersLevelIn=Math.max(1,Math.min(150,Math.floor(distance*m.movementSpeed/100)+1));
            m.approaching |= direction===1?APPROACHING_DOWNSTAIRS:direction===-1?APPROACHING_UPSTAIRS:APPROACHING_PIT;
        }
    }
}

/** Uses permanent info flags, as CE does, independent of temporary statuses. */
export function travelAvoidedFlags(target: Creature): number {
    let flags=teleportForbiddenFlags(target)|T_HARMFUL_TERRAIN|T_SACRED;
    if (target instanceof Monster) {
        if (target.hasCEBehavior('MONST_INVULNERABLE')) flags&=~(T_HARMFUL_TERRAIN|T_IS_DF_TRAP);
        if (target.hasCEBehavior('MONST_INANIMATE')) flags&=~(T_CAUSES_POISON|T_CAUSES_DAMAGE|T_CAUSES_PARALYSIS|T_CAUSES_CONFUSION);
        if (target.hasCEBehavior('MONST_FLIES')) flags&=~T_CAUSES_POISON;
    }
    return flags;
}

export function travelPlacement(world: PlacementWorld, target: Creature, origin: Pos,
    occupied: boolean, machines: boolean, deterministic: boolean, excludeOrigin = false): Pos | null {
    const {grid}=world, forbidden=travelAvoidedFlags(target), blocking=forbidden&T_DIVIDES_LEVEL;
    const qualifies=(p:Pos)=> {
        const cell=grid.getCell(p.x,p.y);
        return !!cell && !(excludeOrigin && p.x === origin.x && p.y === origin.y) && !(cellTerrainFlags(grid,p.x,p.y)&(forbidden|blocking))
            && !cell.layers.includes(TerrainType.STAIRS_UP) && !cell.layers.includes(TerrainType.STAIRS_DOWN)
            && (!machines || cell.machineNumber===0)
            && (!occupied || ![world.player,...world.monsters].some(c=>c!==target && c.hp>0 && c.x===p.x && c.y===p.y));
    };
    if (qualifies(origin)) return {...origin};
    const map=travelDistanceMap(grid,[],origin,blocking,false,true);
    let best=30000, ties:Pos[]=[];
    for(let x=0;x<grid.width;x++) for(let y=0;y<grid.height;y++) {
        const d=map[x]![y]!;
        if(d>=30000 || d>best || !qualifies({x,y})) continue;
        if(d<best){best=d;ties=[];}ties.push({x,y});
    }
    const pick=()=>ties[deterministic?Math.floor(ties.length/2):rng.randRange(0,ties.length-1)]!;
    if(ties.length) return pick();
    for(let r=1;r<Math.max(grid.width,grid.height);r++) {
        for(let x=origin.x-r;x<=origin.x+r;x++) for(let y=origin.y-r;y<=origin.y+r;y++) {
            if(Math.max(Math.abs(x-origin.x),Math.abs(y-origin.y))===r && qualifies({x,y})) ties.push({x,y});
        }
        if(ties.length) return pick();
    }
    return null;
}

/** Architect.restoreMonster: move towards the exit for the elapsed portion of
 * the journey. nextStep picks the greatest descent, preferring reverse CE direction order (diagonals). */
export function restoreTravelPosition(grid: Grid, m: Monster, map: number[][]): void {
    const count=(map[m.x]?.[m.y]??30000)-Math.trunc(m.entersLevelIn*100/m.movementSpeed);
    for(let i=0;i<count;i++) {
        let best=0, next:Pos|null=null;
        for(const [dx,dy] of [...TRAVEL_DIRECTIONS].reverse()) {
            const x=m.x+dx,y=m.y+dy;
            const drop=(map[m.x]?.[m.y]??30000)-(map[x]?.[y]??30000);
            if ((cellTerrainFlags(grid,x,y)&T_OBSTRUCTS_PASSABILITY) && !grid.getCell(x,y)?.layers.includes(TerrainType.SECRET_DOOR)) continue;
            if(drop<=best || (dx && dy && ((cellTerrainFlags(grid,m.x+dx,m.y)|cellTerrainFlags(grid,m.x,m.y+dy))&T_OBSTRUCTS_DIAGONAL_MOVEMENT))) continue;
            best=drop;next={x,y};
        }
        if(!next) break;m.loc=next;
    }
}
