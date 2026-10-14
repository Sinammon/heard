import { test, expect } from '@playwright/test';
import { mockAIPractice } from './fixtures.js';
import { finalScore } from '../shared/scoring.js';

test('fifteen-minute settings persist and partial reviews explain omitted posture', async ({
  page,
}) => {
  await mockAIPractice(page);
  // A synthetic report exercises presentation, not provider or tracking accuracy.
  const words = Array.from({ length: 140 }, (_, i) => ({
    text: 'word',
    startMs: (i * 60000) / 140,
    endMs: ((i + 1) * 60000) / 140,
  }));
  const score = finalScore({ words, durationMs: 60000 });
  const feedback = {
    summary: 'Synthetic browser review.',
    strengths: [],
    improvements: [],
    limitations: ['Test fixture only.'],
  };
  await page.route('**/api/sessions/*/analyze', (route) =>
    route.fulfill({ status: 202, json: { status: 'processing' } }),
  );
  await page.route('**/api/sessions/*/report', (route) =>
    route.fulfill({
      json: {
        status: 'complete',
        transcript: 'word '.repeat(140),
        score,
        evidence: [],
        stages: { audio: feedback, video: feedback, combined: feedback },
        visualMetrics: { coverage: 0, deviationPercent: null },
      },
    }),
  );
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/#studio');
  await page.getByRole('tab', { name: 'Draft with AI' }).click();
  await page.getByLabel('Talk length').selectOption('15');
  await page.getByRole('tab', { name: 'Write my own' }).click();
  await page
    .getByLabel('Your practice script')
    .fill('A useful speech about learning through daily practice.');
  await page.reload();
  await page.getByRole('tab', { name: 'Draft with AI' }).click();
  await expect(page.getByLabel('Talk length')).toHaveValue('15');
  await page.getByRole('button', { name: 'Set up my recording' }).click();
  await page.locator('#consent').check();
  await page.locator('#camera-enabled').check();
  await page.locator('#enable-camera').click();
  await expect(page.locator('#camera-status')).toContainText('loaded', { timeout: 20000 });
  await page.getByRole('button', { name: 'Start practice' }).click();
  await expect(page.locator('.timer')).toContainText('/ 15:00');
  await expect(page.locator('#pace-feedback')).toContainText('110–180 WPM');
  await expect(page.locator('#timer')).not.toHaveText('00:00');
  await page.getByRole('button', { name: 'Finish practice' }).click();
  await expect(page.locator('.metrics-grid')).toContainText('140');
  await page.getByRole('button', { name: '3. Summary', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Partial practice score' })).toBeVisible();
  await expect(page.locator('.final-score')).toContainText('Posture is excluded');
  await page.getByText('How scoring works', { exact: true }).click();
  await expect(page.locator('.rubric')).toContainText('posture excluded');
  await expect(page.locator('.rubric')).toContainText('150–500 ms');
  await page.getByRole('button', { name: 'New practice' }).click();
  await expect(page.getByLabel('Your practice script')).toHaveValue(/daily practice/);
  expect(errors).toEqual([]);
});
