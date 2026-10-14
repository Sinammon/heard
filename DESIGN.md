# Heard design system

Heard is a browser-first speaking studio. The name and scalable speech-and-waveform mark draw on
the supplied brand reference. The interface is a focused workspace, with enough character to feel
welcoming and enough restraint to keep attention on the user's talk.

## Information architecture

Home (`#home`), Our approach (`#about`), and Studio (`#studio`) are separate routed pages with shared sticky navigation. Home uses an animated practice-loop preview in place of the oversized mark: a breathing waveform and Speak → Listen → Improve path tied to pace, pauses, and delivery. It remains illustrative until the user enters Studio and enables the consented microphone. The page pairs this preview with a brief promise, one topic launcher, a review explorer, and essential FAQ. Privacy detail lives on Our approach and at the point of consent.

Studio is a focused Prepare → Practice → Review environment. A shared registry defines Free practice and Memorization test. A timed test studies a manual or generated script for 1–30 minutes, then automatically records with only AI key points visible. Early start, cancel, retry, and device failure states are explicit. Recall feedback compares the transcript with the source script separately from delivery reviews and deterministic scoring.

Hash navigation preserves drafts, preferences, and completed reviews. Setup releases devices on leaving the Studio; active memorization, recording, and busy actions require completion or cancellation first. The old draft storage key remains for existing users. `version-2` preserves the previous release. Development was isolated on `version-3` before the requested merge into `main`.

## Identity

- Name: **Heard**; wordmark: lowercase **heard**, Geist 750 with tight tracking.
- Mark: two speech frames enclosing five sound bars. Flat orange, scalable SVG, no raster dependency.
- Assets: `src/brand.js`, `public/heard-mark.svg`, `public/favicon.svg`.
- Canvas: `#faf9f6`; text: `#252622`; secondary text: `#6e7068`.
- Accent: `#ec572e`, used for the mark and small visual details.
- Serif accent text: `#a94a2b`; the hero mark has no surrounding card, border, or background.
- Surfaces: white and `#f3f2ee`; borders: `#eaeaea`; evidence/score tint: `#edf2e9`.
- Errors: `#a53227` on `#fcece6`.

## Typography and components

Self-hosted Geist handles UI, forms, and feedback. Instrument Serif handles public page headlines,
illustrative excerpts, and preparation guidance. No remote font calls. Headings use tight tracking;
body text uses an 18px base and 1.65 line height. Secondary text stays at least approximately 15px. Public headlines have at most two deliberate lines on desktop.

Primary actions are charcoal with white text and 6px corners. Secondary actions are white with a
quiet border. Panels use 1px structural borders, 10px corners, and generous internal space. There
are no gradients or heavy shadows. Phosphor Bold SVG icons are bundled individually.

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
