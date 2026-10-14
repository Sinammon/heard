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

Open http://localhost:5173. Camera permissions work on localhost; any remote deployment requires HTTPS. You can write a script without a key. Enabling the microphone (and optional camera) and recording require AI consent and a configured Gemini service. Every take automatically requests AI analysis; unavailable AI or exhausted quota produces a visible failure, while any completed local playback remains usable. Missing AI never produces fake feedback or a verified score.

Create the free API key at https://aistudio.google.com/apikey. Keep it in `.env` on the server, never in frontend code. Do not send your key in chat or commit `.env`.

Production build:

```powershell
pnpm build
pnpm start
```

Open http://localhost:3000. The build downloads the matching MediaPipe model if absent and bundles self-hosted fonts. The server serves the compiled frontend. Recording supports desktop Chrome and Edge, English, one speaker, 15-minute recordings, and seated or standing calibration. The interface adapts to mobile and tablet; real-device mobile/Safari recording is not yet validated. Node service restarts lose temporary reports; the page's existing local playback remains usable.

## Gemini configuration

`@google/genai` provides the Interactions API, Files API, and Live API. Defaults, configurable through `.env`:

- `GEMINI_MODEL=gemini-3.5-flash-lite`: script generation, audio/image reviews, combined review, and streamed text chat.
- `GEMINI_TRANSCRIBE_MODEL=gemini-3.5-transcribe`: verbatim final transcription with `word_info` timestamps.
- `GEMINI_LIVE_MODEL=gemini-3.5-transcribe-live`: 16-bit, mono, 16 kHz PCM, verbatim text streaming.

Availability and free quotas depend on your Google project. These are the model names documented at implementation time; a 404 explains how to configure another available model. The final transcription adapter specifically requires a dedicated transcription model returning word annotations; do not substitute a general model's estimated timestamps.

Script drafting has a separate 45-second end-to-end deadline that includes waiting in the shared Gemini request queue. A timeout stops the request and returns a retryable error without replacing the current script.

Read your active request, token, and daily quotas in Google AI Studio, then set `GEMINI_RPM`, `GEMINI_TPM`, and `GEMINI_RPD`. The sample values are conservative application limits, not a claim about Google's quotas. Quotas are shared by the project and this application cannot see usage from other applications. Non-live requests are serialized. Live connections reserve a 15-minute token budget. 429s never trigger a paid fallback; transient server errors receive one retry. Chat history is bounded.

## Privacy and lifecycle

Script preparation stays local unless you request an AI draft. Recording requires a configured server key and explicit cloud-processing consent during setup; there is no local-only recording mode. Consent is unchecked by default and is required before enabling devices or starting a practice. Every completed take automatically submits audio and, if camera is enabled, selected frames for AI review. Google's unpaid-service terms permit product improvement and human review and instruct users not to submit sensitive, confidential, or personal information; regional exceptions apply. Evaluate https://ai.google.dev/gemini-api/terms before accepting identifiable recordings from real users. Application cleanup does not promise confidential or zero-retention processing by Google.

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

The live score stays unavailable until live transcription is connected and finalized speech includes at least 50 words across 30 seconds. Scores with less than 80% usable posture coverage are explicitly **partial**: posture is excluded and the supported speech categories are normalized to 100. Final scoring still requires at least 30 seconds, 50 timestamped words, and 80% speech timing coverage; missing speech evidence never produces a score. Live timing, WPM, silence, and deductions are approximate and provisional. Final word annotations replace them.

The final rubric is deterministic and versioned as `v2` in `shared/scoring.js`. Complete scores use `round(100 - 25F - 25R - 20P - 30B)`. Partial scores use `round(100 × (1 - supported deductions / supported category weights))`, omitting posture's 30-point weight and penalty when its coverage is below 80%. Reports include `partial`, `availableCategories`, warnings, and actual coverage; partial scores are not equivalent to complete scores. No posture deviation percentage is invented when there are no usable samples.

Factors are clamped to 0–1. F is `(filler events/minute - 1)/5`. Hesitation sounds include `um`, `uh`, extended spellings, `er`, `erm`, `ah`, and `hmm`. Conservative punctuation/context rules also match bracketed `you know`, `I mean`, `kind of`, `sort of`, `like`, `basically`, `actually`, `literally`, `well`, `so`, and `right`. A phrase counts once. Literal/grammatical uses such as “I like trees” or “you know the answer” are excluded; the rules cannot recognize every semantic filler. Gemini coaches from these events and may discuss ambiguous verbal crutches qualitatively, but does not change the counter or numeric score.

R is the fraction of complete 20-second windows outside **110–180 WPM**; the dashboard shows provisional WPM and the review exposes pace deductions. P evaluates measured word gaps after commas (target **150–500 ms**) and sentence endings (target **300–900 ms**). Missing pauses have graded loss; overly long boundaries have graded loss, saturating at three times the upper target. P is the larger of the average boundary loss and internal silence beyond three seconds divided by 15% of delivery time, avoiding a duplicate penalty for one long punctuation pause. Leading/trailing silence, abbreviations, ellipses, and overlapping word annotations are excluded from boundary assessment. Punctuation comes from actual word annotations, or an exactly matching transcript; the reference script never supplies assumed pauses. These targets are practice defaults, not proof of robotic speech or clinical norms. B is deviation time divided by 30% of valid tracked time.

Pose tracking uses the Lite model in a CPU Web Worker, one inference in flight, 320-pixel-wide input, and adaptive 5–10 Hz sampling. Five-second calibration requires at least 20 usable observations and rejects unstable head/shoulder/torso geometry. Image coordinates are corrected for the camera aspect ratio; visible shoulders and hips supply torso lean and compression, and 3D world landmarks supply estimated forward lean. A head nod alone is not treated as back posture. Low-confidence, off-screen, and degenerate landmarks are excluded. Seated views without hips track shoulder alignment only, explicitly labeled as limited in the UI. Absolute movement of the head and shoulders cannot distinguish camera/chair movement from slouching, so it never triggers a back warning. A shoulder-width change beyond the calibrated framing range makes tracking unavailable until the user returns or recalibrates. If hips disappear after torso calibration, usable head/shoulder tracking continues and warning continuity resets when switching measurement modes. Reports disclose the fraction of tracked delivery limited to upper-body alignment; these observations cannot establish back curvature or forward torso lean reliably.

Measurements are smoothed over time. A deviation must persist for two seconds before becoming a warning, with a lower recovery threshold and one second of recovery to prevent flicker. Tracking gaps reset the detector and episode continuity. The mirrored preview and overlay preserve the complete camera frame and share letterboxing. Keep the camera fixed and include the hips for torso tracking. Webcam geometry is approximate and cannot establish spinal health or internal confidence. Thresholds still require validation with real users; synthetic tests verify geometry and state behavior, not real-device accuracy. Coordinate conventions follow the [MediaPipe Pose Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker).

Pitchy estimates pitch periodicity, not intelligibility. Audio level and pitch-variation measurements are descriptive and are not directly scored. Silence detection during recording is an RMS heuristic; final pauses use canonical word gaps. Rhetorical pauses and natural movement may be appropriate despite rubric deductions.

## Architecture

The app is branded as **Heard**, with a warm neutral canvas, charcoal controls, an orange speech-and-waveform logo on the left of the hero, and self-hosted Geist and Instrument Serif fonts. Home (`#home`), Our approach (`#about`), and Studio (`#studio`) are separate hash-routed pages. Home has a compact topic launcher, a three-step Prepare → Practice → Review explanation, and distinct illustrative Listen / Watch / Reflect previews. Studio setup presents consent, devices, and starting practice as three numbered steps, with nearby guidance for disabled controls and scoring requirements. Reading-time estimates show seconds for short scripts and use the shared 15-minute limit. Studio keeps public content hidden for a focused **Prepare → Practice → Review** workflow. Drafts, mode preferences, and completed reviews survive page navigation; navigating home from setup releases devices. Active study, recording, and busy actions guard against accidental navigation. Switching browser tabs cancels study without starting a recording. Sticky navigation, readable typography, keyboard focus, and reduced-motion support remain available.

Studio has five modes defined in `shared/practice.js` (details below). The original two are preserved: **Free practice** retains script/flashcard-assisted rehearsal; **Memorization test** accepts a manual or AI-generated script and 1–30 study minutes. Consent and ready devices are required. Valid AI key points are prepared before the clock starts; failure offers retry and never starts a test without notes. The countdown uses a deadline to avoid timer drift, can be paused, resumed, canceled or ended early, and automatically starts recording at expiry. The full script and live transcript are absent from the speaking-test UI; only 3–8 synthesized key points remain. Device/session failures stay visible and recoverable.

The memorization session retains the consented reference script temporarily for a separate, transcript-only AI recall review. This compares meaning, retained ideas, and omissions rather than requiring word-for-word recitation. Recall feedback is qualitative, may be limited by transcription quality, and does not determine the delivery score. Audio-only and visual-only delivery reviews remain isolated. Combined coaching uses derived reports, including available recall feedback. Missing transcription produces unavailable recall feedback, never a fabricated memory assessment. Review opens with Voice feedback, then offers Visual feedback when video is available, followed by a Summary; completed stages can be revisited.

`src/pages.js` contains routed public pages and the dedicated Studio mount; `src/studio-views.js` contains preparation and setup; `src/style.css` defines shared tokens and responsive components. `src/brand.js` defines the scalable mark and wordmark; `public/heard-mark.svg` and `public/favicon.svg` provide standalone assets. `src/draft.js` retains the legacy storage key so existing drafts survive the rebrand, `src/text.js` handles text utilities, and `src/icons.js` imports only the Phosphor assets used. Fonts and icons are served locally, with no external font or image requests. Keyboard focus, loading, errors, AI-unavailable states, reduced motion, and reduced transparency are supported. Product decisions live in `PRODUCT.md` and the design system in `DESIGN.md`.

- `src/`: workflow UI, capture controller, posture worker, acoustic worker, safe API/chat rendering.
- `shared/`: scoring and calibration/episode logic shared with the backend.
- `server/`: ownership, validation, bounded Gemini jobs, stage isolation, media cleanup, live relay, chat.
- `public/`: matching MediaPipe WASM/model, audio worklet, and favicon.

Routes: `POST /api/scripts`, `POST /api/flashcards`, `POST /api/topics`, `POST /api/sessions/:id/interview`, `POST /api/sessions`, `WS /api/sessions/:id/transcription`, `POST /api/sessions/:id/analyze`, `GET /api/sessions/:id/report`, `POST /api/sessions/:id/chat`, `DELETE /api/sessions/:id`.

Analysis accepts multipart fields `payload` (validated JSON) and `audio` (mono 16 kHz PCM WAV). The payload contains recording duration, posture mode, valid/deviation pose samples, posture episodes, timestamped frames, and acoustic summaries. Session creation accepts an optional validated `practice` object: `{mode:"free"}` (default) or mode-specific memorization, impromptu, interview and delivery options (validated in `shared/practice.js`). The reference script is consented session data, never a visual-review input, and is cleared with the session. Duplicate processing/completed submissions return the existing job. Partial jobs retain completed stages and can retry failed stages with the local audio. Chat is NDJSON with `{text}`, `{done:true}`, or `{error}` records.

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

Real-device and credentialed Gemini checks are still required before a public release: seated/standing calibration, speech with accents/noise, 15-minute synchronization, connectivity loss, actual project quotas, model response shape, provider deletion, and AI advice accuracy. The target of 90% filler precision, 80% recall, and evidence alignment under 250 ms requires an annotated evaluation dataset; it is not implied by automated unit tests.

## Deployment on Render

The app can run as one persistent Render Web Service serving `dist/` and same-origin `/api` routes. Use `pnpm install --frozen-lockfile && pnpm build` as the build command and `pnpm start` as the start command. The build must include the ignored pose model and matching WASM assets. Set `HOST=0.0.0.0`, `NODE_ENV=production`, `APP_ORIGIN` to the exact public HTTPS origin, `SECURE_COOKIES=true`, and Gemini secrets in the backend environment. `server/index.js` uses the platform's `PORT` value. Actual Render settings, service resources, upload limits, and live Gemini quotas have not been verified by local tests.

Practice is capped at 15 minutes throughout capture, API health, WAV validation, and the live relay. Mono 16 kHz PCM is about 28.8 MB for 15 minutes; the multipart file bound is derived from that duration with 250 ms capture tolerance and a WAV header. Up to 10,000 pose observations and 20 resized stills are accepted, with a 5 MiB multipart metadata bound. Script generation accepts 1–15 minutes, targets 130 words per minute with an output budget scaled to length, and shares a 30,000-character script bound across drafts, flashcards, and memorization. Longer local video takes consume more browser memory. Upstream transcription may end before the application limit; final analysis still uses local recorded audio and failures remain visible. Quota limits are preserved, without automatic paid fallbacks.

Background jobs, temporary sessions, and live WebSockets require a persistent backend. Service restarts lose temporary reports; browser playback remains local. Do not scale to multiple instances without shared sessions, a distributed quota limiter, and durable cancellable jobs. Accounts, retained cloud video, and persistent history remain outside this implementation. The legacy Vercel entrypoints remain in the repository; a frontend-only or serverless deployment does not support the full stateful experience.

The included Dockerfile is an alternative single-service deployment:

```powershell
docker build -t heard .
docker run --env-file .env -e HOST=0.0.0.0 -p 3000:3000 heard
```

## Preserved versions

The 15-minute scoring changes are isolated on `Version_3`, distinct from `version-3` and `main`. The previous release remains at commit `55e99ac` on `version-2`. The redesign was developed on `version-3` and merged into `main` on request. Deployment must still be verified separately. To inspect or run the previous release without touching the current checkout, create a sibling worktree from a clean repository:

```sh
git worktree add ../heard-version-2 version-2
cd ../heard-version-2
pnpm install
pnpm dev
```

Stop the other local dev server first, or use separate ports. Configure the worktree's own ignored `.env` if AI practice is needed. Do not copy credentials into tracked example files.

### Five practice modes (version-4)

- **Free practice:** write or draft a script, record up to 15 minutes, then use adaptive AI talking points.
- **Memorization test:** study for 1–30 minutes, automatically start recording, and navigate or hide key-point cards. Recall feedback accepts meaningful paraphrases.
- **Impromptu Speaking:** choose category/difficulty, prepare for 15/30/60 seconds, then speak for 1/2/3 minutes. AI creates a topic, never a speech. Retry the same topic or request a new one.
- **AI Interview:** select job/university/general and difficulty. Three microphone answers receive transcript-grounded follow-ups. Review the conversation, finish early if needed, or retry individual answers. Each answer allows up to three minutes.
- **Delivery Coach:** free speech or pace, pause, filler and expression drills. Repeat the same drill to compare measured WPM and filler/pause cues per minute. Comparisons are kept only in this tab (latest 20 attempts), not an account history.

Microphone-only is the default in every mode. The separate camera checkbox is off until explicitly selected; no camera permission, pose worker or still images are used in that path. Camera takes preserve mirrored preview, optional calibration and unmirrored replay. Without camera, visual review is skipped and speech-only scores remain labeled partial. Short takes still have an unavailable overall score. Pitch variation is descriptive, shown only when enough reliable voiced samples exist, and never affects scoring. Timed exercises are single takes: finish early or retry; preparation can be canceled. Hiding the tab cancels preparation or finishes active recording.

`POST /api/topics` requires consent and bounded category/difficulty. `POST /api/sessions/:id/interview` accepts `next`, `retry` with an index, or `finish`; session ownership is required. Follow-up input comes exclusively from canonical server transcripts and reviews. Provider failure preserves the completed answer. All prompts use existing Gemini quotas and cancellation; no extra provider or paid fallback is introduced. Interview content is temporary and follows session expiry/deletion. Full video stays local.

The studio uses a shared mode registry with distinct preparation and active prompts. Reviews open with combined coaching when available, retain separate audio/visual inspection, and offer a direct retry. All AI examples in automated tests are explicit doubles; those tests do not verify live Gemini quality, quotas, or real-device posture accuracy.
