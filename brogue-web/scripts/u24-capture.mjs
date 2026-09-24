import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = new URL('../ai_docs/reports/u-24-evidence/', import.meta.url);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:5173/');
  await page.screenshot({ path: fileURLToPath(new URL('menu.png', out)), fullPage: true });
  await page.getByPlaceholder('例如 18451615').fill('437589121');
  await page.getByRole('button', { name: /新游戏|New Game/ }).click();
  await page.waitForTimeout(1200);
  writeFileSync(new URL('render-game.txt', out), await page.evaluate(() => window.render_game_to_text?.() ?? 'missing'));
  await page.keyboard.press('Shift+D');
  await page.waitForTimeout(300);
  if (await page.locator('.reference-panel').count() !== 1) throw new Error('Discoveries did not open');
  await page.screenshot({ path: fileURLToPath(new URL('discoveries.png', out)), fullPage: true });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: fileURLToPath(new URL('game.png', out)), fullPage: true });
  await page.keyboard.press('i');
  await page.waitForTimeout(250);
  await page.screenshot({ path: fileURLToPath(new URL('inventory.png', out)), fullPage: true });
} finally {
  await browser.close();
}
