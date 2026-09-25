import { test, expect } from '@playwright/test';
import { emptyPreferences } from '../../../lib/live-health/alert-rules.mjs';
import { buildReport } from '../../../lib/live-health/analysis.mjs';

async function setup(page, ready = true) {
  let state = { ready, preferences: emptyPreferences(), events: [], expiresAt: '2026-09-26T10:00:00Z', lastCheckedAt: null };
  const saved = [];
  await page.route('**/live-health/api/session', route => route.fulfill({ json: { configured: true, connected: true } }));
  await page.route('**/live-health/api/report', route => route.fulfill({ json: { ...buildReport([], '2026-09-25'), fetched_at: '2026-09-25T10:00:00Z', timeZone: 'UTC' } }));
  await page.route('**/live-health/api/alerts', route => {
    if (route.request().method() === 'PUT') { saved.push(route.request().postDataJSON()); state = { ...state, preferences: saved.at(-1) }; }
    return route.fulfill({ json: state });
  });
  await page.route('**/live-health/api/alerts/pause', route => {
    state = { ...state, preferences: { ...state.preferences, enabled: false } };
    return route.fulfill({ json: state });
  });
  await page.goto('/live-health');
  await expect(page.getByRole('button', { name: 'Save alert preferences' })).toBeEnabled();
  return saved;
}

test('the Node server forwards both Retell webhook paths to signature verification', async ({ request }) => {
  for (const path of ['/retell/webhook', '/retell/webhook/', '/live-health/webhooks/retell']) {
    const response = await request.post(path, { data: { event: 'call_started', call: { call_id: 'test-only' } } });
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error: 'Invalid webhook signature.' });
  }
});

test('illustrated alert cards follow methodology and unsupported signals cannot be selected', async ({ page }, testInfo) => {
  await setup(page);
  expect(await page.locator('#method').evaluate(el => el.nextElementSibling.id)).toBe('emergency-alerts');
  await expect(page.locator('.lh-alert-tile')).toHaveCount(8);
  for (const name of ['Abnormal heartbeat', 'High blood pressure', 'Low blood pressure']) await expect(page.getByRole('checkbox', { name, exact: true })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'High resting heart rate', exact: true })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'High resting heart rate', exact: true }).check();
  await expect(page.getByRole('spinbutton', { name: 'High resting heart rate threshold' })).toHaveValue('');
  await page.getByRole('spinbutton', { name: 'High resting heart rate threshold' }).fill('95');
  await page.locator('#emergency-alerts').screenshot({ path: testInfo.outputPath('alert-section-desktop.png') });
});

test('contact alerts require consent, explicit confirmation, and preserve saved preferences', async ({ page }) => {
  const saved = await setup(page);
  const enable = page.getByRole('checkbox', { name: /Let Rafeeq call/ });
  await expect(enable).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Low blood oxygen', exact: true }).check();
  await page.getByRole('spinbutton', { name: 'Low blood oxygen threshold' }).fill('93');
  await page.getByLabel('Your name', { exact: true }).fill('Alex');
  await page.getByLabel('Contact name', { exact: true }).fill('Sam');
  await page.getByLabel('Contact phone', { exact: true }).fill('+12025550123');
  await page.getByRole('checkbox', { name: /I have this contact/ }).check();
  await enable.check();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Save alert preferences' }).click();
  expect(saved).toHaveLength(0);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Save alert preferences' }).click();
  await expect(page.getByRole('status')).toContainText('Only readings measured after this save');
  expect(saved).toHaveLength(1);
  expect(saved[0].rules).toEqual({ low_spo2: 93 });
  expect(saved[0].enabled).toBe(true);
  await page.reload();
  await expect(page.getByLabel('Contact name', { exact: true })).toHaveValue('Sam');
  await expect(page.getByText('Calls enabled', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause automatic calls' }).click();
  await expect(page.getByText('Calls are off', { exact: true })).toBeVisible();
  await expect(enable).not.toBeChecked();
});

test('server setup gates calls but permits saving preferences with calls off', async ({ page }) => {
  const saved = await setup(page, false);
  await page.getByRole('checkbox', { name: /I have this contact/ }).check();
  await expect(page.getByRole('checkbox', { name: /Let Rafeeq call/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Save alert preferences' }).click();
  await expect(page.getByRole('status')).toContainText('Automatic calls are off');
  expect(saved[0].enabled).toBe(false);
});

test('alert save errors stay visible and failed saves do not show calls enabled', async ({ page }) => {
  await setup(page);
  await page.route('**/live-health/api/alerts', route => route.fulfill({ status: 400, json: { error: 'Contact number is not approved.' } }));
  await page.getByRole('button', { name: 'Save alert preferences' }).click();
  await expect(page.getByRole('alert')).toContainText('Contact number is not approved');
  await expect(page.getByText('Calls are off', { exact: true })).toBeVisible();
});

test('session expiry clears contact details and stops showing active monitoring', async ({ page }) => {
  await setup(page);
  await page.getByLabel('Contact name', { exact: true }).fill('Private contact');
  await page.route('**/live-health/api/alerts', route => route.fulfill({ status: 401, json: { error: 'Reconnect WHOOP.' } }));
  await page.reload();
  await expect(page.getByText('Session expired', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Contact name', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Save alert preferences' })).toBeDisabled();
});

test('alert form fits mobile and can be operated by keyboard', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  const checkbox = page.getByRole('checkbox', { name: 'High respiratory rate', exact: true });
  await checkbox.focus();
  await page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
  await page.getByRole('spinbutton', { name: 'High respiratory rate threshold' }).fill('22');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('#emergency-alerts').screenshot({ path: testInfo.outputPath('alert-section-mobile.png') });
});
