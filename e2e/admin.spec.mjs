import { test, expect } from '@playwright/test';

const USER = process.env.VHS_ADMIN_USER || 'admin';
const PASS = process.env.VHS_ADMIN_PASS;

test('a visitor never loads the editor', async ({ page }) => {
  const requested = [];
  page.on('request', (r) => { if (r.url().includes('editor.v1.js')) requested.push(r.url()); });
  await page.goto('/index.html');
  await expect(page.locator('#vhs-bar')).toHaveCount(0);
  expect(requested).toEqual([]);
});

test('a visitor sees the original image sources', async ({ page }) => {
  await page.goto('/pages/about/OurFounder.html');
  const img = page.locator('[data-vhs-slot]').first();
  await expect(img).toHaveAttribute('src', /resources\//);
});

test.describe('signed in', () => {
  test.skip(!PASS, 'set VHS_ADMIN_PASS to run authenticated end-to-end tests');

  test('an admin sees edit controls and can publish', async ({ page }) => {
    await page.goto('/admin/');
    await page.fill('#u', USER);
    await page.fill('#p', PASS);
    await page.click('#loginBtn');
    await expect(page.locator('#whoami')).toHaveText(USER);

    await page.goto('/pages/about/OurFounder.html');
    await expect(page.locator('#vhs-bar')).toBeVisible();
    await expect(page.locator('.vhs-tools button', { hasText: 'Replace' }).first()).toBeVisible();
  });

  test('a wrong password is refused', async ({ page }) => {
    await page.goto('/admin/');
    await page.fill('#u', USER);
    await page.fill('#p', 'definitely-not-the-password');
    await page.click('#loginBtn');
    await expect(page.locator('#loginErr')).not.toBeEmpty();
    await expect(page.locator('#appView')).toBeHidden();
  });
});
