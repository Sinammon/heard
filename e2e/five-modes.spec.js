import { test, expect } from '@playwright/test';
import { mockAIPractice } from './fixtures.js';
import { finalScore } from '../shared/scoring.js';
const feedback = {
  summary: 'Synthetic review: lead with your point, then give an example.',
  strengths: [
    {
      title: 'A concrete example',
      detail: 'The garden example supported your point.',
      evidenceIds: [],
    },
  ],
  improvements: [
    { title: 'Make the ending clear', detail: 'Finish with your main takeaway.', evidenceIds: [] },
  ],
  limitations: ['Browser fixture only.'],
};
async function mockReviews(page) {
  await mockAIPractice(page);
  let count = 0;
  await page.route('**/api/sessions', (route) =>
    route.fulfill({ json: { id: `take-${++count}` } }),
  );
  await page.route('**/api/sessions/*/analyze', (route) =>
    route.fulfill({ status: 202, json: { status: 'processing' } }),
  );
  const words = Array.from({ length: 140 }, (_, i) => ({
    text: 'word',
    startMs: i * 400,
    endMs: i * 400 + 300,
  }));
  await page.route('**/api/sessions/*/report', (route) =>
    route.fulfill({
      json: {
        status: 'complete',
        stages: { audio: feedback, combined: feedback },
        transcript: 'I helped neighbours grow a garden and share tools.',
        score: finalScore({ words, durationMs: 60000 }),
        evidence: [],
      },
    }),
  );
  await page.addInitScript(() => {
    const native = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.captureRequests = [];
    window.capturedStreams = [];
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      window.captureRequests.push(constraints);
      const stream = await native(constraints);
      window.capturedStreams.push(stream);
      return stream;
    };
  });
}
async function setupMode(page, mode) {
  await page.goto('/#studio');
  await page.getByRole('radio', { name: mode }).check();
  await page.getByRole('button', { name: 'Set up my recording' }).click();
  await expect(page.locator('#enable-camera')).toBeDisabled();
  await page.locator('#consent').check();
  await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  await expect(page.locator('#start-recording')).toBeEnabled();
  expect(await page.evaluate(() => window.captureRequests.at(-1).video)).toBe(false);
}
async function finishTake(page) {
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await expect(page.locator('#timer')).not.toHaveText('00:00');
  await page.getByRole('button', { name: 'Finish practice' }).click();
  await expect(page.locator('.feedback')).toContainText('Synthetic review');
  await expect(
    page.getByRole('button', { name: '1. Audio Analysis', exact: true }),
  ).toHaveAttribute('aria-current', 'step');
  await expect(
    page.getByRole('button', { name: '3. Combined Evaluation', exact: true }),
  ).toBeDisabled();
  await expect(page.locator('audio#review-player')).toBeVisible();
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await expect(page.getByRole('button', { name: /Watch/ })).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.capturedStreams.every((s) => s.getTracks().every((t) => t.readyState === 'ended')),
    ),
  ).toBe(true);
}
test('five modes are discoverable and fit narrow screens with optional camera', async ({
  page,
}) => {
  await mockReviews(page);
  await page.goto('/');
  await expect(page.locator('[data-open-mode]')).toHaveCount(5);
  await page.screenshot({ path: 'test-results/heard-home-desktop.png', fullPage: true });
  await page.locator('[data-open-mode="delivery"]').click();
  await expect(page.getByRole('radio', { name: 'Delivery Coach' })).toBeChecked();
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const mode of [
      'Free practice',
      'Memorization test',
      'Impromptu Speaking',
      'AI Interview',
      'Delivery Coach',
    ]) {
      await page.getByRole('radio', { name: mode }).check();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (width === 390 || width === 1280)
        await page.screenshot({
          path: `test-results/heard-${mode.replaceAll(' ', '-')}-${width}.png`,
          fullPage: true,
        });
    }
  }
});
test('impromptu topic failure retries, countdown records automatically, and same-topic retry works', async ({
  page,
}) => {
  await mockReviews(page);
  let failed = true;
  let requests = 0;
  await page.route('**/api/topics', (route) => {
    requests++;
    return failed
      ? route.fulfill({ status: 429, json: { error: 'Topic quota unavailable. Retry later.' } })
      : route.fulfill({ json: { topic: 'Should every neighbourhood have a shared garden?' } });
  });
  await setupMode(page, 'Impromptu Speaking');
  await page.locator('#start-recording').click();
  await expect(page.getByRole('alert')).toContainText('Topic quota');
  failed = false;
  const epoch = Date.now();
  await page.clock.install({ time: epoch });
  await page.locator('#start-recording').click();
  await expect(page.getByRole('timer')).toHaveText('00:30');
  await expect(page.locator('.active-prompt')).toContainText('shared garden');
  await page.clock.setSystemTime(epoch + 31000);
  await expect(page.locator('#stop-recording')).toBeVisible();
  await expect(page.locator('#recording-script')).toHaveCount(0);
  await expect(page.locator('.timer')).toContainText('/ 02:00');
  await finishTake(page);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('.active-prompt')).toContainText('shared garden');
  expect(requests).toBe(2);
});
test('delivery drills record without camera, repeat, and compare actual completed attempts', async ({
  page,
}) => {
  await mockReviews(page);
  await setupMode(page, 'Delivery Coach');
  await page.locator('#start-recording').click();
  await expect(page.locator('.active-prompt')).toContainText('Find your pace');
  await page.screenshot({ path: 'test-results/heard-delivery-active.png', fullPage: true });
  await finishTake(page);
  await page.getByRole('button', { name: 'Repeat this drill' }).click();
  await expect(page.locator('#consent')).toBeChecked();
  await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  await page.locator('#start-recording').click();
  await finishTake(page);
  await expect(page.getByRole('table')).toContainText('Previous');
  await expect(page.getByRole('table')).toContainText('Fillers / min');
  await page.screenshot({ path: 'test-results/heard-delivery-review.png', fullPage: true });
});
test('interview shows one question at a time, moves through three answers, and retries an individual answer', async ({
  page,
}) => {
  await mockReviews(page);
  let index = -1;
  const turns = [];
  const questions = [
    'Tell me about a project you organized.',
    'How did your garden team divide the work?',
    'What would you change in your next community project?',
  ];
  await page.route('**/api/sessions/*/interview', (route) => {
    const action = route.request().postDataJSON();
    if (index >= 0)
      turns[index] = {
        question: questions[index],
        transcript: 'The team shared tools in our garden.',
        review: feedback,
      };
    if (action.action === 'next') index++;
    if (action.action === 'retry') index = action.index;
    return route.fulfill({
      json: {
        index,
        question: questions[index],
        turns,
        total: 3,
        summary: action.action === 'finish' ? feedback : null,
      },
    });
  });
  await setupMode(page, 'AI Interview');
  await page.locator('#start-recording').click();
  for (let i = 0; i < 3; i++) {
    await expect(page.locator('.active-prompt')).toContainText(questions[i]);
    if (i > 0) await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
    await page.getByRole('button', { name: 'Record my answer' }).click();
    await finishTake(page);
    if (i < 2) await page.getByRole('button', { name: 'Next question' }).click();
  }
  await page.getByRole('button', { name: 'Review my interview' }).click();
  await expect(page.locator('.interview-conversation')).toContainText(
    'Take your next answer further',
  );
  await expect(page.locator('.interview-turns>li')).toHaveCount(3);
  await page.locator('[data-retry-answer="0"]').click();
  await expect(page.locator('.active-prompt')).toContainText(questions[0]);
  await expect(page.getByRole('button', { name: 'Record my answer' })).toBeDisabled();
});
