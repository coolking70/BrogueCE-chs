// FE-1 阶段 C/D：四视口实际操作流程截图 + 录像导出→桌面重载→回放零 OOS。
// 用法：先 `npx vite --port 5391`，再 `node ai_docs/reports/fe-1-evidence/flow-capture.mjs [前缀] [视口名…]`
// 手机/平板视口用真实触屏事件（Playwright touchscreen / 合成 pointer 事件），桌面用鼠标 + 键盘。
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';

const OUT = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.FE1_URL ?? 'http://localhost:5391/';
const PREFIX = process.argv[2] ?? 'C';
const ONLY = process.argv.slice(3);
const SEED = process.env.FE1_SEED ?? '12345';
const VIEWPORTS = [
  { name: 'desktop-1440x900', width: 1440, height: 900, touch: false },
  { name: 'tablet-768x1024', width: 768, height: 1024, touch: true },
  { name: 'phone-390x844', width: 390, height: 844, touch: true },
  { name: 'phone-land-844x390', width: 844, height: 390, touch: true },
].filter(v => !ONLY.length || ONLY.includes(v.name));

const DIRS = { UL: [-1, -1], U: [0, -1], UR: [1, -1], L: [-1, 0], R: [1, 0], DL: [-1, 1], D: [0, 1], DR: [1, 1] };
const PAD_INDEX = { UL: 0, U: 1, UR: 2, L: 3, C: 4, R: 5, DL: 6, D: 7, DR: 8 };
const KEY_OF = { UL: 'y', U: 'k', UR: 'u', L: 'h', R: 'l', DL: 'b', D: 'j', DR: 'n' };
const CMD_KEY = { search: 's', wait: 'z', pickup: 'g', toggle_inventory: 'i', throw_item: 't', auto_explore: 'X',
  stairs_up: '<', stairs_down: '>', examine: 'x', discoveries: 'D', help: '?', escape: 'Escape' };

const log = [];
const note = (s) => { log.push(s); console.log(s); };
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const recordings = {};

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.touch ? 2 : 1, isMobile: vp.touch, hasTouch: vp.touch, acceptDownloads: true,
  });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => note(`[${vp.name}] pageerror ${e.message}`));
  const shot = async (tag) => page.screenshot({ path: join(OUT, `${PREFIX}-${vp.name}-${tag}.png`) });
  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const waitIdle = async () => {
    for (let i = 0; i < 100; i++) {
      const s = await state();
      if (!s.autoPathLength) { await page.waitForTimeout(80); return s; }
      await page.waitForTimeout(100);
    }
    return state();
  };
  const cellToClient = async (x, y) => {
    const s = await state();
    const rect = await page.locator('.game-container canvas').boundingBox();
    const L = s.mapLayout;
    return { cx: rect.x + L.offsetX + (x + 0.5) * L.tile * L.scaleX, cy: rect.y + L.offsetY + (y + 0.5) * L.tile * L.scaleY };
  };
  const tapCell = async (x, y) => {
    const { cx, cy } = await cellToClient(x, y);
    if (vp.touch) await page.touchscreen.tap(cx, cy);
    else await page.mouse.click(cx, cy);
    await page.waitForTimeout(150);
  };
  // 长按：合成 touch 类型 pointer 事件（Playwright 的 touchscreen 只有 tap）
  const longPressCell = async (x, y) => {
    const { cx, cy } = await cellToClient(x, y);
    if (!vp.touch) { await page.mouse.click(cx, cy, { button: 'right' }); await page.waitForTimeout(200); return; }
    await page.evaluate(async ({ cx, cy }) => {
      const el = document.querySelector('.game-container canvas');
      const opts = { pointerId: 7, pointerType: 'touch', clientX: cx, clientY: cy, bubbles: true, isPrimary: true };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      await new Promise(r => setTimeout(r, 650));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
    }, { cx, cy });
    await page.waitForTimeout(250);
  };
  const cmd = async (action) => {
    if (vp.touch) await page.locator(`.command-bar [data-action="${action}"]`).tap();
    else await page.keyboard.press(CMD_KEY[action]);
    await page.waitForTimeout(150);
  };
  const move = async (dir) => {
    if (vp.touch) await page.locator('.dpad .pad-btn').nth(PAD_INDEX[dir]).tap();
    else await page.keyboard.press(KEY_OF[dir]);
    await page.waitForTimeout(120);
  };
  const tapButtonText = async (text, scope = '') => {
    const b = page.locator(`${scope} button`.trim(), { hasText: text }).first();
    if (vp.touch) await b.tap(); else await b.click();
    await page.waitForTimeout(200);
  };
  const gameOver = async () => (await page.locator('.game-end-overlay').count()) > 0;
  const fightAdjacent = async () => {
    const s = await state();
    const p = s.player;
    const m = s.monsters.find((mm) => !mm.isAlly && Math.max(Math.abs(mm.x - p.x), Math.abs(mm.y - p.y)) === 1);
    if (!m) return false;
    const dir = Object.entries(DIRS).find(([, [dx, dy]]) => dx === m.x - p.x && dy === m.y - p.y)[0];
    await move(dir);
    return true;
  };
  const exploreUntil = async (pred, max) => {
    for (let i = 0; i < max; i++) {
      if (await gameOver()) return false;
      if (pred(await state())) return true;
      if (await fightAdjacent()) continue;
      await cmd('auto_explore');
      await waitIdle();
    }
    return pred(await state());
  };

  await page.goto(BASE);
  await page.waitForTimeout(600);
  // 1. 开新局
  await page.fill('input[inputmode="numeric"]', SEED);
  await tapButtonText('新游戏');
  await page.waitForTimeout(900);
  await shot('01-new-game');
  let s = await state();
  note(`[${vp.name}] start depth=${s.depth} player=${s.player.x},${s.player.y} layout=${JSON.stringify(s.mapLayout)}`);

  // 2. 移动（方向键 / hjkl）
  const before = s.player;
  for (const dir of ['R', 'R', 'U', 'L']) await move(dir);
  s = await state();
  note(`[${vp.name}] moved ${before.x},${before.y} -> ${s.player.x},${s.player.y}`);
  await shot('02-moved');

  // 3. 长按查看（优先可见怪物，否则自己脚下）
  const target = s.monsters[0] ?? s.player;
  await longPressCell(target.x, target.y);
  await shot('03-long-press');
  if (await page.locator('.detail-overlay').count()) {
    const close = page.locator('.detail-close');
    if (vp.touch) await close.tap(); else await close.click();
    await page.waitForTimeout(150);
  }

  // 4. 探索直到背包里有药水，然后打开背包喝药
  const hasPotion = (st) => st.inventory.some((i) => i.category === 2);
  const found = await exploreUntil(hasPotion, 120);
  s = await state();
  note(`[${vp.name}] explore for potion: ${found} depth=${s.depth} inv=${s.inventory.map(i => i.name).join('/')}`);
  if (found) {
    await cmd('toggle_inventory');
    await page.waitForTimeout(250);
    const potion = s.inventory.find((i) => i.category === 2);
    const row = page.locator('.item-row', { hasText: potion.name.split(' ')[0] }).first();
    if (vp.touch) await row.tap(); else await row.click();
    await page.waitForTimeout(200);
    await shot('04-inventory-potion');
    await tapButtonText('饮用', '.item-actions');
    await page.waitForTimeout(400);
    const after = await state();
    note(`[${vp.name}] quaffed ${potion.name}: inventory potions ${after.inventory.filter(i => i.category === 2).length}, inventoryOpen=${await page.locator('.inventory-overlay').count()}`);
    await shot('05-after-quaff');
    if (await page.locator('.inventory-overlay').count()) await page.keyboard.press('Escape');
  }

  // 5. 投掷选目标：投掷命令 → 背包选飞镖 → 投掷 → 地图点选 → 确认
  if (!(await gameOver())) {
    await cmd('throw_item');
    await page.waitForTimeout(250);
    const dartRow = page.locator('.item-row', { hasText: '飞镖' }).first();
    if (vp.touch) await dartRow.tap(); else await dartRow.click();
    await page.waitForTimeout(150);
    await tapButtonText('投掷', '.item-actions');
    await page.waitForTimeout(300);
    s = await state();
    const near = (m) => Math.max(Math.abs(m.x - s.player.x), Math.abs(m.y - s.player.y)) <= 5;
    const aim = s.monsters.find(near) ?? { x: s.player.x + (s.player.x < 70 ? 2 : -2), y: s.player.y };
    const dartsBefore = s.inventory.find((i) => i.name.includes('飞镖'))?.name;
    await tapCell(aim.x, aim.y);
    await shot('06-throw-aim');
    if (vp.touch) {
      await page.locator('.target-bar .tb-btn.primary').tap();
      await page.waitForTimeout(500);
    }
    s = await state();
    note(`[${vp.name}] throw at ${aim.x},${aim.y}: isThrowing=${s.isThrowing} darts ${dartsBefore} -> ${s.inventory.find((i) => i.name.includes('飞镖'))?.name}`);
    await shot('07-after-throw');
  }

  // 6. 上下楼：走到已知下楼梯（点地图寻路 / 键盘 X 探索），换层后再走回上楼梯
  const startDepth = (await state()).depth;
  const knowsDown = await exploreUntil((st) => !!st.knownStairs.down || st.depth > startDepth, 150);
  s = await state();
  if (knowsDown && s.depth === startDepth) {
    for (let i = 0; i < 6 && (await state()).depth === startDepth && !(await gameOver()); i++) {
      if (await fightAdjacent()) continue;
      const st = await state();
      await tapCell(st.knownStairs.down.x, st.knownStairs.down.y);
      await waitIdle();
    }
  }
  s = await state();
  note(`[${vp.name}] descend: depth ${startDepth} -> ${s.depth}`);
  await shot('08-descended');
  if (s.depth > startDepth && s.knownStairs.up) {
    for (let i = 0; i < 6 && (await state()).depth > startDepth && !(await gameOver()); i++) {
      if (await fightAdjacent()) continue;
      const st = await state();
      if (!st.knownStairs.up) break;
      await tapCell(st.knownStairs.up.x, st.knownStairs.up.y);
      await waitIdle();
    }
    s = await state();
    note(`[${vp.name}] ascend: depth -> ${s.depth}`);
    await shot('09-ascended');
  }

  // 7. 录像：保存回放 → 导出 JSON（下载），交给桌面实例重载回放
  const menuBtn = page.locator('.menu-btn, .mobile-hud .hud-btn').first();
  if (vp.touch) await menuBtn.tap(); else await menuBtn.click();
  await page.waitForTimeout(250);
  await tapButtonText('保存回放');
  const [download] = await Promise.all([page.waitForEvent('download'), tapButtonText('导出 JSON')]);
  const recPath = join(OUT, `${PREFIX}-${vp.name}-recording.json`);
  await download.saveAs(recPath);
  const exported = JSON.parse(await page.evaluate(() => window.export_game_recording()));
  recordings[vp.name] = { path: recPath, events: exported.events.length, finalPlayer: (await state()).player, depth: (await state()).depth };
  note(`[${vp.name}] recording exported: ${exported.events.length} events`);

  // 8. 存档 → 刷新页面 → 继续游戏
  await tapButtonText('保存游戏');
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForTimeout(800);
  await tapButtonText('继续游戏');
  await page.waitForTimeout(800);
  const loaded = await state();
  note(`[${vp.name}] save/load: depth=${loaded.depth} player=${loaded.player.x},${loaded.player.y} (expected ${recordings[vp.name].finalPlayer.x},${recordings[vp.name].finalPlayer.y})`);
  await shot('10-save-loaded');
  await ctx.close();
}

// 9. 桌面端重载每份录像并回放到底：零 OOS、终点一致
for (const [name, rec] of Object.entries(recordings)) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE);
  await page.waitForTimeout(500);
  await page.locator('.file-input').setInputFiles(rec.path);
  await page.waitForTimeout(1000);
  let st = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
  for (let i = 0; i < 5000 && st.replay.cursor < st.replay.total; i++) {
    const err = await page.locator('.replay-error').count();
    if (err) break;
    await page.evaluate(() => window.force_replay_step());
    if (i % 25 === 0) st = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
  }
  st = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const errText = (await page.locator('.replay-error').count()) ? await page.locator('.replay-error').innerText() : null;
  note(`[replay ${name} on desktop] cursor ${st.replay.cursor}/${st.replay.total} error=${errText} player=${st.player.x},${st.player.y} depth=${st.depth} expected=${rec.finalPlayer.x},${rec.finalPlayer.y} d${rec.depth} OOS-free=${!errText && st.replay.cursor === st.replay.total && st.player.x === rec.finalPlayer.x && st.player.y === rec.finalPlayer.y}`);
  await page.screenshot({ path: join(OUT, `${PREFIX}-replay-${name}-on-desktop.png`) });
  await ctx.close();
}

await browser.close();
writeFileSync(join(OUT, `${PREFIX}-flow-log.txt`), log.join('\n') + '\n');
