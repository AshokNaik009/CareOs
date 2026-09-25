import { test, expect } from '@playwright/test';
import { buildReport } from '../../../lib/live-health/analysis.mjs';
import { normalize } from '../../../lib/live-health/normalize.mjs';
import { createSampleData } from '../../../lib/live-health/sample.mjs';

async function mockBluetooth(page, options = {}) {
  await page.addInitScript(({ supported = true, error = null, delayed = false }) => {
    const characteristic = new EventTarget();
    characteristic.startNotifications = async () => characteristic;
    const device = new EventTarget();
    device.name = 'WHOOP test device';
    const requests = [];
    let disconnects = 0;
    let resolveChoice;
    device.gatt = {
      connected: false,
      async connect() { this.connected = true; return this; },
      disconnect() { disconnects++; this.connected = false; device.dispatchEvent(new Event('gattserverdisconnected')); },
      async getPrimaryService() { return { getCharacteristic: async () => characteristic }; },
    };
    Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: supported ? {
      requestDevice(options) {
        requests.push(options);
        if (error) return Promise.reject(new DOMException('Test failure', error));
        return delayed ? new Promise(resolve => { resolveChoice = resolve; }) : Promise.resolve(device);
      },
    } : undefined });
    window.bleTest = {
      requests,
      emit(bytes) { characteristic.value = new DataView(Uint8Array.from(bytes).buffer); characteristic.dispatchEvent(new Event('characteristicvaluechanged')); },
      drop() { device.gatt.disconnect(); },
      choose() { resolveChoice?.(device); },
      get connected() { return device.gatt.connected; },
      get disconnects() { return disconnects; },
    };
  }, options);
  await page.route('**/live-health/api/session', route => route.fulfill({ json: { configured: true, connected: false } }));
}

const panel = page => page.getByRole('region', { name: 'Live heart rate', exact: true });
const connect = async page => {
  await panel(page).getByRole('button', { name: 'Connect live heart rate', exact: true }).click();
  await expect(panel(page).getByText('Waiting for a reading', { exact: true })).toBeVisible();
};

async function mockRestDashboard(page) {
  const now = Date.parse('2026-09-25T00:05:00Z');
  const report = { ...buildReport(normalize(createSampleData(now), 'UTC'), '2026-09-25'), sample: true, source: 'mock_rest', timeZone: 'UTC', fetched_at: new Date(now).toISOString(), live_bpm: 180 };
  await page.route('**/live-health/api/session', route => route.fulfill({ json: { configured: false, connected: true, sample: true, sampleAvailable: true } }));
  await page.route('**/live-health/api/report', route => route.fulfill({ json: report }));
  return report;
}

test('mock REST metrics never supply live BPM or reach alert APIs', async ({ page }, testInfo) => {
  await mockBluetooth(page);
  const report = await mockRestDashboard(page);
  await page.clock.install();
  const alerts = [];
  page.on('request', request => { if (request.url().includes('/api/alerts')) alerts.push(request.url()); });
  await page.goto('/live-health');
  await expect(page.getByText('REST metrics are mock data.', { exact: true })).toBeVisible();
  await expect(page.locator('.lh-metric .source')).toHaveText(['Mock REST', 'Mock REST', 'Mock REST', 'Mock REST']);
  await expect(page.getByText('WHOOP demo connected', { exact: true })).toBeVisible();
  await expect(page.getByLabel('WHOOP demo connection')).toContainText('Connected · Demo');
  const format = value => new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value);
  for (const [index, metric] of ['hrv', 'resting_hr', 'sleep_hours', 'strain'].entries()) {
    const card = page.locator('.lh-metric').nth(index);
    await expect(card.locator('.lh-metric-value')).toContainText(format(report.current[metric]));
    await expect(card.locator('.lh-averages strong')).toHaveText([format(report.baselines[metric].week.average), format(report.baselines[metric].month.average)]);
    await expect(card).not.toContainText('Awaiting your data');
  }
  await expect(panel(page).getByText('Real sensor only. Never mocked.', { exact: true })).toBeVisible();
  await expect(panel(page).getByTestId('live-bpm')).toHaveText('—');
  await expect(page.getByRole('link', { name: 'Connect WHOOP', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save alert preferences' })).toBeDisabled();
  await expect(page.locator('#emergency-alerts')).toContainText('Calls disabled: REST metrics are mocked.');
  await connect(page);
  await expect(panel(page).getByTestId('live-bpm')).toHaveText('—');
  await page.evaluate(() => window.bleTest.emit([0, 83]));
  await expect(panel(page).getByTestId('live-bpm')).toHaveText('83');
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  await page.route('**/live-health/api/report', async route => { await waiting; await route.fulfill({ json: report }); });
  const refresh = page.waitForRequest('**/live-health/api/report');
  await page.getByRole('button', { name: 'Refresh mock metrics' }).click();
  await refresh;
  await expect(page.getByRole('button', { name: 'Syncing…' })).toBeDisabled();
  await expect(page.locator('.lh-metrics')).not.toContainText('Awaiting your data');
  await expect(page.locator('.lh-metric-value')).toHaveCount(4);
  release();
  await expect(page.getByRole('button', { name: 'Refresh mock metrics' })).toBeEnabled();
  await expect(panel(page).getByTestId('live-bpm')).toHaveText('83');
  expect(await page.evaluate(() => window.bleTest.disconnects)).toBe(0);
  await page.clock.fastForward(10001);
  await expect(panel(page).getByTestId('live-bpm')).toHaveText('—');
  await expect(page.locator('.lh-metric-value').first()).not.toHaveText('—');
  await page.evaluate(() => window.bleTest.emit([0, 84]));
  await expect(panel(page).getByTestId('live-bpm')).toHaveText('84');
  expect(alerts).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('mock-rest-real-sensor.png'), fullPage: true });
});

test('mock REST export is labelled and cannot invent heart rate in an unsupported browser', async ({ page }) => {
  await mockBluetooth(page, { supported: false });
  const report = await mockRestDashboard(page);
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.copiedAnalysis = value; } } }));
  await page.goto('/live-health');
  await expect(page.getByRole('button', { name: 'Refresh mock metrics' })).toBeEnabled();
  await expect(panel(page).getByTestId('live-bpm')).toHaveText('—');
  await expect(panel(page).getByRole('button', { name: 'Connect live heart rate' })).toBeDisabled();
  await page.getByText('View structured analysis JSON', { exact: true }).click();
  await page.getByRole('button', { name: 'Copy JSON', exact: true }).click();
  expect(JSON.parse(await page.evaluate(() => window.copiedAnalysis))).toEqual({ source: 'mock_rest', sample: true, analysis: report.analysis });
});

test('Bluetooth is opt-in and can be used without a cloud session', async ({ page }) => {
  await mockBluetooth(page);
  await page.goto('/live-health');
  await expect(panel(page).getByTestId('live-bpm')).toHaveText('—');
  await expect(panel(page).getByText('Not paired', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.bleTest.requests.length)).toBe(0);
  await panel(page).getByText('How to connect your WHOOP', { exact: true }).click();
  await expect(panel(page).getByText('Device Settings', { exact: true })).toBeVisible();
  await connect(page);
  expect(await page.evaluate(() => window.bleTest.requests.length)).toBe(1);
  await expect(panel(page).getByTestId('live-bpm')).toHaveText('—');
});

test('notifications update the real value, receipt time and sensor name without network uploads', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await mockBluetooth(page);
  await page.goto('/live-health');
  await connect(page);
  const network = [];
  page.on('request', request => { if (['fetch', 'xhr'].includes(request.resourceType())) network.push(request.url()); });
  await page.evaluate(() => window.bleTest.emit([0, 74]));
  await expect(panel(page).getByTestId('live-bpm')).toHaveText('74');
  await expect(panel(page).getByText('Live Bluetooth', { exact: true })).toBeVisible();
  await expect(panel(page).getByText('Selected sensor: WHOOP test device', { exact: true })).toBeVisible();
  await expect(panel(page).getByText(/Last valid reading received at/)).toBeVisible();
  await page.evaluate(() => window.bleTest.emit([1, 44, 1]));
  await expect(panel(page).getByTestId('live-bpm')).toHaveText('300');
  expect(network).toEqual([]);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(errors).toEqual([]);
  await panel(page).screenshot({ path: testInfo.outputPath('live-heart-rate-desktop.png') });
});

test('stale values disappear after ten seconds and new data resumes the live state', async ({ page }) => {
  await mockBluetooth(page);
  await page.clock.install();
  await page.goto('/live-health');
  await connect(page);
  await page.evaluate(() => window.bleTest.emit([0, 76]));
  await expect(panel(page).getByTestId('live-bpm')).toHaveText('76');
  await page.clock.fastForward(10001);
  await expect(panel(page).getByText('Reading stale', { exact: true })).toBeVisible();
  await expect(panel(page).getByTestId('live-bpm')).toHaveText('—');
  await page.evaluate(() => window.bleTest.emit([0, 78]));
  await expect(panel(page).getByText('Live Bluetooth', { exact: true })).toBeVisible();
  await expect(panel(page).getByTestId('live-bpm')).toHaveText('78');
});

test('contact loss and malformed packets cannot leave old heart rate on screen', async ({ page }) => {
  await mockBluetooth(page);
  await page.goto('/live-health');
  await connect(page);
  await page.evaluate(() => window.bleTest.emit([0, 72]));
  await page.evaluate(() => window.bleTest.emit([4, 72]));
  await expect(panel(page).getByText('Check sensor fit', { exact: true })).toBeVisible();
  await expect(panel(page).getByTestId('live-bpm')).toHaveText('—');
  await page.evaluate(() => window.bleTest.emit([1, 72]));
  await expect(panel(page).getByText('Unreadable signal', { exact: true })).toBeVisible();
  await expect(panel(page).getByTestId('live-bpm')).toHaveText('—');
});

test('disconnect clears values and late notifications are ignored', async ({ page }) => {
  await mockBluetooth(page);
  await page.goto('/live-health');
  await connect(page);
  await page.evaluate(() => window.bleTest.emit([0, 75]));
  await panel(page).getByRole('button', { name: 'Disconnect Bluetooth', exact: true }).click();
  await expect(panel(page).getByTestId('live-bpm')).toHaveText('—');
  await expect(panel(page).getByText('No live reading received yet.', { exact: true })).toBeVisible();
  await page.evaluate(() => window.bleTest.emit([0, 90]));
  await expect(panel(page).getByTestId('live-bpm')).toHaveText('—');
  expect(await page.evaluate(() => window.bleTest.connected)).toBe(false);
  await connect(page);
  await page.evaluate(() => window.bleTest.drop());
  await expect(panel(page).getByText('Disconnected', { exact: true })).toBeVisible();
  await expect(panel(page).getByTestId('live-bpm')).toHaveText('—');
});

test('unsupported browsers show guidance without a fake connect action', async ({ page }) => {
  await mockBluetooth(page, { supported: false });
  await page.goto('/live-health');
  await expect(panel(page).getByRole('button', { name: 'Connect live heart rate' })).toBeDisabled();
  await expect(panel(page).getByText(/Safari and Firefox are not supported/)).toBeVisible();
  await expect(panel(page).getByTestId('live-bpm')).toHaveText('—');
});

test('cancelled picker is not a scary error and permissions failures are actionable', async ({ page }) => {
  await mockBluetooth(page, { error: 'NotFoundError' });
  await page.goto('/live-health');
  await panel(page).getByRole('button', { name: 'Connect live heart rate' }).click();
  await expect(panel(page).getByText(/No device selected/)).toBeVisible();
  await expect(panel(page).getByRole('alert')).not.toBeVisible();
});

test('permission denial shows a clear Mac and browser permission hint', async ({ page }) => {
  await mockBluetooth(page, { error: 'NotAllowedError' });
  await page.goto('/live-health');
  await panel(page).getByRole('button', { name: 'Connect live heart rate' }).click();
  await expect(panel(page).getByRole('alert')).toContainText('macOS Privacy & Security');
  await expect(panel(page).getByRole('button', { name: 'Connect live heart rate' })).toBeEnabled();
});

test('cancel pairing invalidates a late chooser result', async ({ page }) => {
  await mockBluetooth(page, { delayed: true });
  await page.goto('/live-health');
  await panel(page).getByRole('button', { name: 'Connect live heart rate' }).click();
  await panel(page).getByRole('button', { name: 'Cancel pairing' }).click();
  await page.evaluate(() => window.bleTest.choose());
  await expect(panel(page).getByRole('button', { name: 'Connect live heart rate' })).toBeEnabled();
  await expect(panel(page).getByText('Disconnected', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.bleTest.connected)).toBe(false);
});

test('cloud sync does not interrupt Bluetooth, but signing out clears its readings', async ({ page }) => {
  await mockBluetooth(page);
  await page.route('**/live-health/api/session', route => route.fulfill({ json: { configured: true, connected: true } }));
  await page.route('**/live-health/api/report', route => route.fulfill({ json: { ...buildReport([], '2026-09-25'), fetched_at: '2026-09-25T08:00:00Z' } }));
  await page.route('**/live-health/api/logout', route => route.fulfill({ json: { ok: true } }));
  await page.goto('/live-health');
  await expect(page.getByRole('button', { name: 'Sync WHOOP' })).toBeVisible();
  await connect(page);
  await page.evaluate(() => window.bleTest.emit([0, 73]));
  await page.getByRole('button', { name: 'Sync WHOOP' }).click();
  await expect(page.getByRole('button', { name: 'Sync WHOOP' })).toBeVisible();
  await expect(panel(page).getByTestId('live-bpm')).toHaveText('73');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(panel(page).getByTestId('live-bpm')).toHaveText('—');
  expect(await page.evaluate(() => window.bleTest.connected)).toBe(false);
});

test('page navigation releases the Bluetooth connection', async ({ page }) => {
  await mockBluetooth(page);
  await page.goto('/live-health');
  await connect(page);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  expect(await page.evaluate(() => window.bleTest.connected)).toBe(false);
  await expect(panel(page).getByTestId('live-bpm')).toHaveText('—');
});

test('live readings and setup instructions fit a narrow viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockBluetooth(page);
  await page.goto('/live-health');
  await connect(page);
  await page.evaluate(() => window.bleTest.emit([0, 71]));
  await panel(page).getByText('How to connect your WHOOP').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel(page).screenshot({ path: testInfo.outputPath('live-heart-rate-mobile.png') });
});
