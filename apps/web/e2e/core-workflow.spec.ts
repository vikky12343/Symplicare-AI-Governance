import { test, expect } from '@playwright/test';

test('auth workflow and navigation', async ({ page }) => {
  // Go to the login page
  await page.goto('/');
  await expect(page).toHaveTitle(/Care Governance/);

  // Fill in credentials for the seeded user
  await page.fill('input[name="email"]', 'manager@northgate.example');
  await page.fill('input[name="password"]', 'Governance2026!');
  await page.click('button[type="submit"]');

  // Verify successful login
  await expect(page.getByText('Governance overview')).toBeVisible();

  // Navigate to signals
  await page.click('text=Active signals');
  await expect(page).toHaveURL(/.*signals/);
});
