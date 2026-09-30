import { expect, test } from '@playwright/test';
import { TASK, firstRun } from './helpers';

test('first run reaches Today with one task in under 5 minutes', async ({ page }) => {
  const t0 = Date.now();
  await firstRun(page);
  expect(Date.now() - t0).toBeLessThan(5 * 60_000);
  await expect(page.getByText('Next', { exact: true })).toBeVisible();
  await expect(page.getByText('Three addresses written down')).toBeVisible();
  await expect(page.getByText('Plan more when you’re ready')).toBeVisible();
  // Hash routing survives a reload.
  await page.reload();
  await expect(page).toHaveURL(/#\/today$/);
  await expect(page.getByRole('heading', { name: TASK })).toBeVisible();
});

test('complete a task with actuals, cost and evidence in three taps after Start', async ({
  page,
}) => {
  await firstRun(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  // Tap 1
  await page.getByRole('button', { name: 'Begin' }).click();
  await expect(page.getByRole('timer')).toBeVisible();
  // Tap 2
  await page.getByRole('button', { name: 'Complete' }).click();
  await page.getByLabel('Minutes spent').fill('40');
  await page.getByRole('button', { name: '+ Add a cost' }).click();
  await page.getByLabel(/Actual cost/).fill('12.50');
  await page.getByLabel('Evidence note').fill('Three addresses in my notes app');
  // Tap 3
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('No open tasks.')).toBeVisible();
  await page.goto('./#/plan/list');
  await page.getByRole('button', { name: new RegExp(TASK) }).click();
  await expect(page.getByText(/40 min logged/)).toBeVisible();
});

test('a plan session asks gap questions one at a time', async ({ page }) => {
  await firstRun(page);
  await page.goto('./#/plan/questions');
  await page.getByRole('button', { name: 'Start Plan session' }).click();
  await expect(page.getByText(/Plan session ·/)).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'What number or fact would prove this is done?' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByRole('heading', { name: /How many hours a week/ })).toBeVisible();
  await page.getByLabel('Tue hours').fill('2');
  await page.getByLabel('Sat hours').fill('3');
  await page.getByRole('button', { name: 'Save answer' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Next question' }).click();
  // Skipped questions count toward the session's five, so this is the third shown.
  await expect(page.getByText(/Question 3 ·/)).toBeVisible();
  await expect(
    page.getByRole('heading', { name: /What has to be true just before/ }),
  ).toBeVisible();
  // The forecast now has capacity to work with.
  await page.goto('./#/today');
  await expect(page.getByText('Modeled finish (base)')).toBeVisible();
});

test('the handoff note comes first after a three-day gap', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-03-02T09:00:00') });
  await firstRun(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Begin' }).click();
  await page.getByRole('button', { name: 'Stop for now' }).click();
  await page.getByLabel('Minutes spent').fill('20');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'End', exact: true }).click();
  await page
    .getByLabel('Where did you stop, and what’s the very next step?')
    .fill('Found two spaces; next: call the one on Elm St');
  await page.getByRole('button', { name: 'Save and end' }).click();
  await expect(page.getByText(/Execute session ·/)).toHaveCount(0);

  await page.clock.setSystemTime(new Date('2026-03-05T10:00:00'));
  await page.reload();
  await expect(page.getByText(/Welcome back · 3 days away/)).toBeVisible();
  await expect(page.getByText('Found two spaces; next: call the one on Elm St')).toBeVisible();
  await expect(page.getByRole('heading', { name: TASK })).toHaveCount(0);
  await page.getByRole('button', { name: 'Nothing changed' }).click();
  await expect(page.getByRole('heading', { name: TASK })).toBeVisible();
});

test('dependency cycles are blocked with a message naming the tasks', async ({ page }) => {
  await firstRun(page);
  await page.goto('./#/plan/list');
  await page.getByRole('button', { name: 'Start Plan session' }).click();
  await page.getByLabel(/New task in/).fill('Visit the spaces');
  await page.getByLabel(/New task in/).press('Enter');
  await page.getByRole('button', { name: /Visit the spaces/ }).click();
  await page.getByLabel('Add a predecessor').selectOption({ label: TASK });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(TASK) }).click();
  await page.getByLabel('Add a predecessor').selectOption({ label: 'Visit the spaces' });
  await expect(
    page.getByText(/That would create a loop: .*Visit the spaces.*List three studio spaces/),
  ).toBeVisible();
});

test('export and import round-trip', async ({ page }) => {
  await firstRun(page);
  await page.goto('./#/settings');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export (JSON)' }).click();
  const file = await (await downloadPromise).path();
  await page.getByRole('button', { name: 'Delete all data' }).click();
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByRole('button', { name: 'Delete everything' }).click();
  await expect(page.locator('#q-C1')).toBeVisible();
  await page.goto('./#/settings');
  await page.locator('input[type=file]').setInputFiles(file);
  await page.getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByRole('heading', { name: TASK })).toBeVisible();
});

test('the demo graph renders with a critical path', async ({ page }) => {
  await page.goto('./#/settings');
  await page.getByRole('button', { name: 'Load the demo' }).click();
  await expect(page.getByText('Demo data')).toBeVisible();
  await page.goto('./#/plan/graph');
  await expect(page.locator('svg.graph .node')).toHaveCount(11);
  expect(await page.locator('svg.graph .edge.crit').count()).toBeGreaterThan(0);
  await expect(page.getByText(/Critical path:/)).toBeVisible();
});
