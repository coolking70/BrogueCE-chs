// FE-1 复核：把已导出的录像（默认 C 阶段四视口）在桌面上下文（1440×900、无触屏、DPR 1）
// 经主菜单"导入录像"重载，逐条回放到底。引擎每条命令后比对 tick/深度/坐标/回合/决策数/完整 RNG 状态，
// 任一不符即 replayError（OOS）。另记录终局状态与录像最后一条事件的一致性。
// 用法：先 `npx vite --port 5391`，再 `node ai_docs/reports/fe-1-evidence/replay-check.mjs [前缀]`
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const OUT = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.FE1_URL ?? 'http://localhost:5391/';
const PREFIX = process.argv[2] ?? 'C';
const NAMES = ['desktop-1440x900', 'tablet-768x1024', 'phone-390x844', 'phone-land-844x390'];

const log = [];
const note = (s) => { log.push(s); console.log(s); };
const files = NAMES.map((n) => ({ name: n, path: join(OUT, `${PREFIX}-${n}-recording.json`) }));
const recs = files.map((f) => JSON.parse(readFileSync(f.path, 'utf8')));
const same = recs.map((r) => JSON.stringify(r.events) === JSON.stringify(recs[0].events));
note(`[${PREFIX}] events per recording: ${recs.map((r) => r.events.length).join('/')}; identical to desktop: ${same.join('/')}`);
const touchOnly = recs.map((r) => r.events.filter((e) => ['mouse_travel', 'item:command', 'throw_item', 'toggle_inventory'].includes(e.action)).map((e) => `${e.action}:${JSON.stringify(e.data)}`).join(' '));
note(`[${PREFIX}] non-step commands (phone): ${touchOnly[2]}`);

// 反例：FE1_TAMPER=1 时额外生成一份篡改过的触屏录像（第 200 条事件的记录坐标 x+1），
// 期望回放在该条报 OOS——证明上面的"零 OOS"不是检测失效造成的假通过。
if (process.env.FE1_TAMPER) {
  const bad = JSON.parse(readFileSync(files[2].path, 'utf8'));
  bad.events[199].player.x += 1;
  const p = join(mkdtempSync(join(tmpdir(), 'fe1-')), 'tampered.json');
  writeFileSync(p, JSON.stringify(bad));
  files.push({ name: 'phone-390x844-TAMPERED-expect-OOS', path: p });
  recs.push(bad);
}

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
for (const [i, f] of files.entries()) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE);
  await page.waitForTimeout(500);
  await page.locator('.file-input').setInputFiles(f.path);
  await page.waitForTimeout(1000);
  const read = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  let st = await read();
  const total = st.replay.total;
  let steps = 0;
  while (st.replay.cursor < total && steps < total + 50) {
    await page.evaluate(() => window.force_replay_step());
    steps++;
    st = await read();
    if (st.replay.error) break;
  }
  const last = recs[i].events.at(-1);
  const errText = st.replay.error ?? ((await page.locator('.replay-error').count()) ? await page.locator('.replay-error').innerText() : null);
  const ok = !errText && st.replay.cursor === total && total === recs[i].events.length
    && st.player.x === last.player.x && st.player.y === last.player.y && st.depth === last.depth;
  note(`[replay ${PREFIX}-${f.name} on desktop] cursor ${st.replay.cursor}/${total} error=${errText} player=${st.player.x},${st.player.y} d${st.depth} lastEvent=${last.player.x},${last.player.y} d${last.depth} OOS-free=${ok}`);
  await ctx.close();
}
await browser.close();
writeFileSync(join(OUT, `${PREFIX}-replay-recheck-log.txt`), log.join('\n') + '\n');
