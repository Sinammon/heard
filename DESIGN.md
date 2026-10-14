# Heard design system

Heard is a browser-first speaking studio. The name and scalable speech-and-waveform mark draw on
the supplied brand reference. The interface is a focused workspace, with enough character to feel
welcoming and enough restraint to keep attention on the user's talk.

## Information architecture

Home (`#home`), Our approach (`#about`), and Studio (`#studio`) are separate routed pages with shared sticky navigation. Home follows the supplied landing reference: a serif slogan and one primary action on the left, a frameless orange mark and decorative audio illustration on the right, and a compact Prepare → Record → Review strip. The review explorer (`#how-it-works`), five mode entry points, and essential FAQ sit below the first screen. Topic and audience entry live in Studio’s Draft with AI tab. The landing action resumes existing Studio state. Privacy detail lives on Our approach and at the point of consent.

Studio is a focused Prepare → Practice → Review environment. A shared registry defines Free practice and Memorization test. A timed test studies a manual or generated script for 1–30 minutes, then automatically records with only AI key points visible. Early start, cancel, retry, and device failure states are explicit. Recall feedback compares the transcript with the source script separately from delivery reviews and deterministic scoring.

Hash navigation preserves drafts, preferences, and completed reviews. Setup releases devices on leaving the Studio; active memorization, recording, and busy actions require completion or cancellation first. The old draft storage key remains for existing users. `version-2` preserves the previous release. Development was isolated on `version-3` before the requested merge into `main`.

## Identity

- Name: **Heard**; wordmark: lowercase **heard**, Geist 750 with tight tracking.
- Mark: two speech frames enclosing five sound bars. Flat orange, scalable SVG, no raster dependency.
- Assets: `src/brand.js`, `public/heard-mark.svg`, `public/favicon.svg`.
- Canvas: `#fdfdfe`; text: `#1d1d1f`; secondary text: `#666b76`.
- Accent: `#f45128`, used for the mark, slogan emphasis, and decorative icons.
- Primary button orange: `#d83d19`, slightly deeper to keep white labels above 4.5:1 contrast.
- The slogan’s “clearer” uses orange italic. The hero mark and fixed waveform have no enclosing card, border, or panel. Camera and microphone symbols keep their individual circular outlines; all illustration elements are decorative, hidden from assistive technology, and never request device access.
- Surfaces: white and `#f3f4f7`; borders: `#e2e4e9`; evidence/score tint: `#edf2e9`.
- Errors: `#a53227` on `#fcece6`.

## Typography and components

The system sans serif stack, with self-hosted Geist, handles navigation, public content, forms, and feedback. The original self-hosted Instrument Serif is reserved for the landing slogan, using its real italic face for “clearer.” No remote font calls. Headings use tight tracking; body text uses an 18px base and 1.65 line height. Secondary text stays at least approximately 15px. The slogan has two deliberate lines and scales down on narrow screens.

Primary actions are orange with white text and 12px corners (15px for the hero action). Secondary actions are white with a quiet border. Panels use 1px structural borders, 18px corners, and restrained shadows. A subtle radial orange halo accompanies the landing mark and is removed for reduced transparency. Phosphor Bold SVG icons are bundled individually. The reference visual layer lives in `src/redesign.css`, imported after base and mode styles.

Every new take opens Audio Analysis (Step 1), followed by Posture Analysis (Step 2) and Combined Evaluation (Step 3). All three navigation steps remain visible, including an explicit unavailable posture state for camera-off takes. Combined unlocks after the posture step is visited; revisiting any unlocked step preserves reports, stage scores, chat, and playback position. Analysis completion and retries do not jump to Combined. Starting another take resets the review progress.

Rubric v3 computes separate measured audio and posture/movement scores and combines them at 70% / 30%. Audio covers filler frequency/density, ten-second pacing and variation, punctuation/disruptive pauses, and observed clipping/unclear-transcript markers. Visual scoring covers calibrated alignment and sustained shoulder-centre movement. A disclosed weakness ceiling prevents one serious issue from being hidden by strong categories. The score panels show actual component values and measured priorities ahead of AI coaching. Missing evidence is excluded and labeled partial, not assumed successful; unsupported audio withholds the overall score. Clarity is a limited evidence measure, not a full intelligibility or accent assessment. Fixed-camera movement and real-user scoring thresholds need validation.

The script editor is the largest preparation surface. Guidance is secondary and removed on narrow
screens. Setup puts required AI consent before the mirrored camera and optional posture calibration. Calibration rejects unstable samples, corrects image aspect ratio, and uses torso evidence when hips are visible. Smoothed sustained warnings and recovery hysteresis avoid flicker; seated upper-body-only tracking is labeled. A confirmed read-through or first recorded take creates 3–8 AI talking-point cards; the next take shows cards with the full script available in a disclosure. Recording puts Finish
practice next to the timer. Reviews keep playback, measured data, evidence, and feedback together.
Unavailable measurements stay explicit; illustrations never masquerade as live results.

## Interaction and accessibility

- A page-wide skip link, semantic section navigation, and labeled form inputs.
- Visible focus, arrow/Home/End keyboard behavior for script and review-example tabs.
- Short status messages, persistent errors, disabled actions while work is in progress.
- Unchecked AI consent by default; provider data-use disclosure beside the required consent checkbox. Devices and recording are disabled until consent and AI availability are confirmed.
- Muted video-only playback remains enforced. Full video stays local.
- Responsive layouts from 320px to desktop; supported recording remains desktop Chromium.
- Below-the-fold public sections reveal once through IntersectionObserver. Reduced motion bypasses
  entrance transitions and animated spinners. Camera overlays use opaque backgrounds, including
  reduced-transparency preference support.

## Scope

This redesign changes branding, layout, navigation presentation, and copy. It retains the bounded, consent-checked `/api/flashcards` route and required AI consent. Sessions accept validated mode/reference data for recall review. Scoring, recording limits, quota rules, session ownership, and deployed backend lifecycle remain unchanged.
No public deployment is performed by the redesign.
