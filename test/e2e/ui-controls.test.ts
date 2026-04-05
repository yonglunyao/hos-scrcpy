import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { startServer, stopServer, getBaseUrl } from './server-helper';
import { getDeviceSn } from '../helpers/device-check';

const SN = getDeviceSn();

test.describe('UI controls', () => {
  let context: BrowserContext;
  let proc: any;
  let _baseUrl: string;

  test.beforeAll(async () => {
    const result = await startServer();
    proc = result.proc;
    _baseUrl = result.baseUrl;
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

  async function setupPage(): Promise<Page> {
    const page = await context.newPage();
    await page.goto(`${getBaseUrl()}/`);
    await page.waitForFunction(
      () => {
        const sel = document.getElementById('deviceSelect') as HTMLSelectElement;
        return sel && sel.options.length > 0 && sel.options[0]!.value !== '加载中...';
      },
      { timeout: 10000 }
    );
    return page;
  }

  async function startCastingAndWait(page: Page): Promise<void> {
    await page.selectOption('#deviceSelect', SN!);
    await page.click('#startBtn');
    await page.waitForSelector('#statusDot.connected', { timeout: 30_000 });
    await expect(page.locator('#frameCount')).not.toHaveText('0', { timeout: 15_000 });
  }

  async function stopCasting(page: Page): Promise<void> {
    await page.click('#stopBtn');
    await page.waitForTimeout(1000);
  }

  test('HOME button sends key event', async () => {
    const page = await setupPage();
    await startCastingAndWait(page);
    await page.click('button:has-text("HOME")');
    await expect(page.locator('#logBox')).toContainText('按键: HOME');
    await stopCasting(page);
  });

  test('BACK button sends key event', async () => {
    const page = await setupPage();
    await startCastingAndWait(page);
    await page.click('button:has-text("BACK")');
    await expect(page.locator('#logBox')).toContainText('按键: BACK');
    await stopCasting(page);
  });

  test('all 6 control buttons exist', async () => {
    const page = await setupPage();
    const buttons = page.locator('.sidebar-column:nth-child(3) .btn');
    await expect(buttons).toHaveCount(6);
    await expect(buttons.nth(0)).toContainText('HOME');
    await expect(buttons.nth(1)).toContainText('BACK');
    await expect(buttons.nth(2)).toContainText('音量+');
    await expect(buttons.nth(3)).toContainText('音量-');
    await expect(buttons.nth(4)).toContainText('菜单');
    await expect(buttons.nth(5)).toContainText('电源');
  });

  test('keyboard Escape sends BACK', async () => {
    const page = await setupPage();
    await startCastingAndWait(page);
    await page.click('#statusDot');
    await page.keyboard.press('Escape');
    await expect(page.locator('#logBox')).toContainText('按键: BACK');
    await stopCasting(page);
  });

  test('keyboard Home sends HOME', async () => {
    const page = await setupPage();
    await startCastingAndWait(page);
    await page.click('#statusDot');
    await page.keyboard.press('Home');
    await expect(page.locator('#logBox')).toContainText('按键: HOME');
    await stopCasting(page);
  });

  test('keyboard ArrowUp sends VOLUME_UP', async () => {
    const page = await setupPage();
    await startCastingAndWait(page);
    await page.click('#statusDot');
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('#logBox')).toContainText('按键: VOLUME_UP');
    await stopCasting(page);
  });

  test('keyboard ArrowDown sends VOLUME_DOWN', async () => {
    const page = await setupPage();
    await startCastingAndWait(page);
    await page.click('#statusDot');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#logBox')).toContainText('按键: VOLUME_DOWN');
    await stopCasting(page);
  });

  test('keyboard P sends POWER', async () => {
    const page = await setupPage();
    await startCastingAndWait(page);
    await page.click('#statusDot');
    await page.keyboard.press('KeyP');
    await expect(page.locator('#logBox')).toContainText('按键: POWER');
    await stopCasting(page);
  });
});
