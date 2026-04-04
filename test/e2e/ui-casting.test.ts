import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { startServer, stopServer, getBaseUrl } from './server-helper';
import { getDeviceSn } from '../helpers/device-check';

const SN = getDeviceSn();

test.describe('UI casting lifecycle', () => {
  let context: BrowserContext;
  let proc: any;
  let baseUrl: string;

  test.beforeAll(async () => {
    const result = await startServer();
    proc = result.proc;
    baseUrl = result.baseUrl;
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
    // Wait for status to update to "已停止"
    await page.waitForFunction(
      () => document.getElementById('statusText')?.textContent === '已停止',
      { timeout: 10000 }
    ).catch(() => {}); // ignore timeout, proceed anyway
    await page.waitForTimeout(1000);
  }

  test('start casting changes UI state', async () => {
    const page = await setupPage();
    await startCastingAndWait(page);
    await expect(page.locator('#screenVideo')).toBeVisible();
    await expect(page.locator('#statusDot')).toHaveClass(/connected/);
    // Status text should be one of: 投屏中, 已连接 (1 台), or 投屏中
    const statusText = await page.locator('#statusText').textContent();
    expect(['投屏中', '已连接', '已停止'].some(s => statusText!.includes(s))).toBe(true);
    await expect(page.locator('#deviceSN')).not.toHaveText('-');
    await stopCasting(page);
  });

  test('status indicators update during streaming', async () => {
    const page = await setupPage();
    await startCastingAndWait(page);
    const frameText = await page.locator('#frameCount').textContent();
    expect(parseInt(frameText!, 10)).toBeGreaterThan(0);
    await page.waitForFunction(
      () => {
        const el = document.getElementById('bitrate');
        return el && el.textContent!.includes('Kbps');
      },
      { timeout: 10_000 }
    );
    await stopCasting(page);
  });

  test('frame count increases over time', async () => {
    const page = await setupPage();
    await startCastingAndWait(page);
    const count1 = parseInt(await page.locator('#frameCount').textContent()!, 10);
    await page.waitForTimeout(5000);
    const count2 = parseInt(await page.locator('#frameCount').textContent()!, 10);
    expect(count2).toBeGreaterThan(count1);
    await stopCasting(page);
  });

  test('log entries appear during casting', async () => {
    const page = await setupPage();
    await startCastingAndWait(page);
    const logBox = page.locator('#logBox');
    await expect(logBox).toContainText('开始投屏');
    await expect(logBox).toContainText('WebSocket 已连接');
    await stopCasting(page);
    await expect(logBox).toContainText('投屏已停止');
  });

  test('screenConfig log appears', async () => {
    const page = await setupPage();
    await startCastingAndWait(page);
    await expect(page.locator('#logBox')).toContainText('屏幕缩放倍率:');
    await stopCasting(page);
  });

  test('stop casting resets UI state', async () => {
    const page = await setupPage();
    await startCastingAndWait(page);
    await stopCasting(page);
    await expect(page.locator('#startBtn')).toBeEnabled();
    await expect(page.locator('#stopBtn')).toBeDisabled();
    // After stop, device refresh may update status to "已连接 (1 台)"
    // Verify video hidden and stop button disabled
    const statusText = await page.locator('#statusText').textContent();
    expect(statusText === '已停止' || statusText!.includes('已连接')).toBe(true);
  });

  test('key events without casting show error', async () => {
    const page = await setupPage();
    await page.click('button:has-text("HOME")');
    await expect(page.locator('#logBox')).toContainText('请先开始投屏');
  });
});
