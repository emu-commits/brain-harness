import { expect, test } from '@playwright/test';
import { TASK, firstRun } from './helpers';

async function loadDemo(page: import('@playwright/test').Page) {
  await page.goto('./#/settings');
  await page.getByRole('button', { name: 'Load the demo' }).click();
  await expect(page.getByText('Demo data')).toBeVisible();
}

test('the WOOP check-in rehearses outcome, obstacle and plan, and drafts a revision for Plan', async ({
  page,
}) => {
  await loadDemo(page);
  await expect(page.getByRole('heading', { name: 'Picture the day it’s done.' })).toBeVisible();
  await expect(page.getByText('Three Saturdays in a row where every loaf sells')).toBeVisible();
  await page.getByRole('button', { name: 'I’ve pictured it' }).click();
  await page
    .getByLabel('What’s most likely to get in the way today?')
    .fill('market prep runs long');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('.woop .woop-plan')).toContainText('re-testing a recipe');
  await page.getByLabel(/And today, when/).fill('bake a half batch instead of skipping');
  await page.getByRole('button', { name: 'Not quite' }).click();
  await page
    .getByLabel('How would you put it now?')
    .fill('When I want to tweak a recipe, I will bake the card version first');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  // Today's own if-then shows for the rest of the day; the ritual is done.
  await expect(page.locator('.today-plan')).toContainText('market prep runs long');
  await expect(page.getByRole('heading', { name: 'Picture the day it’s done.' })).toHaveCount(0);

  // The revision waits for a Plan session (charter edits are Plan-only).
  await page.goto('./#/plan/charter');
  await expect(page.getByText(/From your check-in on/)).toBeVisible();
  await page.getByRole('button', { name: 'Start Plan session' }).click();
  await page.getByRole('button', { name: 'Use the new version' }).click();
  await expect(page.getByText(/From your check-in on/)).toHaveCount(0);
  await expect(page.getByLabel('When that shows up, what will you do?')).toHaveValue(
    'When I want to tweak a recipe, I will bake the card version first',
  );
});

test('stopping early offers your if-then and a 10-minute version', async ({ page }) => {
  await firstRun(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByLabel(/How long do you think this sitting will take/).fill('60');
  await page.getByRole('button', { name: 'Begin' }).click();
  await page.getByRole('button', { name: 'Stop for now' }).click();
  await expect(page.getByText('Is this that moment?')).toBeVisible();
  await expect(page.locator('.moment .woop-plan')).toContainText('I am waiting');
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await page
    .getByLabel('What’s a 10-minute version of what’s next?')
    .fill('Write down just one address');
  await page.getByRole('button', { name: 'Save this sitting and start 10 minutes' }).click();
  await expect(page.getByText('Write down just one address')).toBeVisible();
  await expect(page.getByLabel(/How long do you think this sitting will take/)).toHaveValue('10');
  await page.getByRole('button', { name: 'Begin' }).click();
  await expect(page.getByRole('timer')).toBeVisible();
  await expect(page.locator('.running')).toContainText('This sitting');
  await expect(page.locator('.running')).toContainText('Write down just one address');
});

test('completing a task shows what it unlocked and how close the milestone is', async ({
  page,
}) => {
  await loadDemo(page);
  await page.getByRole('button', { name: 'Skip for today' }).click();
  await page.getByRole('button', { name: 'Pick a different task' }).click();
  await page.locator('.pick', { hasText: 'Apply for the cottage food permit' }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Begin' }).click();
  await page.getByRole('button', { name: 'Complete' }).click();
  await page.getByLabel('Minutes spent').fill('50');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText('Now unlocked')).toBeVisible();
  await expect(page.locator('.unlocked')).toContainText('Permit approval');
  await expect(page.getByText('the wait can begin')).toBeVisible();
  await expect(page.getByText(/1 of 4 done · 3 left/)).toBeVisible();
  await expect(page.getByText(/50 min in total · your likely estimate was 1 h/)).toBeVisible();

  await page.getByRole('link', { name: 'See everything you’ve done →' }).click();
  await expect(page.getByRole('heading', { name: 'What you’ve done' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Apply for the cottage food permit' }),
  ).toBeVisible();
  await expect(page.getByText('Batch 3: 78% hydration, 45 min bake. Best crumb.')).toBeVisible();
});

test('reaching a milestone asks what it proved', async ({ page }) => {
  await firstRun(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Begin' }).click();
  await page.getByRole('button', { name: 'Complete' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Milestone reached:')).toBeVisible();
  await page
    .getByLabel('What did reaching this prove to you?')
    .fill('Small steps actually move it');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved to your memory log.')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: TASK })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /What you’ve done \(1\)/ })).toBeVisible();
});
