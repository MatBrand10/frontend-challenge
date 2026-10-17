import { expect, test } from '@playwright/test';

async function chooseMockScenario(page: import('@playwright/test').Page, scenario: string) {
  await expect(page.locator('main')).toBeVisible();
  const result = await page.evaluate(async (selectedScenario) => {
    const response = await fetch('/api/__mock/scenario', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: selectedScenario }),
    });
    return { ok: response.ok, status: response.status, body: await response.text() };
  }, scenario);
  expect(result.ok, `Scenario request failed (${result.status}): ${result.body}`).toBeTruthy();
}

async function signIn(page: import('@playwright/test').Page, email = 'demo@marketplace.io', password = 'demo123') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  if (test.info().project.name === 'chromium-mobile') {
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await page.getByRole('button', { name: 'Close menu' }).click();
  } else {
    await expect(page.getByRole('link', { name: email.startsWith('collector') ? /Mateo Cruz/ : /Nina Vale/ })).toBeVisible();
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('main')).toBeVisible();
  await page.evaluate(async () => {
    await fetch('/api/__mock/reset', { method: 'POST' });
  });
  await page.reload();
});

test('shows the catalog and updates search results', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Marketplace' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Aurora Bloom' })).toBeVisible();

  await page.getByRole('textbox', { name: 'Search NFTs' }).fill('Chrome');
  await page.getByRole('button', { name: 'Apply filters' }).click();

  await expect(page.getByRole('heading', { name: 'Chrome Drift' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Aurora Bloom' })).toHaveCount(0);
  await expect(page).toHaveURL(/q=Chrome/);
});

test('supports direct NFT detail navigation and missing item feedback', async ({ page }) => {
  await page.goto('/nft/nft-1');
  await expect(page.getByRole('heading', { name: 'Aurora Bloom' })).toBeVisible();

  await page.goto('/nft/not-found');
  await expect(page.getByText('NFT not found.')).toBeVisible();
});

test('redirects private routes to login and restores session after login', async ({ page }) => {
  await page.goto('/checkout');
  await expect(page).toHaveURL(/login/);

  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/checkout/);
  await expect(page.getByText('Your cart is empty.')).toBeVisible();
});

test('renders an accessible not-found state for unknown paths', async ({ page }) => {
  await page.goto('/missing-page');
  await expect(page.getByText('This page does not exist.')).toBeVisible();
});

test('preserves a visitor cart through login and completes a simulated purchase', async ({ page }) => {
  await page.goto('/nft/nft-1');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByText('Aurora Bloom').first()).toBeVisible();
  await page.getByRole('link', { name: 'Proceed to checkout' }).click();

  await expect(page).toHaveURL(/login/);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/checkout/);
  await expect(page.getByText('Aurora Bloom').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm purchase' })).toBeEnabled();

  await page.getByRole('button', { name: 'Confirm purchase' }).click();
  await expect(page.getByRole('heading', { name: 'Order confirmed' })).toBeVisible();
  await expect(page.getByText(/Transaction:/)).toBeVisible();
});

test('keeps cart items when the simulated wallet rejects payment', async ({ page }) => {
  await page.goto('/nft/nft-1');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await page.getByRole('link', { name: 'Proceed to checkout' }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Simulated wallet result').selectOption('rejected');
  await page.getByRole('button', { name: 'Confirm purchase' }).click();

  await expect(page.getByRole('alert')).toContainText('Payment was rejected');
  await expect(page.getByText('Aurora Bloom').first()).toBeVisible();
});

test('applies deterministic mock network errors and allows retry recovery', async ({ page }) => {
  await chooseMockScenario(page, 'server-error');
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Mock service temporarily unavailable');

  await chooseMockScenario(page, 'default');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Aurora Bloom' })).toBeVisible();
});

test('receives NFT price updates through the mocked Socket.IO client', async ({ page }) => {
  await page.goto('/nft/nft-1');
  await expect(page.getByRole('heading', { name: 'Aurora Bloom' })).toBeVisible();
  await page.getByRole('button', { name: 'Add to cart' }).click();

  await chooseMockScenario(page, 'socket-price-change');
  await expect(page.locator('[aria-live="polite"]')).toContainText('nft-1 updated: 0.49 ETH');
  await expect(page.getByText('0.49 ETH').first()).toBeVisible();
});

test('ignores stale and duplicate Socket.IO NFT events', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Aurora Bloom' })).toBeVisible();

  await chooseMockScenario(page, 'socket-stale-duplicate');
  await expect(page.locator('[aria-live="polite"]')).toContainText('nft-1 updated: 0.51 ETH, 3 available.');
  await expect(page.getByText('0.51 ETH').first()).toBeVisible();
  await expect(page.getByText('0.49 ETH')).toHaveCount(0);
});

test('shows the empty catalog scenario and persists scenario selection after refresh', async ({ page }) => {
  await chooseMockScenario(page, 'empty-catalog');
  await page.reload();
  await expect(page.getByText('No NFTs match these filters.')).toBeVisible();

  await page.evaluate(async () => {
    await fetch('/api/__mock/reset', { method: 'POST' });
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Aurora Bloom' })).toBeVisible();
});

test('combines catalog filters and stores them in the URL', async ({ page }) => {
  await page.locator('select').nth(0).selectOption('Velocity');
  await page.locator('select').nth(1).selectOption('price-desc');
  await page.getByRole('button', { name: 'Apply filters' }).click();

  await expect(page.getByRole('heading', { name: 'Chrome Drift' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Aurora Bloom' })).toHaveCount(0);
  await expect(page).toHaveURL(/collection=Velocity/);
  await expect(page).toHaveURL(/sort=price-desc/);
});

test('expires the session, returns to login and resumes the protected route', async ({ page }) => {
  await signIn(page);
  await chooseMockScenario(page, 'expired-session');
  await page.goto('/profile');

  await expect(page).toHaveURL(/login/);
  await chooseMockScenario(page, 'default');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/profile/);
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
});

test('keeps favorites isolated when changing accounts', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Add Aurora Bloom to favorites' }).click();
  await expect(page.getByRole('button', { name: 'Remove Aurora Bloom from favorites' })).toBeVisible();
  if (test.info().project.name === 'chromium-mobile') {
    await page.getByRole('button', { name: 'Open menu' }).click();
  }
  await page.getByRole('button', { name: 'Sign out' }).click();

  await signIn(page, 'collector@marketplace.io', 'collector123');
  await expect(page.getByRole('button', { name: 'Add Aurora Bloom to favorites' })).toBeVisible();
});

test('persists cart quantities and applies the checkout coupon', async ({ page }) => {
  await page.goto('/nft/nft-1');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await page.getByRole('button', { name: 'Increase Aurora Bloom quantity' }).click();
  await page.reload();
  await expect(page.getByRole('main').getByText('2', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Proceed to checkout' }).click();
  await expect(page).toHaveURL(/login/);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/checkout/);
  await page.getByLabel('Coupon').fill('SAVE10');
  await expect(page.getByText('-0.084 ETH')).toBeVisible();
  await expect(page.getByText('Qty 2')).toBeVisible();
});

test('blocks checkout when inventory price changes after the cart was quoted', async ({ page }) => {
  await page.goto('/nft/nft-1');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await page.getByRole('link', { name: 'Proceed to checkout' }).click();
  await expect(page).toHaveURL(/login/);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/checkout/);
  await expect(page.getByRole('button', { name: 'Confirm purchase' })).toBeEnabled();

  await chooseMockScenario(page, 'changed-price');
  await page.getByRole('button', { name: 'Confirm purchase' }).click();
  await expect(page.getByRole('alert')).toContainText(/price|availability/i);
  await expect(page.getByRole('heading', { name: 'Order confirmed' })).toHaveCount(0);
});

test('updates profile and persists a newly added wallet', async ({ page }) => {
  await signIn(page);
  await page.goto('/profile');
  await page.getByLabel('Name', { exact: true }).fill('Nina Updated');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status')).toContainText('Profile saved.');

  await page.goto('/wallets');
  await page.getByLabel('Wallet label').fill('Test hardware wallet');
  await page.getByLabel('Wallet address').fill('0x1234567890ABCDEF');
  await page.getByRole('button', { name: 'Add wallet' }).click();
  await expect(page.getByRole('status')).toContainText('Wallet added.');
  await page.reload();
  await expect(page.getByText('Test hardware wallet')).toBeVisible();
});

test('recovers a timed-out order with the same idempotency key', async ({ page, isMobile }) => {
  test.skip(isMobile, 'This scenario intentionally waits for the API timeout.');
  await page.goto('/nft/nft-1');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await page.getByRole('link', { name: 'Proceed to checkout' }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/checkout/);
  await expect(page.getByRole('button', { name: 'Confirm purchase' })).toBeEnabled();
  await chooseMockScenario(page, 'pending-timeout');

  await page.getByRole('button', { name: 'Confirm purchase' }).click();
  await expect(page.getByRole('alert')).toContainText(/timeout/i, { timeout: 12_000 });
  const attemptedOrder = await page.evaluate(() => {
    const attempt = JSON.parse(sessionStorage.getItem('nft-marketplace-order-attempt') ?? 'null') as { key: string } | null;
    return attempt?.key;
  });
  await page.getByRole('button', { name: 'Confirm purchase' }).click();
  await expect(page).toHaveURL(/confirmation/);
  await expect(page.getByRole('heading', { name: 'Order confirmed' })).toBeVisible({ timeout: 12_000 });
  await expect(page.getByText(`Order ID: ${attemptedOrder}`)).toBeVisible();
});
