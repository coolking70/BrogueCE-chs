import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
for (const width of [1280, 390]) {
  const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:5173/');
  await page.getByRole('button', { name: /New Game|新游戏|开始新游戏/ }).first().click();
  await page.waitForTimeout(500);
  await page.keyboard.press('D');
  await page.waitForTimeout(300);
  await page.getByRole('dialog', { name: /发现物品|Discovered items/ }).waitFor();
  await page.screenshot({ path: `ai_docs/reports/u-22-discoveries-${width}.png` });
  const discovery = await page.getByRole('dialog').innerText();
  if (!/Scrolls|卷轴/.test(discovery) || !/Wands|魔杖/.test(discovery)) throw new Error('discovery groups absent');
  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  await page.getByRole('dialog', { name: /命令帮助|Commands/ }).waitFor();
  await page.screenshot({ path: `ai_docs/reports/u-22-help-${width}.png` });
  const help = await page.getByRole('dialog').innerText();
  if (!/D/.test(help) || !/Esc/.test(help)) throw new Error('help entries absent');
  console.log(`${width}: D and ? dialogs open; keyboard closes; screenshots saved`);
  await page.close();
}
await browser.close();
