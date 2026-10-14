import { test, expect } from '@playwright/test';
import { mockAIPractice } from './fixtures.js';
import { finalScore } from '../shared/scoring.js';

const review = (summary) => ({
  summary,
  strengths: [],
  improvements: [],
  limitations: ['Synthetic browser fixture only.'],
});
function report(camera = true) {
  const words = Array.from({ length: 140 }, (_, i) => ({
    text: [15, 50, 95].includes(i) ? 'um' : 'word',
    startMs: (i * 60000) / 140,
    endMs: ((i + 1) * 60000) / 140,
  }));
  const score = finalScore({
    words,
    transcript: words.map((w) => w.text).join(' '),
    durationMs: 60000,
    poseSamples: camera
      ? Array.from({ length: 600 }, (_, i) => ({
          timeMs: i * 100,
          valid: true,
          deviation: i < 36,
          movement: false,
        }))
      : [],
    acoustics: { clippedFraction: 0 },
  });
  return {
    status: 'complete',
    stages: {
      audio: review('Audio fixture: repeated hesitation cues.'),
      ...(camera ? { video: review('Posture fixture: a sustained alignment shift.') } : {}),
      combined: review('Combined fixture: practice the measured priorities.'),
    },
    score,
    transcript: words.map((w) => w.text).join(' '),
    evidence: score.events,
    visualMetrics: {
      coverage: camera ? 1 : 0,
      deviationPercent: camera ? 6 : null,
      movementPercent: camera ? 0 : null,
    },
  };
}

async function startTake(page, camera) {
  await page
    .getByLabel('Your practice script')
    .fill('A short fixture script about learning to speak clearly.');
  await page.getByRole('button', { name: 'Set up my recording' }).click();
  await page.locator('#consent').check();
  if (camera) await page.locator('#camera-enabled').check();
  await page.locator('#enable-camera').click();
  await expect(page.locator('#start-recording')).toBeEnabled({ timeout: 20000 });
  await page.locator('#start-recording').click();
  await expect(page.locator('#timer')).not.toHaveText('00:00');
  await page.locator('#stop-recording').click();
}

async function setup(page, value) {
  await mockAIPractice(page);
  await page.route('**/api/sessions/*/analyze', (route) =>
    route.fulfill({ status: 202, json: { status: 'processing' } }),
  );
  await page.route('**/api/sessions/*/report', (route) => route.fulfill({ json: value }));
  await page.goto('/#studio');
}

test('every review starts with Audio and combines real component scores after Posture', async ({
  page,
}) => {
  const value = report();
  await setup(page, value);
  await startTake(page, true);
  const steps = page.getByRole('navigation', { name: 'Review stages' });
  await expect(steps.locator('[aria-current="step"]')).toHaveText('1. Audio Analysis');
  await expect(steps.getByRole('button', { name: '3. Combined Evaluation' })).toBeDisabled();
  await expect(page.locator('.final-score strong')).toHaveText(
    String(value.score.components.audio.score),
  );
  await expect(page.locator('.measured-priorities')).toContainText('Filler words');
  await expect(page.locator('.feedback')).toContainText('Audio fixture');
  await page.locator('#review-player').evaluate((player) => {
    player.currentTime = 0.2;
  });
  await page.getByRole('button', { name: 'Watch my delivery', exact: true }).click();
  await expect(steps.locator('[aria-current="step"]')).toHaveText('2. Posture Analysis');
  await expect(page.locator('.final-score strong')).toHaveText(
    String(value.score.components.posture.score),
  );
  expect(await page.locator('#review-player').evaluate((player) => player.muted)).toBe(true);
  await expect(page.locator('.feedback')).toContainText('Posture fixture');
  await page.getByRole('button', { name: 'Back to audio analysis', exact: true }).click();
  await expect(page.locator('.feedback')).toContainText('Audio fixture');
  await expect
    .poll(() => page.locator('#review-player').evaluate((player) => player.currentTime))
    .toBeGreaterThan(0.1);
  await page.getByRole('button', { name: 'Watch my delivery', exact: true }).click();
  await page.getByRole('button', { name: 'Bring it together', exact: true }).click();
  await expect(steps.locator('[aria-current="step"]')).toHaveText('3. Combined Evaluation');
  await expect(page.locator('.final-score strong')).toHaveText(String(value.score.score));
  await expect(page.locator('.final-score')).toContainText('70%');
  await expect(page.locator('.final-score')).toContainText('30%');
  await page.getByRole('button', { name: 'Back to posture analysis', exact: true }).click();
  await expect(page.locator('.feedback')).toContainText('Posture fixture');
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('camera-off takes still visit Posture and reset progress for the next take', async ({
  page,
}) => {
  await setup(page, report(false));
  await startTake(page, false);
  await expect(page.getByRole('button', { name: '3. Combined Evaluation' })).toBeDisabled();
  await page.getByRole('button', { name: 'Continue to posture analysis' }).click();
  await expect(page.getByRole('heading', { name: 'Posture analysis unavailable' })).toBeVisible();
  await expect(page.locator('#review-player')).toHaveCount(0);
  await expect(page.locator('.final-score strong')).toHaveText('—');
  await page.getByRole('button', { name: 'Bring it together' }).click();
  await expect(page.getByRole('heading', { name: 'Partial practice score' })).toBeVisible();
  await expect(page.locator('.final-score')).toContainText('Posture is excluded');
  await page.getByRole('button', { name: 'New practice' }).click();
  await startTake(page, false);
  await expect(page.locator('.stage-nav [aria-current="step"]')).toHaveText('1. Audio Analysis');
  await expect(page.getByRole('button', { name: '3. Combined Evaluation' })).toBeDisabled();
});

test('retrying analysis preserves the selected stage and completed earlier feedback', async ({
  page,
}) => {
  const value = report();
  await setup(page, value);
  let calls = 0;
  await page.route('**/api/sessions/*/report', (route) => {
    calls++;
    return route.fulfill({
      json:
        calls === 1
          ? {
              ...value,
              status: 'partial',
              stages: { audio: value.stages.audio },
              error: 'Visual fixture failed. Retry analysis.',
            }
          : value,
    });
  });
  await startTake(page, true);
  await page.getByRole('button', { name: 'Watch my delivery' }).click();
  await page.getByRole('button', { name: 'Retry AI analysis' }).click();
  await expect(page.locator('.feedback')).toContainText('Posture fixture');
  await expect(page.locator('.stage-nav [aria-current="step"]')).toHaveText('2. Posture Analysis');
  await page.getByRole('button', { name: 'Back to audio analysis' }).click();
  await expect(page.locator('.feedback')).toContainText('Audio fixture');
});

test('finishing background processing does not jump away from the selected stage', async ({
  page,
}) => {
  const value = report();
  await setup(page, value);
  let complete = false;
  await page.route('**/api/sessions/*/report', (route) =>
    route.fulfill({
      json: complete
        ? value
        : {
            status: 'processing',
            stages: { audio: value.stages.audio },
            stageStatus: { audio: 'complete', video: 'running', combined: 'waiting' },
          },
    }),
  );
  await startTake(page, true);
  await page.getByRole('button', { name: 'Listen while you wait' }).click();
  await page.getByRole('button', { name: 'Watch my delivery' }).click();
  complete = true;
  await expect(page.locator('.feedback')).toContainText('Posture fixture', { timeout: 10000 });
  await expect(page.locator('.stage-nav [aria-current="step"]')).toHaveText('2. Posture Analysis');
});
