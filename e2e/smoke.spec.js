import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
    await page.goto('/');

    // Expect a title "to contain" a substring.
    await expect(page).toHaveTitle(/OverSeek/);
});

test('redirects to login when unauthenticated', async ({ page }) => {
    await page.goto('/orders');
    // Check for common login page elements since exact text might vary
    // "Sign In" or "Login" is typical. Let's look for the inputs.
    await expect(page.locator('input[type="password"]')).toBeVisible();
});
