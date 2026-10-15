import { expect, test } from '@playwright/test';
import { mockAIPractice } from './fixtures.js';

for (const mode of ['seated', 'standing']) {
  test(`${mode} posture ignores nods, checks supported alignment, and clears tracking loss`, async ({
    page,
  }) => {
    await mockAIPractice(page);
    // Known landmark sequences verify controller/UI behavior, not MediaPipe model accuracy.
    await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      window.poseScenario = 'upright';
      window.Worker = function (url, options) {
        if (!String(url).includes('pose-worker')) return new NativeWorker(url, options);
        let stopped = false;
        const worker = {
          onmessage: null,
          terminate() {
            stopped = true;
          },
          postMessage(data) {
            if (data.type === 'init')
              return setTimeout(() => worker.onmessage?.({ data: { type: 'ready' } }), 10);
            if (data.type !== 'frame' || stopped) return;
            const aspect = data.bitmap.width / data.bitmap.height;
            const landmarks = Array(33).fill(null),
              worldLandmarks = Array(33).fill(null);
            const p = (x, y) => ({ x, y: y * aspect, visibility: 0.99, presence: 0.99 });
            landmarks[0] = p(0.5, window.poseScenario === 'nod' ? 0.17 : 0.1);
            landmarks[11] = p(0.35, 0.22);
            landmarks[12] = p(0.65, window.poseScenario === 'tilt' ? 0.32 : 0.22);

            landmarks[23] = p(0.4, 0.42);
            landmarks[24] = p(0.6, 0.42);
            if (window.poseScenario === 'missing-hips') {
              landmarks[23] = null;
              landmarks[24] = null;
            }
            const z = window.poseScenario === 'lean' ? -0.3 : 0;
            worldLandmarks[11] = { x: -0.2, y: -0.5, z };
            worldLandmarks[12] = { x: 0.2, y: -0.5, z };
            worldLandmarks[23] = { x: -0.15, y: 0, z: 0 };
            worldLandmarks[24] = { x: 0.15, y: 0, z: 0 };
            data.bitmap.close();
            setTimeout(() => {
              if (!stopped)
                worker.onmessage?.({
                  data: {
                    type: 'pose',
                    landmarks: window.poseScenario === 'lost' ? null : landmarks,
                    worldLandmarks,
                    aspectRatio: aspect,
                    time: data.time,
                  },
                });
            }, 10);
          },
        };
        return worker;
      };
    });
    await page.goto('/#studio');
    await page
      .getByLabel('Your practice script')
      .fill('A simple posture verification speech for this browser test.');
    await page.getByRole('button', { name: 'Set up my recording' }).click();
    await page.locator('#consent').check();
    await page.locator('#camera-enabled').check();
    await page.locator(`input[name=mode][value=${mode}]`).check();
    await page.locator('#enable-camera').click();
    await expect(page.locator('#camera-status')).toContainText('loaded', { timeout: 20000 });
    await page.getByRole('button', { name: 'Calibrate posture', exact: true }).click();
    await expect(page.locator('#calibration-status')).toContainText('Baseline ready', {
      timeout: 10000,
    });
    await page.getByRole('button', { name: 'Start practice' }).click();
    await expect(page.locator('#posture-value')).toHaveText(
      mode === 'seated' ? 'Upper body only' : 'Aligned',
    );
    await page.evaluate(() => {
      window.poseScenario = 'nod';
    });
    await expect(page.locator('#tracking')).toContainText(
      mode === 'seated' ? 'Upper-body alignment steady' : 'Aligned',
      { timeout: 4000 },
    );
    await page.evaluate(() => {
      window.poseScenario = 'lean';
    });
    if (mode === 'seated') {
      // Wait long enough for a false hip-derived lean warning to have fired.
      await page.waitForTimeout(3000);
      await expect(page.locator('#posture-value')).toHaveText('Upper body only');
      await page.evaluate(() => {
        window.poseScenario = 'missing-hips';
      });
      await page.waitForTimeout(1000);
      await expect(page.locator('#posture-value')).toHaveText('Upper body only');
      await page.evaluate(() => {
        window.poseScenario = 'tilt';
      });
    }
    await expect(page.locator('#posture-value')).toHaveText('Check alignment', { timeout: 8000 });
    await expect(page.locator('#tracking')).toContainText(
      mode === 'seated' ? 'Shoulders tilted' : 'Leaning forward',
    );
    await page.evaluate(() => {
      window.poseScenario = 'upright';
    });
    await expect(page.locator('#posture-value')).toHaveText(
      mode === 'seated' ? 'Upper body only' : 'Aligned',
      { timeout: 6000 },
    );
    await page.evaluate(() => {
      window.poseScenario = 'lost';
    });
    await expect(page.locator('#posture-value')).toHaveText('Unavailable');
    await expect(page.locator('#tracking')).toContainText('Tracking lost');
    await page.evaluate(() => {
      window.poseScenario = 'upright';
    });
    await expect(page.locator('#posture-value')).toHaveText(
      mode === 'seated' ? 'Upper body only' : 'Aligned',
    );
  });
}
