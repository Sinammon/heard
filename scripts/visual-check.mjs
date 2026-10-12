import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { mockAIPractice } from '../e2e/fixtures.js';

// Internal visual evidence uses clearly labeled provider fixtures, never a live AI call.
await mkdir('.impeccable/review', { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  args: ['--disable-gpu', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const errors = [];
let expectingQuotaError = false;
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  permissions: ['camera', 'microphone'],
  reducedMotion: 'reduce',
});
await page.routeWebSocket('**/*', (ws) => {
  if (ws.url().includes('/transcription')) ws.send(JSON.stringify({ type: 'ready' }));
  else ws.close();
});
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (
    message.type() === 'error' &&
    !message.text().startsWith('INFO: Created TensorFlow Lite XNNPACK delegate') &&
    !(expectingQuotaError && message.text().includes('429'))
  )
    errors.push(message.text());
});
const capture = async (name, mobile = false) => {
  await page.setViewportSize({ width: mobile ? 390 : 1440, height: mobile ? 844 : 1000 });
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    const id = location.hash.slice(1) || 'home';
    document.getElementById(id)?.scrollIntoView({ behavior: 'instant', block: 'start' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
    throw new Error(`Overflow in ${name}`);
  await page.screenshot({ path: `.impeccable/review/${name}.png`, fullPage: false });
};
try {
  await page.goto('http://127.0.0.1:3000');
  await capture('desktop');
  await capture('mobile', true);
  await page.goto('http://127.0.0.1:3000/#about');
  await capture('about-desktop');
  await capture('about-mobile', true);
  await mockAIPractice(page);
  await page.goto('http://127.0.0.1:3000/#studio');
  await page.reload();
  await page
    .getByLabel('Your practice script')
    .fill(
      'Today I want to share something I learned outside the classroom. I used to think a new skill needed a big plan. Then I tried just ten minutes a day.\n\nThe small habit made it easier to start. And starting made it easier to keep going.\n\nMy suggestion is simple: choose one thing you want to learn, and give it a little space in your day.',
    );
  await capture('studio-desktop');
  await capture('studio-mobile', true);
  await page.getByRole('button', { name: 'Set up my recording' }).click();
  await capture('setup-desktop');
  await capture('setup-mobile', true);
  await page.locator('#consent').check();
  await page.getByRole('button', { name: 'I’ve read my script once' }).click();
  await page.locator('.flashcard').first().waitFor();
  await page
    .locator('.flashcards-section')
    .screenshot({ path: '.impeccable/review/flashcards.png' });
  await page.getByRole('button', { name: 'Enable camera & microphone' }).click();
  await page.getByRole('button', { name: 'Start practice' }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.getElementById('start-recording').disabled);
  let complete = false;
  const stage = {
    summary:
      'Your opening introduces a clear idea, and your closing gives the listener something to try.',
    strengths: [
      {
        title: 'An idea that is easy to follow',
        detail: 'A concrete example makes your point feel familiar.',
        evidenceIds: [],
      },
    ],
    improvements: [
      {
        title: 'Give the transition room',
        detail: 'Take a deliberate breath before moving from your story to your suggestion.',
        evidenceIds: ['pause-1'],
      },
    ],
    limitations: [
      'Synthetic fixture for interface verification. This is not a real Gemini review.',
    ],
  };
  await page.route('**/api/sessions/*/analyze', (route) =>
    route.fulfill({ status: 202, json: { jobId: 'visual-fixture', status: 'processing' } }),
  );
  await page.route('**/api/sessions/*/report', (route) =>
    route.fulfill({
      json: complete
        ? {
            status: 'complete',
            stages: {
              audio: stage,
              video: stage,
              combined: stage,
              memory: {
                ...stage,
                summary:
                  'You kept the main habit idea. Include the concrete learning example in your next test.',
              },
            },
            transcript: 'A small habit made it easier to start.',
            evidence: [{ id: 'pause-1', category: 'pause', startMs: 400, endMs: 700 }],
            score: {
              score: null,
              reasons: ['This short synthetic fixture has insufficient delivery duration.'],
              penalties: { filler: 0, pace: 0, pause: 0, posture: 0 },
              coverage: { posture: 0 },
              metrics: { wpm: 132, fillers: 1, pauses: 1, postureDeviationPercent: 0 },
            },
          }
        : {
            status: 'processing',
            stages: {},
            stageStatus: {
              transcript: 'running',
              audio: 'waiting',
              video: 'waiting',
              combined: 'waiting',
            },
          },
    }),
  );
  await page.getByRole('button', { name: 'Start practice' }).click();
  await page.waitForFunction(() => {
    const timer = document.getElementById('timer');
    return timer && timer.textContent !== '00:00';
  });
  await capture('recording-desktop');
  await capture('recording-mobile', true);
  await page.getByRole('button', { name: 'Finish practice' }).click();
  await page.getByRole('button', { name: 'Listen while you wait' }).waitFor();
  await capture('processing-desktop');
  await capture('processing-mobile', true);
  complete = true;
  await page.getByRole('button', { name: 'Listen while you wait' }).click();
  await page.getByText('Give the transition room').waitFor();
  await capture('review-desktop');
  await capture('review-mobile', true);
  await page.getByRole('button', { name: 'Watch my delivery' }).click();
  await page.waitForFunction(() => document.getElementById('review-player').readyState >= 2);
  await capture('video-desktop');
  await capture('video-mobile', true);
  await page.getByRole('button', { name: 'Bring it together', exact: true }).click();
  await capture('combined-desktop');
  await capture('combined-mobile', true);
  await page.getByRole('button', { name: 'New practice' }).click();
  await page.getByRole('radio', { name: 'Memorization test' }).check();
  await capture('memorization-prepare-desktop');
  await capture('memorization-prepare-mobile', true);
  await page.getByRole('button', { name: 'Set up my recording' }).click();
  await page.locator('#consent').check();
  await page.getByRole('button', { name: 'Enable camera & microphone' }).click();
  await page.getByRole('button', { name: 'Start memorizing' }).click();
  await page.getByRole('timer').waitFor();
  await capture('memorization-study-desktop');
  await capture('memorization-study-mobile', true);
  await page.getByRole('button', { name: 'I’m ready · begin test' }).click();
  await page.getByRole('button', { name: 'Finish practice' }).waitFor();
  await capture('memorization-test-desktop');
  await capture('memorization-test-mobile', true);
  await page.getByRole('button', { name: 'Finish practice' }).click();
  await page.getByRole('heading', { name: 'What stayed with you?' }).waitFor();
  await capture('memorization-review-desktop');
  await capture('memorization-review-mobile', true);
  await page.getByRole('button', { name: 'New practice' }).click();
  await page.route('**/api/scripts', (route) =>
    route.fulfill({
      status: 429,
      json: { error: 'The AI quota is currently exhausted. Your draft is safe; retry later.' },
    }),
  );
  await page.getByRole('tab', { name: 'Draft with Gemini' }).click();
  await page
    .getByLabel('What would you like to talk about?')
    .fill('Something I learned outside the classroom');
  expectingQuotaError = true;
  await page.getByRole('button', { name: 'Generate a draft' }).click();
  await page.getByRole('alert').waitFor();
  await capture('error-desktop');
  await capture('error-mobile', true);
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.screenshot({ path: '.impeccable/review/tablet.png', fullPage: false });
  await writeFile('.impeccable/review/console.json', JSON.stringify(errors, null, 2));
  console.log(`Visual evidence captured; browser errors: ${errors.length}`);
  if (errors.length) {
    console.log(errors);
    process.exitCode = 1;
  }
} catch (error) {
  console.error((await page.locator('main').innerText()).slice(0, 6000));
  throw error;
} finally {
  await browser.close();
}
