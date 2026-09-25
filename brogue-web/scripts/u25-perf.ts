import { performance } from 'node:perf_hooks';
import { Game } from '../src/engine/Core/Game';
import { Architect } from '../src/engine/Generator/Architect';
import { BlueprintEngine } from '../src/engine/Generator/BlueprintEngine';

const seed = Number(process.argv[2] ?? 424242);
const profiles = new Map<string, { calls: number; inclusiveMs: number; selfMs: number }>();
const stack: Array<{ started: number; childMs: number }> = [];
function wrap(proto: any, name: string, label: string): void {
    const original = proto[name];
    proto[name] = function (...args: any[]) {
        const frame = { started: performance.now(), childMs: 0 };
        stack.push(frame);
        try { return original.apply(this, args); }
        finally {
            stack.pop();
            const elapsed = performance.now() - frame.started;
            if (stack.length) stack[stack.length - 1]!.childMs += elapsed;
            const row = profiles.get(label) ?? { calls: 0, inclusiveMs: 0, selfMs: 0 };
            row.calls++; row.inclusiveMs += elapsed; row.selfMs += elapsed - frame.childMs;
            profiles.set(label, row);
        }
    };
}
for (const [proto, name, label] of [
    [Game.prototype, 'generateDepth', 'Game.generateDepth'],
    [Game.prototype, 'placeStairs', 'Game.placeStairs'],
    [Game.prototype, 'populateLevel', 'Game.populateLevel'],
    [Architect.prototype, 'generateLevel', 'Architect.generateLevel'],
    [BlueprintEngine.prototype, 'buildMachines', 'BlueprintEngine.buildMachines'],
    [BlueprintEngine.prototype, 'buildAMachine', 'BlueprintEngine.buildAMachine'],
    [BlueprintEngine.prototype, 'applyBlueprint', 'BlueprintEngine.applyBlueprint'],
    [BlueprintEngine.prototype, 'findGateRoom', 'BlueprintEngine.findGateRoom'],
    [BlueprintEngine.prototype, 'fillAreaInterior', 'BlueprintEngine.fillAreaInterior'],
    [BlueprintEngine.prototype, 'findFeaturePosition', 'BlueprintEngine.findFeaturePosition'],
] as Array<[any, string, string]>) wrap(proto, name, label);

const game: any = new Game(); // constructor's temporary run is excluded below.
profiles.clear();
const started = performance.now();
game.startNewGame({ seed });
for (let depth = 2; depth <= 26; depth++) { game.depth = depth; game.generateDepth(false, false); }
const totalMs = performance.now() - started;
console.log(JSON.stringify({ seed, depths: 26, totalMs,
    functions: Object.fromEntries([...profiles].sort((a, b) => b[1].selfMs - a[1].selfMs)) }));
