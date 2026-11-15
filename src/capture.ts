import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Browser } from 'playwright';
import type { MechReport } from './state';

/**
 * Opens a dish in headless Chromium with the network cut off, records what it
 * tried to do, and takes desktop and phone screenshots for the judges.
 */
export async function capture(
  browser: Browser,
  htmlPath: string,
  shotPrefix: string,
  meta: { hasTitle: boolean; hasDescription: boolean },
): Promise<{ mech: MechReport; shots: { desktop: string; mobile: string } }> {
  const consoleErrors: string[] = [];
  const networkAttempts: string[] = [];
  const shots = { desktop: `${shotPrefix}-desktop.jpg`, mobile: `${shotPrefix}-mobile.jpg` };

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('file:') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    networkAttempts.push(url.slice(0, 200));
    return route.abort();
  });
  page.on('console', (msg) => {
    // Blocked requests log their own error; those are counted as network attempts.
    if (msg.type() === 'error' && !msg.text().includes('net::ERR')) consoleErrors.push(msg.text().slice(0, 200));
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message.slice(0, 200)));
  page.on('dialog', (dialog) => void dialog.dismiss().catch(() => {}));

  let blank = true;
  let mobileOverflow = false;
  try {
    await page.goto(pathToFileURL(resolve(htmlPath)).href, { waitUntil: 'load', timeout: 15_000 });
    await page.waitForTimeout(1500);
    blank = await page.evaluate(
      () => document.body.querySelectorAll('*').length < 3 || document.body.getBoundingClientRect().height < 20,
    );
    await page.screenshot({ path: shots.desktop, type: 'jpeg', quality: 70 });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    await page.screenshot({ path: shots.mobile, type: 'jpeg', quality: 70 });
  } catch (err) {
    consoleErrors.push(`failed to load: ${(err as Error).message.slice(0, 160)}`);
    // The judges still need two images, even of a broken page.
    await page.screenshot({ path: shots.desktop, type: 'jpeg', quality: 70 }).catch(() => {});
    await page.screenshot({ path: shots.mobile, type: 'jpeg', quality: 70 }).catch(() => {});
  } finally {
    await context.close();
  }

  let score = 10;
  if (blank) score -= 5;
  if (networkAttempts.length) score -= 4;
  score -= Math.min(consoleErrors.length, 3);
  if (mobileOverflow) score -= 1;
  if (!meta.hasTitle || !meta.hasDescription) score -= 1;

  return {
    mech: {
      bytes: statSync(htmlPath).size,
      consoleErrors,
      networkAttempts,
      mobileOverflow,
      blank,
      hasTitle: meta.hasTitle,
      hasDescription: meta.hasDescription,
      score: Math.max(0, score),
    },
    shots,
  };
}
