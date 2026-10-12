# Heard

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Students and people practicing everyday speaking. They prepare class presentations, explain ideas,
and rehearse conversations without an audience watching. Audience confirmed by the project owner.

## Product Purpose

A browser-first speaking practice studio: prepare a script, record up to five minutes, listen without
video, watch without audio, then combine the observations into one practical next step.

## Capabilities and Constraints

Existing stack: JavaScript, Vite, Fastify, Gemini, MediaPipe, and Pitchy. Keep the existing stack and hash-routed Home, Our approach, and dedicated Studio pages. Free practice and timed Memorization test share the preparation and recording workflow. Full video stays in the browser. Cloud review uses audio and up to twenty resized
images with required explicit consent. Every recording requests AI analysis; practice is unavailable without a configured AI service. After a read-through, Gemini summarizes the script into adaptive talking-point cards. Scores come from a deterministic rubric, never an AI opinion. Missing
evidence produces an unavailable score. Camera observations cannot measure internal confidence.

Recording is supported in desktop Chromium browsers over localhost or HTTPS. Pages must work on
small screens. The current API needs a continuously running Node service; sessions are temporary
and instance-local. Multi-instance persistence, accounts, and retained cloud video are outside the
existing product scope. AI requires a server-side Gemini key and project quota.

## Practice experience

Home, Our approach, and Studio are separate pages. Home keeps a brief message, a left-aligned mark, and a clear Studio action. Studio offers Free practice and a timed Memorization test. The test prepares AI key points, allows 1–30 minutes to study, automatically starts recording, and hides the full script. A separate recall review compares the transcript with the reference script; visual review stays isolated from speech. Short movements do not immediately trigger posture warnings. Alignment estimates remain approximate and need real-device validation. The previous version remains accessible on `version-2`.

## Brand Commitments

The app is rebranded as Heard, inspired by the owner's speech-and-waveform reference. The experience
uses warm neutral surfaces, charcoal actions, a single orange brand accent, and serif/sans typographic
contrast. Three top-level stages — Prepare, Practice, Review — replace the former six-step sidebar.
The owner requested a complete redesign and delegated design and information architecture decisions.
Keep copy brief, show optional controls where they matter, and preserve every existing workflow.

## Evidence on Hand

The implementation and README are evidence for functionality. No customer counts, testimonials,
accuracy benchmarks, or commercial claims have been supplied. Any demonstration is labeled.

## Product Principles

- Help people choose one useful thing to practice next.
- Prefer concise Home messaging and a focused Studio.
- Assess memorization by retained meaning, with transcription limitations explicit.
- Treat webcam posture as observable, approximate alignment; avoid warnings from brief natural movement.
- Explain what observations can and cannot establish.
- Preserve local recordings when AI, tracking, or network requests fail.
- Make privacy choices understandable before media leaves the browser.
- Treat users' voices and drafts as personal work, not leaderboard material.
