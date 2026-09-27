import { defineConfig, mergeConfig } from 'vitest/config';
import base from '../vite.config';

const faults: Record<string, [string, string, string]> = {
    theft: ['MonsterTheft.ts', "if (!m.hasAbility('MA_HIT_STEAL_FLEE')", "if (true || !m.hasAbility('MA_HIT_STEAL_FLEE')"],
    equipped: ['MonsterTheft.ts', "!equipped.has(item) && !item.flags?.includes('ITEM_EQUIPPED')", 'true'],
    quantity: ['MonsterTheft.ts', 'Math.trunc((item.quantity + 1) / 2)', '1'],
    accuracy: ['MonsterTheft.ts', '|| !attackHit()', '|| false'],
    mode: ['MonsterTheft.ts', 'm.creatureMode = MonsterMode.PERM_FLEEING;', 'm.creatureMode = MonsterMode.NORMAL;'],
    recovery: ['MonsterAI.ts', 'm.creatureMode === MonsterMode.NORMAL && m.state === MonsterState.FLEEING', 'm.state === MonsterState.FLEEING'],
    memory: ['EntitySnapshot.ts', "'lastSeenPlayerAt', ", ''],
    targetCache: ['MonsterBlink.ts', 'if (!target.mapToMe ||', 'if (true || !target.mapToMe ||'],
    safetyCache: ['MonsterBlink.ts', 'g.monsterPathCache.safeTerrain ??=', 'g.monsterPathCache.safeTerrain ='],
    boltMode: ['Game.ts', 'target.creatureMode !== MonsterMode.PERM_FLEEING && ', ''],
    throwMode: ['Combat.ts', 'defender.creatureMode !== MonsterMode.PERM_FLEEING && ', ''],
    awareness: ['Scent.ts', 'const perceivedDistance = this.awarenessDistance(grid, ox, oy, px, py);', 'return true; const perceivedDistance = this.awarenessDistance(grid, ox, oy, px, py);'],
    waypointRng: ['MonsterAI.ts', 'if (m.waypointAlreadyVisited) m.waypointAlreadyVisited[index] = false;', 'g.waypoints.ensureVisitedInitialized(m); if (m.waypointAlreadyVisited) m.waypointAlreadyVisited[index] = false;'],
    scent: ['Scent.ts', 'let bestDir = -1;', 'return null; let bestDir = -1;'],
};
const name = process.env.X2J_FAULT!;
const fault = faults[name];
if (!fault) throw new Error(`Unknown fault: ${name}`);
export default mergeConfig(base, defineConfig({ plugins: [{
    name: 'x2j-negative', enforce: 'pre',
    transform(code, id) {
        if (!id.endsWith('/' + fault[0])) return;
        if (!code.includes(fault[1])) throw new Error(`Missing mutation anchor: ${name}`);
        return code.replaceAll(fault[1], fault[2]);
    },
}] }));
