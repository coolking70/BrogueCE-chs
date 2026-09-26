import fs from 'node:fs';import {createHeadlessGame} from '../src/test/harness';import {rng} from '../src/engine/Random';import {TerrainType as T} from '../src/engine/Map/Grid';
const a=createHeadlessGame(42),rebuild=a.rebuildWaypoints.bind(a);let grid:any[]=[],input=rng.getState();
a.rebuildWaypoints=()=>{grid=a.grid.cells.flat().map(c=>({x:c.x,y:c.y,layers:[...c.layers]}));input=rng.getState();rebuild();};
a.startNewGame({seed:42});const snap=a.toSnapshot(),b=createHeadlessGame(777);b.loadSnapshot(snap);
const before=[...b.waypoints.coordinates],changes=grid.filter(c=>JSON.stringify(c.layers)!==JSON.stringify(b.grid.getCell(c.x,c.y)!.layers)).map(c=>({x:c.x,y:c.y,from:c.layers.map((t:T)=>T[t]),to:b.grid.getCell(c.x,c.y)!.layers.map(t=>T[t])}));
rng.setState(input);b.rebuildWaypoints();const warmed=[...b.waypoints.coordinates];
for(const c of grid)for(let l=0;l<4;l++)b.grid.setTerrainLayer(c.x,c.y,l,c.layers[l]);rng.setState(input);b.rebuildWaypoints();
fs.writeFileSync('ai_docs/reports/u-19f-evidence/waypoint-probe.json',JSON.stringify({changes,persisted:before,warmedRebuild:warmed,constructionRebuild:b.waypoints.coordinates,constructionMatches:JSON.stringify(before)===JSON.stringify(b.waypoints.coordinates)},null,2)+'\n');
