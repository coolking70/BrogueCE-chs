// FE-1 阶段 A：四视口现状截图（只读，不改代码）。
// 用法：先 `npx vite --port 5391`，再 `node ai_docs/reports/fe-1-evidence/audit-capture.mjs [前缀]`
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.FE1_URL ?? 'http://localhost:5391/';
const PREFIX = process.argv[2] ?? 'A';
const VIEWPORTS = [
  { name: 'desktop-1440x900', width: 1440, height: 900, mobile: false },
  { name: 'tablet-768x1024', width: 768, height: 1024, mobile: true },
  { name: 'phone-390x844', width: 390, height: 844, mobile: true },
  { name: 'phone-land-844x390', width: 844, height: 390, mobile: true },
];

const browser = await chromium.launch();
const report = [];
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.mobile ? 2 : 1,
    isMobile: vp.mobile, hasTouch: vp.mobile,
  });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForTimeout(800);
  const shot = async (tag) => {
    const file = `${PREFIX}-${vp.name}-${tag}.png`;
    await page.screenshot({ path: join(OUT, file) });
    report.push(file);
  };
  await shot('01-menu');
  await page.fill('input[inputmode="numeric"]', '12345');
  await page.locator('.menu-card .actions button').first().click();
  await page.waitForTimeout(1200);
  await shot('02-game');
  const metrics = await page.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)];
    };
    return {
      canvas: r('.game-container'), sidebar: r('.sidebar'), agent: r('.agent-controls'),
      docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight,
    };
  });
  report.push(`${vp.name} metrics ${JSON.stringify(metrics)}`);
  await page.keyboard.press('i');
  await page.waitForTimeout(300);
  const firstItem = page.locator('.item-row').first();
  if (await firstItem.count()) { await firstItem.click(); await page.waitForTimeout(200); }
  await shot('03-inventory');
  const inspect = page.locator('.item-actions .action-btn').first();
  if (await inspect.count()) { await inspect.click(); await page.waitForTimeout(300); }
  await shot('04-detail');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.keyboard.press('D');
  await page.waitForTimeout(300);
  await shot('05-discoveries');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.keyboard.press('?');
  await page.waitForTimeout(300);
  await shot('06-help');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const menuBtn = page.locator('.menu-btn');
  if (await menuBtn.count()) {
    await menuBtn.click();
    await page.waitForTimeout(300);
    await shot('07-ingame-menu');
  }
  await ctx.close();
}
await browser.close();
console.log(report.join('\n'));
