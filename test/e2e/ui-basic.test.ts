import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { startServer, stopServer, getBaseUrl } from './server-helper';
import { getDeviceSn } from '../helpers/device-check';

const SN = getDeviceSn();

test.describe('UI basic - page load', () => {
  let context: BrowserContext;
  let proc: any;

  test.beforeAll(async () => {
    const result = await startServer();
    proc = result.proc;
  });

  test.afterAll(async () => {
    await stopServer(proc);
  });

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext();
  });

  test.afterEach(async () => {
    await context?.close();
  });

  test('page loads with correct title and layout', async () => {
    const page = await context.newPage();
    await page.goto(`${getBaseUrl()}/`);
    await expect(page).toHaveTitle(/HarmonyOS Screen Cast/);
    // Video element should exist (may be hidden or visible depending on auto-connect)
    const video = page.locator('#screenVideo');
    await video.waitFor({ state: 'attached', timeout: 5000 });
    // Sidebar columns exist
    await expect(page.locator('.sidebar-column')).toHaveCount(4);
  });

  test('device dropdown loads from API', async () => {
    const page = await context.newPage();
    await page.goto(`${getBaseUrl()}/`);
    const select = page.locator('#deviceSelect');
    await page.waitForFunction(
      () => {
        const sel = document.getElementById('deviceSelect') as HTMLSelectElement;
        return sel && sel.options.length > 0 && sel.options[0]!.value !== '加载中...';
      },
      { timeout: 10000 }
    );
    if (SN) {
      await expect(select).toContainText(SN);
    } else {
      await expect(select).toContainText('未找到设备');
    }
  });

  test('initial button states', async () => {
    const page = await context.newPage();
    await page.goto(`${getBaseUrl()}/`);
    await expect(page.locator('#startBtn')).toBeEnabled();
    await expect(page.locator('#stopBtn')).toBeDisabled();
    await expect(page.locator('#refreshBtn')).toBeEnabled();
  });

  test('log box has initial entries', async () => {
    const page = await context.newPage();
    await page.goto(`${getBaseUrl()}/`);
    // Wait for JMuxer to load (adds a log entry)
    await page.waitForTimeout(3000);
    const entries = page.locator('.log-entry');
    const count = await entries.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('refresh button reloads device list', async () => {
    const page = await context.newPage();
    await page.goto(`${getBaseUrl()}/`);
    const select = page.locator('#deviceSelect');
    await select.waitFor({ state: 'visible' });
    await page.waitForFunction(
      () => {
        const sel = document.getElementById('deviceSelect') as HTMLSelectElement;
        return sel && sel.options.length > 0 && sel.options[0]!.value !== '加载中...';
      },
      { timeout: 10000 }
    );
    await page.click('#refreshBtn');
    await page.waitForTimeout(2000);
    const options = await select.locator('option').allTextContents();
    expect(options.length).toBeGreaterThan(0);
  });
});
