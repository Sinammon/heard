import { test, expect } from '@playwright/test';
import { mockAIPractice } from './fixtures.js';
test('consented capture, automatic cards, failed AI playback, muted video, and reset', async ({
  page,
}) => {
  await mockAIPractice(page);
  let cardRequests = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/flashcards')) cardRequests++;
  });
  await page.route('**/api/sessions/*/analyze', (route) =>
    route.fulfill({ status: 503, json: { error: 'AI analysis unavailable. Retry later.' } }),
  );
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Start practicing' }).click();
  await page
    .getByLabel('Your practice script')
    .fill(
      'Today I want to share a simple idea. Practice turns an unfamiliar skill into something natural. A short daily habit can make a difference.',
    );
  await page.getByRole('button', { name: 'Set up my recording' }).click();
  await expect(page.getByRole('button', { name: 'Start practice' })).toBeDisabled();
  await page.locator('#consent').check();
  await page.locator('#camera-enabled').check();
  await page.locator('#enable-camera').click();
  await expect(page.locator('#camera-status')).toContainText('loaded', { timeout: 20000 });
  expect(await page.locator('#preview').evaluate((el) => getComputedStyle(el).transform)).toBe(
    'matrix(-1, 0, 0, 1, 0, 0)',
  );
  await page.getByRole('button', { name: 'Start practice' }).click();
  await expect(page.getByRole('button', { name: 'Finish practice' })).toBeVisible();
  await expect(page.locator('#timer')).not.toHaveText('00:00', { timeout: 8000 });
  await page.getByRole('button', { name: 'Finish practice' }).click();
  await expect(page.getByRole('heading', { name: 'Listen to your words.' })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.locator('audio')).toBeVisible();
  await expect(page.locator('.flashcard')).toHaveCount(3);
  expect(cardRequests).toBe(1);
  await expect(page.getByText('AI analysis unavailable. Retry later.')).toBeVisible();
  await expect
    .poll(() =>
      page.locator('audio').evaluate((el) => Number.isFinite(el.duration) && el.duration > 0),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Watch my delivery' }).click();
  await expect(page.locator('#review-player')).toBeVisible();
  expect(await page.locator('#review-player').evaluate((el) => el.muted)).toBe(true);
  await page.locator('#review-player').evaluate((el) => {
    el.muted = false;
  });
  await expect.poll(() => page.locator('#review-player').evaluate((el) => el.muted)).toBe(true);
  await page.getByRole('button', { name: 'Bring it together', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overall score unavailable' })).toBeVisible();
  await expect(page.locator('#chat-input')).toBeDisabled();
  await page.getByRole('button', { name: 'New practice' }).click();
  await expect(page.getByLabel('Your practice script')).toHaveValue(/Today I want/);
  await page.getByRole('button', { name: 'Set up my recording' }).click();
  await page.locator('#consent').check();
  await page.locator('#camera-enabled').check();
  await page.locator('#enable-camera').click();
  await page.getByRole('button', { name: 'Start practice' }).click();
  await expect(page.locator('.cue-card')).toContainText('Key point 1 / 3');
  await expect(page.locator('#recording-script')).not.toHaveAttribute('open');
  await expect(page.locator('#timer')).not.toHaveText('00:00');
  await page.getByRole('button', { name: 'Finish practice' }).click();
  await expect(page.locator('audio')).toBeVisible();
  expect(cardRequests).toBe(1);
  expect(errors).toEqual([]);
});
test('script generation and quota errors are visible without exposing a key', async ({ page }) => {
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { ok: true, aiConfigured: true } }),
  );
  await page.route('**/api/scripts', (route) =>
    route.fulfill({
      status: 429,
      json: { error: 'The free Gemini quota is currently exhausted. Retry later.' },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Start practicing' }).click();
  await page.getByRole('tab', { name: 'Draft with AI' }).click();
  await page.getByLabel('What would you like to talk about?').fill('Learning a new skill');
  await page.getByRole('button', { name: 'Generate a draft' }).click();
  await expect(page.getByRole('alert')).toContainText('quota');
  await expect(page.getByRole('button', { name: 'Generate a draft' })).toBeEnabled();
});
test('layout fits a small viewport and respects keyboard access', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#page-content')).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(
    await page
      .locator('.hero-copy')
      .evaluate((el) => el.getBoundingClientRect().right <= window.innerWidth),
  ).toBe(true);
  expect(
    await page.locator('.hero-copy h1').evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
});

test('home, about, and studio navigation preserve the script and support browser history', async ({
  page,
}) => {
  await page.goto('/#about');
  await expect(
    page.getByRole('heading', { name: 'Your voice. A little more room.' }),
  ).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Home', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'A little practice. A clearer voice.' }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: 'Your voice. A little more room.' }),
  ).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .locator('..')
    .getByRole('link', { name: 'Start practicing' })
    .click();
  await page.getByLabel('Your practice script').fill('This draft should survive page navigation.');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Our approach' })
    .click();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .locator('..')
    .getByRole('link', { name: 'Start practicing' })
    .click();
  await expect(page.getByLabel('Your practice script')).toHaveValue(
    'This draft should survive page navigation.',
  );
});

test('landing page review explorer, FAQ, and mobile about page are usable', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'How it works', exact: true }).click();
  const watch = page.getByRole('tab', { name: 'Watch', exact: true });
  await watch.click();
  await expect(page.locator('#demo-panel')).toContainText('See how your message lands.');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Reflect', exact: true })).toBeFocused();
  await expect(page.locator('#demo-panel')).toContainText('Choose your next small improvement.');
  await page.getByText('Does Heard measure confidence?', { exact: true }).click();
  await expect(page.getByText(/A webcam cannot measure how confident you feel/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Our approach' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Your voice. A little more room.' }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Home', exact: true })
    .click();
  expect(
    await page.locator('.hero-copy').evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('none');
});

test('completed reviews render safe evidence links and streamed coaching', async ({ page }) => {
  await mockAIPractice(page);
  const stage = {
    summary: 'You kept a steady rhythm. <img src=x onerror="window.bad=true">',
    strengths: [
      { title: 'A clear opening', detail: 'Your first idea is easy to follow.', evidenceIds: [] },
    ],
    improvements: [
      {
        title: 'Give the transition some space',
        detail: 'Try a deliberate breath.',
        evidenceIds: ['pause-1'],
      },
    ],
    limitations: ['This fixture tests rendering, not Gemini accuracy.'],
  };
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { ok: true, aiConfigured: true } }),
  );
  await page.route('**/api/sessions/*/analyze', (route) =>
    route.fulfill({ status: 202, json: { jobId: 'fixture', status: 'processing' } }),
  );
  await page.route('**/api/sessions/*/report', (route) =>
    route.fulfill({
      json: {
        status: 'complete',
        stages: {
          audio: stage,
          video: { ...stage, summary: 'Your shoulders stayed in view.' },
          combined: stage,
        },
        transcript: 'A clear opening.',
        evidence: [{ id: 'pause-1', category: 'pause', startMs: 250, endMs: 500 }],
        score: {
          score: null,
          reasons: ['This short fixture has insufficient delivery duration.'],
          penalties: { filler: 0, pace: 0, pause: 0, posture: 0 },
          coverage: { posture: 0 },
          metrics: { wpm: 120, fillers: 0, pauses: 1, postureDeviationPercent: 0 },
        },
      },
    }),
  );
  await page.route('**/api/sessions/*/chat', (route) =>
    route.fulfill({
      contentType: 'application/x-ndjson',
      body: '{"text":"Start with one clear idea."}\n{"done":true}\n',
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Start practicing' }).click();
  await page
    .getByLabel('Your practice script')
    .fill('A short practice script for testing complete reviews and coaching.');
  await page.getByRole('button', { name: 'Set up my recording' }).click();
  await page.locator('#consent').check();
  await page.locator('#camera-enabled').check();
  await page.locator('#enable-camera').click();
  await expect(page.getByRole('button', { name: 'Start practice' })).toBeEnabled();
  await page.getByRole('button', { name: 'Start practice' }).click();
  await expect(page.locator('#timer')).not.toHaveText('00:00', { timeout: 8000 });
  await page.getByRole('button', { name: 'Finish practice' }).click();
  await expect(page.getByText('Give the transition some space')).toBeVisible();
  expect(await page.evaluate(() => window.bad)).toBeUndefined();
  await page.getByRole('button', { name: 'At 00:00', exact: true }).click();
  await expect
    .poll(() => page.locator('#review-player').evaluate((el) => el.currentTime))
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: '2. Posture Analysis', exact: true }).click();
  await expect(page.getByText('Your shoulders stayed in view.')).toBeVisible();
  await page.getByRole('button', { name: 'Bring it together', exact: true }).click();
  await page.getByLabel('Ask your speaking coach').fill('What should I practice?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Start with one clear idea.')).toBeVisible();
  await page.getByRole('button', { name: 'New practice' }).click();
});
