import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export const TASK = 'List three studio spaces to visit';

/** Walks the charter flow C1–C8. */
export async function firstRun(page: Page) {
  await page.goto('./');
  await page.locator('#q-C1').fill('Open a small ceramics studio');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('#q-C2').fill('The door is open with a price list on the wall');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('#q-C3').fill('2027-09-01');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('#q-C4').fill('My hands should matter more than my inbox');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('#q-C5').fill('I wait until I feel ready');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('#q-C6').fill('I notice I am waiting');
  await page.getByLabel('I will').fill('do the smallest version today');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('#q-C7').fill('A kiln and a lease are in place');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('#q-C8').fill(TASK);
  await page.getByLabel('When will you do it?').fill('Tuesday 7pm');
  await page.getByLabel('Where?').fill('Kitchen table');
  await page.getByLabel('How will you know it’s done?').fill('Three addresses written down');
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByRole('heading', { name: TASK })).toBeVisible();
}
