import fs from 'node:fs';
import { chromium } from 'playwright';
const browser = await chromium.launch({headless:true});
try {
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5196');
 const rows=await page.evaluate(async()=>{
  const {activeGame:g}=await import('/src/engine/Core/Game.ts');
  const rows=[];
  for(const seed of [424242,2712,1212,707,42,12345,20260927,4,5,6,7,8,9,10,11,12]) {
   g.startNewGame({seed,mode:'normal'});g.animationEnabled=false;g.depth=2;g.generateDepth(false,false);
   rows.push({seed,player:g.player.loc,monkeys:g.monsters.filter(m=>m.typeId==='monkey'&&!m.isCaged&&!m.isAlly).map(m=>({id:m.id,...m.loc,state:m.state})),pack:g.player.inventory.items.map(i=>({id:i.id,name:i.name,q:i.quantity}))});
  }
  return rows;
 });
 fs.writeFileSync('ai_docs/reports/x2j-evidence/natural-d2-search.json',JSON.stringify(rows,null,2)+'\n');console.log(JSON.stringify(rows));
} finally {await browser.close();}
