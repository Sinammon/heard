import { expect, test } from '@playwright/test';
import { mockAIPractice, talkingPoints } from './fixtures.js';

const script =
  'Our community garden gives neighbours a place to grow food together. Shared tools make it affordable. Weekly visits help people learn from each other. Start with one planter this spring.';
const review = {
  summary:
    'You recalled the garden idea and shared tools. The weekly learning example was missing.',
  strengths: [
    {
      title: 'Main idea remembered',
      detail: 'You described neighbours growing food together.',
      evidenceIds: [],
    },
  ],
  improvements: [
    {
      title: 'Bring back the learning example',
      detail: 'Mention what neighbours learn during weekly visits.',
      evidenceIds: [],
    },
  ],
  limitations: ['Synthetic test fixture; transcription may omit speech.'],
};
async function prepare(page) {
  await mockAIPractice(page);
  await page.goto('/#studio');
  await page.getByRole('radio', { name: 'Memorization test' }).check();
  await page.getByLabel('Time to memorize · minutes').fill('1');
  await page.getByLabel('Time to memorize · minutes').blur();
  await page.getByLabel('Your practice script').fill(script);
  await page.getByRole('button', { name: 'Set up my recording' }).click();
  await page.locator('#consent').check();
  await page.locator('#camera-enabled').check();
  await page.locator('#enable-camera').click();
  await expect(page.getByRole('button', { name: 'Start memorizing' })).toBeEnabled();
}

test('countdown starts the speaking test automatically with only key points and recall feedback', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await prepare(page);
  const epoch = Date.now();
  await page.clock.install({ time: epoch });
  let sessionRequest;
  await page.route('**/api/sessions', (route) => {
    sessionRequest = route.request().postDataJSON();
    return route.fulfill({ json: { id: 'browser-fixture' } });
  });
  await page.route('**/api/sessions/*/analyze', (route) =>
    route.fulfill({ status: 202, json: { status: 'processing' } }),
  );
  await page.route('**/api/sessions/*/report', (route) =>
    route.fulfill({
      json: {
        status: 'complete',
        stages: { audio: review, video: review, combined: review, memory: review },
        evidence: [],
        transcript: 'Neighbours grow food together using shared tools.',
        score: null,
      },
    }),
  );
  await page.getByRole('button', { name: 'Start memorizing' }).click();
  await expect(page.getByRole('timer')).toHaveText('01:00');
  await expect(page.locator('.study-script')).toContainText(script);
  await expect(page.getByRole('button', { name: 'Finish practice' })).toHaveCount(0);
  await page.clock.setSystemTime(epoch + 61000);
  await expect(page.getByRole('button', { name: 'Finish practice' })).toBeVisible();
  await expect(page.locator('.cue-card')).toContainText('Key point 1 / 3');
  await page.getByRole('button', { name: 'Next point' }).click();
  await expect(page.locator('.cue-card')).toContainText('Key point 2 / 3');
  await expect(page.locator('#recording-script')).toHaveCount(0);
  await expect(page.locator('#transcript')).toHaveCount(0);
  await expect(page.locator('#workspace')).not.toContainText(script);
  expect(sessionRequest.practice).toEqual({ mode: 'memorization', script, minutes: 1 });
  await expect(page.locator('#timer')).not.toHaveText('00:00');
  await page.getByRole('button', { name: 'Finish practice' }).click();
  await expect(page.getByRole('heading', { name: 'What stayed with you?' })).toBeVisible();
  await expect(page.locator('.memory-review')).toContainText('weekly learning example was missing');
  await page.getByRole('button', { name: '1. Audio Analysis', exact: true }).click();
  await expect(page.locator('audio')).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Home', exact: true })
    .click();
  await expect(page.locator('#studio')).toBeHidden();
  await page.getByRole('link', { name: 'Start practicing', exact: false }).first().click();
  await expect(page.locator('.memory-review')).toBeVisible();
  await page.getByRole('button', { name: 'New practice' }).click();
  await expect(page.getByLabel('Your practice script')).toHaveValue(script);
  await expect(page.getByRole('radio', { name: 'Memorization test' })).toBeChecked();
  expect(errors).toEqual([]);
});

test('key-point failures block the countdown and retry recovers; study can cancel or start early', async ({
  page,
}) => {
  await prepare(page);
  let failed = true;
  await page.route('**/api/flashcards', (route) =>
    failed
      ? route.fulfill({ status: 429, json: { error: 'Quota unavailable. Retry later.' } })
      : route.fulfill({ json: { points: talkingPoints } }),
  );
  await page.getByRole('button', { name: 'Start memorizing' }).click();
  await expect(page.getByText('Quota unavailable. Retry later.')).toBeVisible();
  await expect(page.getByRole('timer')).toHaveCount(0);
  failed = false;
  await page.getByRole('button', { name: 'Start memorizing' }).click();
  await expect(page.getByRole('timer')).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Home', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('Cancel memorization');
  await expect(page.locator('#home-page')).toBeHidden();
  await page.getByRole('button', { name: 'Cancel memorization' }).click();
  await expect(page.getByRole('timer')).toHaveCount(0);
  await page.getByRole('button', { name: 'Start memorizing' }).click();
  await page.getByRole('button', { name: 'I’m ready · begin test' }).click();
  await expect(page.getByRole('button', { name: 'Finish practice' })).toBeVisible();
  await expect(page.locator('#workspace')).not.toContainText(script);
});

test('Home and Studio are separate pages and mode preferences survive refresh', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#studio')).toBeHidden();
  await expect(page.getByLabel('Your practice script')).toHaveCount(0);
  await page.getByRole('button', { name: 'Start practicing' }).click();
  await expect(page.locator('#home-page')).toBeHidden();
  await page.getByRole('radio', { name: 'Memorization test' }).check();
  await page.getByLabel('Time to memorize · minutes').fill('3');
  await page.getByLabel('Time to memorize · minutes').blur();
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Memorization test' })).toBeChecked();
  await expect(page.getByLabel('Time to memorize · minutes')).toHaveValue('3');
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test('a device disconnect cancels study and offers recovery before recording', async ({ page }) => {
  await prepare(page);
  await page.locator('#preview').evaluate((video) => {
    window.studyStream = video.srcObject;
  });
  await page.getByRole('button', { name: 'Start memorizing' }).click();
  await expect(page.getByRole('timer')).toBeVisible();
  await page.evaluate(() =>
    window.studyStream.getVideoTracks()[0].dispatchEvent(new Event('ended')),
  );
  await expect(page.getByRole('timer')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('device disconnected');
  await expect(page.getByRole('button', { name: 'Start memorizing' })).toBeDisabled();
  await expect(page.locator('#enable-camera')).toBeEnabled();
});
