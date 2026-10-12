# Heard

A speaking practice studio for students and everyday conversations, built with HTML, CSS, JavaScript, MediaPipe, Fastify, and Gemini. Practice a class presentation, introduction, or idea. Full video remains on the device. Choose free practice or a timed memorization test. Every recorded practice requires explicit AI consent. Gemini receives the script for talking-point flashcards, plus audio and selected still frames for the three review stages.

## Run locally

Requires Node.js 22.12+ (Node 24 LTS recommended) and pnpm.

```powershell
pnpm install
pnpm models:download
Copy-Item .env.example .env
# Edit .env and set GEMINI_API_KEY from Google AI Studio.
pnpm dev
```

Open http://localhost:5173. Camera permissions work on localhost; any remote deployment requires HTTPS. You can write a script without a key. Enabling camera/microphone and recording require AI consent and a configured Gemini service. Every take automatically requests AI analysis; unavailable AI or exhausted quota produces a visible failure, while any completed local playback remains usable. Missing AI never produces fake feedback or a verified score.

Create the free API key at https://aistudio.google.com/apikey. Keep it in `.env` on the server, never in frontend code. Do not send your key in chat or commit `.env`.

Production build:

```powershell
pnpm build
pnpm start
```

Open http://localhost:3000. The build downloads the matching MediaPipe model if absent and bundles self-hosted fonts. The server serves the compiled frontend. Recording supports desktop Chrome and Edge, English, one speaker, five-minute recordings, and seated or standing calibration. The interface adapts to mobile and tablet; real-device mobile/Safari recording is not yet validated. Node service restarts lose temporary reports; the page's existing local playback remains usable.

## Gemini configuration

`@google/genai` provides the Interactions API, Files API, and Live API. Defaults, configurable through `.env`:

- `GEMINI_MODEL=gemini-3.5-flash-lite`: script generation, audio/image reviews, combined review, and streamed text chat.
- `GEMINI_TRANSCRIBE_MODEL=gemini-3.5-transcribe`: verbatim final transcription with `word_info` timestamps.
- `GEMINI_LIVE_MODEL=gemini-3.5-transcribe-live`: 16-bit, mono, 16 kHz PCM, verbatim text streaming.

Availability and free quotas depend on your Google project. These are the model names documented at implementation time; a 404 explains how to configure another available model. The final transcription adapter specifically requires a dedicated transcription model returning word annotations; do not substitute a general model's estimated timestamps.

Read your active request, token, and daily quotas in Google AI Studio, then set `GEMINI_RPM`, `GEMINI_TPM`, and `GEMINI_RPD`. The sample values are conservative application limits, not a claim about Google's quotas. Quotas are shared by the project and this application cannot see usage from other applications. Non-live requests are serialized. Live connections reserve a five-minute token budget. 429s never trigger a paid fallback; transient server errors receive one retry. Chat history is bounded.

## Privacy and lifecycle

Script preparation stays local unless you request an AI draft. Recording requires a configured server key and explicit cloud-processing consent during setup; there is no local-only recording mode. Consent is unchecked by default and is required before enabling devices or starting a practice. Every completed take automatically submits audio and selected frames for AI review. Google's unpaid-service terms permit product improvement and human review and instruct users not to submit sensitive, confidential, or personal information; regional exceptions apply. Evaluate https://ai.google.dev/gemini-api/terms before accepting identifiable recordings from real users. Application cleanup does not promise confidential or zero-retention processing by Google.

- Combined video is never accepted by the backend. It stays in a browser Blob until reset or page close.
- Talking-point flashcards share the script with Gemini after you confirm a first read-through or finish the first recorded take. Gemini summarizes the essential ideas into 3 cards for simple scripts and up to 8 for longer or more complex ones. Cards stay in memory for another take; editing the script invalidates them. Loading, retry, cancellation, and unavailable states are explicit. Flashcard failure does not block recording or replace AI analysis.
- Script drafts and topic preferences survive reload in this tab's sessionStorage. Recordings are not persisted. New practice clears the recording and session while keeping the script for another take.
- Audio and at most 20 resized JPEG frames are submitted for analysis.
- Uploaded Gemini audio is explicitly deleted in `finally`; failed deletion is disclosed. Gemini Files also have an automatic expiry.
- Non-live Interactions use `store:false`. Chat uses application-held report/history, not provider-side conversation IDs.
- The backend does not log recordings, transcripts, API keys, or request bodies.
- Sessions use HttpOnly, SameSite=Strict guest cookies and expire after 60 minutes of inactivity or two hours total. Reset/delete aborts queued work and closes active live connections.
- In-memory session and quota limits apply to one server instance. This is not a production multi-instance service.

## Measurement and scoring

The live score stays unavailable until finalized speech includes at least 50 words across 30 seconds, live transcription is connected, and usable posture covers at least 80% of that interval. Once supported, its deterministic running deductions are explicitly provisional. Posture/audio capture operate independently; lost tracking or live transcription does not stop recording. Only finalized utterances create filler deductions. Live word timing and pace are approximate; final word annotations replace them. Only standalone `um` and `uh` are scored as fillers.

The final rubric is deterministic and versioned as `v1` in `shared/scoring.js`:

`round(100 - 25F - 25R - 20P - 30B)`

Factors are clamped to 0–1. F is `(fillers/minute - 1)/5`; R is the fraction of complete 20-second windows outside 110–180 WPM; P is silence exceeding three seconds divided by 15% of first-to-last-word delivery time; B is posture deviation time divided by 30% of valid tracked time. Leading/trailing silence is excluded. Missing timing, fewer than 50 words, less than 30 seconds of delivery, or less than 80% pose coverage produces no overall score.

Pose tracking uses the Lite model in a CPU Web Worker, one inference in flight, 320-pixel-wide input, and adaptive 5–10 Hz sampling. Five-second calibration requires at least 20 usable observations and rejects unstable head/shoulder/torso geometry. Image coordinates are corrected for the camera aspect ratio; visible shoulders and hips supply torso lean and compression, and 3D world landmarks supply estimated forward lean. A head nod alone is not treated as back posture. Low-confidence, off-screen, and degenerate landmarks are excluded. Seated views without hips use a conservative upper-body approximation, explicitly labeled in the UI; they cannot establish back curvature or forward torso lean reliably.

Measurements are smoothed over time. A deviation must persist for two seconds before becoming a warning, with a lower recovery threshold and one second of recovery to prevent flicker. Tracking gaps reset the detector and episode continuity. The mirrored preview and overlay preserve the complete camera frame and share letterboxing. Keep the camera fixed and include the hips for torso tracking. Webcam geometry is approximate and cannot establish spinal health or internal confidence. Thresholds still require validation with real users; synthetic tests verify geometry and state behavior, not real-device accuracy. Coordinate conventions follow the [MediaPipe Pose Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker).

Pitchy estimates pitch periodicity, not intelligibility. Audio level and pitch-variation measurements are descriptive and are not directly scored. Silence detection during recording is an RMS heuristic; final pauses use canonical word gaps. Rhetorical pauses and natural movement may be appropriate despite rubric deductions.

## Architecture

The app is branded as **Heard**, with a warm neutral canvas, charcoal controls, an orange speech-and-waveform logo on the left of the hero, and self-hosted Geist and Instrument Serif fonts. Home (`#home`), Our approach (`#about`), and Studio (`#studio`) are separate hash-routed pages. Home has a compact topic launcher, optional review explorer, and essential FAQ. Studio keeps public content hidden for a focused **Prepare → Practice → Review** workflow. Drafts, mode preferences, and completed reviews survive page navigation; navigating home from setup releases devices. Active study, recording, and busy actions guard against accidental navigation. Sticky navigation, readable typography, keyboard focus, and reduced-motion support remain available.

Studio has two modes defined in `shared/practice.js`: **Free practice** retains script/flashcard-assisted rehearsal; **Memorization test** accepts a manual or AI-generated script and 1–30 study minutes. Consent and ready devices are required. Valid AI key points are prepared before the clock starts; failure offers retry and never starts a test without notes. The countdown uses a deadline to avoid timer drift, can be canceled or ended early, and automatically starts recording at expiry. The full script and live transcript are absent from the speaking-test UI; only 3–8 synthesized key points remain. Device/session failures stay visible and recoverable.

The memorization session retains the consented reference script temporarily for a separate, transcript-only AI recall review. This compares meaning, retained ideas, and omissions rather than requiring word-for-word recitation. Recall feedback is qualitative, may be limited by transcription quality, and does not determine the delivery score. Audio-only and visual-only delivery reviews remain isolated. Combined coaching uses derived reports, including available recall feedback. Missing transcription produces unavailable recall feedback, never a fabricated memory assessment. Listen, Watch, and Reflect remain separate playback modes.

`src/pages.js` contains routed public pages and the dedicated Studio mount; `src/studio-views.js` contains preparation and setup; `src/style.css` defines shared tokens and responsive components. `src/brand.js` defines the scalable mark and wordmark; `public/heard-mark.svg` and `public/favicon.svg` provide standalone assets. `src/draft.js` retains the legacy storage key so existing drafts survive the rebrand, `src/text.js` handles text utilities, and `src/icons.js` imports only the Phosphor assets used. Fonts and icons are served locally, with no external font or image requests. Keyboard focus, loading, errors, AI-unavailable states, reduced motion, and reduced transparency are supported. Product decisions live in `PRODUCT.md` and the design system in `DESIGN.md`.

- `src/`: workflow UI, capture controller, posture worker, acoustic worker, safe API/chat rendering.
- `shared/`: scoring and calibration/episode logic shared with the backend.
- `server/`: ownership, validation, bounded Gemini jobs, stage isolation, media cleanup, live relay, chat.
- `public/`: matching MediaPipe WASM/model, audio worklet, and favicon.

Routes: `POST /api/scripts`, `POST /api/flashcards`, `POST /api/sessions`, `WS /api/sessions/:id/transcription`, `POST /api/sessions/:id/analyze`, `GET /api/sessions/:id/report`, `POST /api/sessions/:id/chat`, `DELETE /api/sessions/:id`.

Analysis accepts multipart fields `payload` (validated JSON) and `audio` (mono 16 kHz PCM WAV). The payload contains recording duration, posture mode, valid/deviation pose samples, posture episodes, timestamped frames, and acoustic summaries. Session creation accepts an optional validated `practice` object: `{mode:"free"}` (default) or `{mode:"memorization",script,minutes}`. The reference script is consented session data, never a visual-review input, and is cleared with the session. Duplicate processing/completed submissions return the existing job. Partial jobs retain completed stages and can retry failed stages with the local audio. Chat is NDJSON with `{text}`, `{done:true}`, or `{error}` records.

Reports contain summary, strengths, improvements, limitations, and allowlisted evidence IDs. Memorization tests add `stages.memory` and its stage status; completed stages survive retry. Audio review receives no visual data; video review receives no speech data; combined review receives derived reports and evidence. Gemini never determines the score. Dynamic text is escaped or assigned with `textContent`.

## Checks

```powershell
pnpm test
pnpm build
pnpm test:e2e
# With pnpm start running on port 3000:
pnpm test:visual
```

Browser tests use an installed Chromium binary when available (set `PLAYWRIGHT_EXECUTABLE_PATH` to override it) with fake camera/microphone devices. They test browser MediaRecorder/AudioWorklet capture, playback after AI failure, mandatory consent, adaptive flashcards, countdown expiry/early start/cancellation, hidden-script tests, recall feedback, posture transitions with known landmarks, muted video, reset, draft preservation, quota errors, keyboard access, and narrow layouts. Backend/provider tests validate malformed responses, timestamps, streaming completion, cancellation, and production origin controls with explicit doubles. Visual review fixtures are synthetic and do not prove live Gemini behavior. GitHub Actions runs unit tests, build, and browser tests.

For the separate live provider check, configure the server-side key and set `AI_TEST_AUDIO_PATH` to a non-sensitive mono 16 kHz, 16-bit PCM WAV. Optionally set `AI_TEST_FRAME_PATH` to a non-sensitive JPEG. Run `pnpm test:ai`. This sends the test material to Gemini and checks script generation, multipart analysis, timestamped transcription, all review stages, file cleanup, and streamed chat. It exits unsuccessfully if credentials or the fixture are missing; it never substitutes fake output. Live transcription and real-device calibration require their own manual checks.

Real-device and credentialed Gemini checks are still required before a public release: seated/standing calibration, speech with accents/noise, five-minute synchronization, connectivity loss, actual project quotas, model response shape, provider deletion, and AI advice accuracy. The target of 90% filler precision, 80% recall, and evidence alignment under 250 ms requires an annotated evaluation dataset; it is not implied by automated unit tests.

## Deploy

For Vercel, import this repository with the project root unchanged. The root `server.mjs` entrypoint and explicit `api/[...path].mjs` fallback expose the Fastify API and serve the Vite build, and the build command downloads the local MediaPipe assets before compiling the frontend. Add `GEMINI_API_KEY` to the Vercel Project Environment Variables for both Preview and Production, then redeploy; environment-variable changes do not affect an existing deployment. Vercel's `VERCEL_URL`, `VERCEL_BRANCH_URL`, and `VERCEL_PROJECT_PRODUCTION_URL` are accepted automatically for API origin checks. Set `APP_ORIGIN` to the exact public HTTPS origin when using a custom domain.

The Vercel entrypoints route draft generation, flashcards, and request/response analysis through Fastify. Project settings and the live deployment still require verification before release; this change does not deploy the branch. Live transcription uses a WebSocket and may require a persistent Node host with WebSocket support; the app falls back to final local audio analysis when live transcription is unavailable. For the full five-minute, stateful experience, use the included Dockerfile with a reverse proxy/platform providing HTTPS and WebSocket support. Set `HOST=0.0.0.0`, `APP_ORIGIN` to the exact HTTPS origin, `SECURE_COOKIES=true`, and server-side Gemini secrets. Background jobs, in-memory sessions, and live WebSockets require a persistent backend; a frontend-only or serverless deployment is insufficient for the full experience. No public deployment or upload is performed by the local setup.

```powershell
docker build -t heard .
docker run --env-file .env -e HOST=0.0.0.0 -p 3000:3000 heard
```

Do not scale to multiple instances without shared sessions, a distributed quota limiter, and durable cancellable jobs. Accounts, persistent cloud video, history, and mobile/Safari recording are outside this MVP.

## Preserved versions

The previous release remains at commit `55e99ac` on `main` and `version-2`. This redesign is developed on `version-3`; it is not merged or deployed. To inspect or run the previous release without touching the current checkout, create a sibling worktree from a clean repository:

```sh
git worktree add ../heard-version-2 version-2
cd ../heard-version-2
pnpm install
pnpm dev
```

Stop the other local dev server first, or use separate ports. Configure the worktree's own ignored `.env` if AI practice is needed. Do not copy credentials into tracked example files.
