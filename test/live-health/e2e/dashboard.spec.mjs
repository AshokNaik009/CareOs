import { test, expect } from '@playwright/test';
import { buildReport, shiftDate } from '../../../lib/live-health/analysis.mjs';
import { emptyPreferences } from '../../../lib/live-health/alert-rules.mjs';

test.beforeEach(async ({ page }) => {
  await page.route('**/live-health/api/alerts', route => route.fulfill({ json: { ready: false, preferences: emptyPreferences(), events: [], expiresAt: '2026-09-26T08:00:00Z' } }));
});

const date = '2026-09-25';
const fixture = () => ({
  ...buildReport(Array.from({ length: 31 }, (_, i) => ({
    date: shiftDate(date, i - 30), recovery: 75, hrv: 60, resting_hr: 55, sleep_hours: 8,
    sleep_performance: 95, sleep_efficiency: 92, strain: 10, spo2: 97, respiratory_rate: 15,
    stages: { light: 4, deep: 2, rem: 2, awake: 0.5 }, workouts: [],
  })), date),
  timeZone: 'UTC', fetched_at: `${date}T08:00:00Z`,
});

async function connected(page, data = fixture()) {
  await page.route('**/live-health/api/session', route => route.fulfill({ json: { configured: true, connected: true } }));
  await page.route('**/live-health/api/report', route => route.fulfill({ json: data }));
}

test('unconfigured app shows honest empty states and setup instructions', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/live-health');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your day, in perspective.');
  await expect(page.getByRole('button', { name: 'Server setup needed' })).toBeDisabled();
  await expect(page.getByText('No sample readings')).toBeVisible();
  await expect(page.getByText('WHOOP_CLIENT_SECRET', { exact: true })).toBeVisible();
  await expect(page.getByText('Awaiting your data')).toHaveCount(4);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('empty-desktop.png'), fullPage: true });
});

test('configured app offers module OAuth connection without exposing secrets', async ({ page }) => {
  await page.route('**/live-health/api/session', route => route.fulfill({ json: { configured: true, connected: false } }));
  await page.goto('/live-health');
  await expect(page.getByRole('link', { name: 'Connect WHOOP', exact: true })).toHaveAttribute('href', '/live-health/auth/whoop');
  await expect(page.getByText('WHOOP_CLIENT_SECRET', { exact: true })).not.toBeVisible();
});

test('connected dashboard shows baselines, trends, chart, and exact JSON', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await connected(page);
  await page.goto('/live-health');
  await expect(page.getByText('WHOOP connected', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your next best moves' })).toBeVisible();
  await expect(page.getByText('green recovery', { exact: true })).toBeVisible();
  await expect(page.getByText('30/30 days')).toHaveCount(9);
  await expect(page.getByText('0/30 days', { exact: true })).toHaveCount(3);
  await page.getByRole('button', { name: '7 days', exact: true }).click();
  await expect(page.getByRole('button', { name: '7 days', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('combobox', { name: 'Metric', exact: true }).selectOption('sleep_hours');
  await expect(page.getByRole('img', { name: /Sleep duration over the last 7 days/ })).toBeVisible();
  await page.getByText('View structured analysis JSON', { exact: true }).click();
  expect(JSON.parse(await page.locator('.lh-json pre').innerText())).toEqual(fixture().analysis);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('connected-desktop.png'), fullPage: true });
});

test('profile goal is sent to the backend rather than changing measurements in React', async ({ page }) => {
  await connected(page);
  await page.goto('/live-health');
  await expect(page.getByRole('heading', { name: 'Your next best moves' })).toBeVisible();
  const request = page.waitForRequest(req => req.url().endsWith('/live-health/api/report') && req.postDataJSON().profile.goal === 'recovery');
  await page.getByLabel('Current goal').selectOption('recovery');
  expect((await request).postDataJSON().profile.age).toBeNull();
});

test('API failure is visible and retry can recover without stale readings', async ({ page }) => {
  await page.route('**/live-health/api/session', route => route.fulfill({ json: { configured: true, connected: true } }));
  let failing = true;
  await page.route('**/live-health/api/report', route => route.fulfill(failing ? { status: 429, json: { error: 'WHOOP rate limit reached. Try again later.' } } : { json: fixture() }));
  await page.goto('/live-health');
  await expect(page.getByRole('alert')).toContainText('WHOOP rate limit');
  await expect(page.getByText('green recovery', { exact: true })).not.toBeVisible();
  failing = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByText('green recovery', { exact: true })).toBeVisible();
});

test('expired access clears loading state and offers reconnection', async ({ page }) => {
  await page.route('**/live-health/api/session', route => route.fulfill({ json: { configured: true, connected: true } }));
  await page.route('**/live-health/api/report', route => route.fulfill({ status: 401, json: { error: 'Please reconnect your WHOOP account.' } }));
  await page.goto('/live-health');
  await expect(page.getByRole('link', { name: 'Connect WHOOP', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).not.toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Please reconnect');
});

test('missing recovery is not shown as green or stable', async ({ page }) => {
  await connected(page, { ...buildReport([], date), fetched_at: `${date}T08:00:00Z`, timeZone: 'UTC' });
  await page.goto('/live-health');
  await expect(page.getByText('Not scored', { exact: true })).toBeVisible();
  await expect(page.getByText('Recent trend: stable')).not.toBeVisible();
  await page.getByText('View structured analysis JSON', { exact: true }).click();
  expect(JSON.parse(await page.locator('.lh-json pre').innerText()).trends.hrv).toBeNull();
});

test('concerning patterns render doctor guidance prominently', async ({ page }) => {
  const data = fixture();
  data.analysis.health_flag = 'Consider checking with a doctor: blood oxygen has been repeatedly low. Wearable readings are not a diagnosis.';
  await connected(page, data);
  await page.goto('/live-health');
  await expect(page.getByRole('alert')).toContainText('Consider checking with a doctor');
});

test('disconnect requires confirmation and clears the displayed report', async ({ page }) => {
  await connected(page);
  let disconnected = false;
  await page.route('**/live-health/api/disconnect', route => { disconnected = true; return route.fulfill({ json: { ok: true } }); });
  await page.goto('/live-health');
  await expect(page.getByText('green recovery', { exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Disconnect WHOOP' }).click();
  expect(disconnected).toBe(false);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Disconnect WHOOP' }).click();
  await expect(page.getByRole('link', { name: 'Connect WHOOP', exact: true })).toBeVisible();
  await expect(page.getByText('green recovery', { exact: true })).not.toBeVisible();
  expect(disconnected).toBe(true);
});

test('mobile layout fits the viewport with accessible navigation', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await connected(page);
  await page.goto('/live-health');
  await expect(page.getByRole('heading', { name: 'Your next best moves' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole('link', { name: 'Your baseline', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('connected-mobile.png'), fullPage: true });
});

test('sleep stages, workouts, exact readings and JSON copy remain available', async ({ page }) => {
  const data = fixture();
  data.current.workouts = [{ id: 'w1', sport: 'Running', duration_minutes: 60, strain: 12, zones: { 0: 0, 1: 0.5, 2: 0.5, 3: null, 4: null, 5: null } }];
  await connected(page, data);
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.copiedAnalysis = value; } } }));
  await page.goto('/live-health');
  await expect(page.getByRole('img', { name: 'Sleep stages; durations listed below' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Running', exact: true })).toBeVisible();
  await page.getByText('Heart-rate zones', { exact: true }).click();
  await expect(page.getByText('Zone 1: 0h 30m', { exact: true })).toBeVisible();
  await expect(page.getByText('Zone 3: Not available', { exact: true })).toBeVisible();
  await page.getByText('View exact readings', { exact: true }).click();
  await expect(page.locator('#history table tbody tr')).toHaveCount(30);
  await page.getByText('View structured analysis JSON', { exact: true }).click();
  await page.getByRole('button', { name: 'Copy JSON', exact: true }).click();
  expect(JSON.parse(await page.evaluate(() => window.copiedAnalysis))).toEqual(data.analysis);
  await page.getByText('Personal context. Transparent rules.', { exact: false }).click();
  await expect(page.getByText(/not clinically validated medical thresholds/)).toBeVisible();
});

test('module routes and existing CareOs APIs remain distinct', async ({ request, page }) => {
  for (const path of ['/live-health', '/live-health/', '/live-health/index.html']) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain('Rafeeq — Live Health');
  }
  expect((await request.post('/live-health/api/report', { headers: { Origin: 'http://localhost:3100' }, data: { timeZone: 'UTC' } })).status()).toBe(401);
  expect((await request.get('/live-health/api/unknown')).status()).toBe(404);
  expect((await (await request.get('/api/patients')).json()).length).toBe(2);
  expect((await (await request.get('/api/population')).json()).members.length).toBe(40);
  await page.goto('/patient.html');
  await expect(page.getByRole('heading', { name: 'Fatima Al Mansoori' })).toBeVisible();
  await page.getByRole('link', { name: 'Live Health', exact: true }).click();
  await expect(page).toHaveURL(/\/live-health$/);
  await expect(page.getByRole('button', { name: 'Reset demo' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Care OS', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Outreach worklist' })).toBeVisible();
});

test('Live Health uses CareOs styling and does not load its voice agents', async ({ page }) => {
  const urls = [];
  page.on('request', request => urls.push(request.url()));
  await page.goto('/live-health');
  expect(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(231, 226, 216)');
  expect(await page.locator('.card').first().evaluate(el => getComputedStyle(el).borderRadius)).toBe('0px');
  expect(urls.some(url => url.includes('voice-sdk') || url.includes('/api/events') || url.includes('elevenlabs'))).toBe(false);
});
