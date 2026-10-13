import { icon } from './icons.js';
import { brand, mark } from './brand.js';

const examples = {
  audio: {
    title: 'Hear what your audience hears.',
    text: 'Listen for pace, pauses, and the words you lean on.',
    annotation: 'Find the moments where a short pause helps your idea land.',
    icon: 'headphones',
  },
  video: {
    title: 'See how your message lands.',
    text: 'Watch a muted replay to focus on posture, gestures, and movement.',
    annotation: 'Compare your delivery with your own posture baseline.',
    icon: 'video',
  },
  combined: {
    title: 'Choose your next small improvement.',
    text: 'Bring the observations together. Ask your AI coach for a practical next step.',
    annotation: 'Get an exercise grounded in your completed review.',
    icon: 'chat',
  },
};

function exampleVisual(phase) {
  if (phase === 'audio')
    return `<div class="sample-audio"><div class="sample-meta"><span>${icon('headphones')} Delivery pace</span><span>00:18</span></div><div class="sample-pace"><strong>142</strong><span>words / min<br><small>A comfortable pace</small></span></div><div class="sample-wave" aria-hidden="true">${[18, 30, 48, 26, 62, 40, 22, 52, 34, 16, 8, 8, 26, 46, 64, 32, 48, 22, 38, 56, 28, 18].map((h) => `<i style="--bar:${h}%"></i>`).join('')}</div><p class="sample-note">${icon('clock')} A short pause gives your next idea room.</p></div>`;
  if (phase === 'video')
    return `<div class="sample-video"><div class="sample-meta"><span>${icon('video')} Visual review</span><span>Sound off</span></div><div class="sample-frame"><svg viewBox="0 0 320 140" aria-hidden="true"><path class="frame-corners" d="M30 36V16h24 M266 16h24v20 M30 104v20h24 M266 124h24v-20"/><circle cx="160" cy="45" r="20"/><path d="M110 122v-18c0-22 18-35 50-35s50 13 50 35v18"/><path class="alignment-guide" d="M80 87h160"/><circle class="pose-dot" cx="115" cy="87" r="4"/><circle class="pose-dot" cx="205" cy="87" r="4"/></svg><span>Shoulder alignment</span></div><p class="sample-note">${icon('eye')} Notice movement against your own baseline.</p></div>`;
  return `<div class="sample-reflect"><div class="sample-meta"><span>${icon('chat')} Your next take</span><span>One focus</span></div><p class="sample-question">How can I make my ending clearer?</p><div class="sample-exercise"><span class="content-label">Try this · 1 minute</span><h4>Give your last line room.</h4><p>Say your closing thought. Pause. Repeat it once more, using your own words.</p></div></div>`;
}

export function demoView(phase = 'audio') {
  const key = examples[phase] ? phase : 'audio';
  const item = examples[key];
  return `<div class="demo-copy"><span class="icon-box">${icon(item.icon)}</span><h3>${item.title}</h3><p>${item.text}</p><p class="demo-annotation">${icon('arrow')}${item.annotation}</p></div><div class="demo-example"><span class="eyebrow">Illustrative example · not an AI review</span>${exampleVisual(key)}</div>`;
}

function journey() {
  return `<ol class="practice-journey">${[
    ['edit', 'Prepare your script', 'Write your own words or shape an AI draft around your idea.'],
    ['mic', 'Practice your speech', 'Read through or test your memory with a few key points.'],
    [
      'headphones',
      'Review your delivery',
      'Listen, watch, and choose one thing to improve next time.',
    ],
  ]
    .map(
      ([symbol, title, copy], i) =>
        `<li><div class="journey-marker"><span class="icon-box">${icon(symbol)}</span><span>0${i + 1}</span></div><h3>${title}</h3><p>${copy}</p></li>`,
    )
    .join('')}</ol>`;
}

function navigation(page) {
  return `<a class="skip-link" href="#page-content">Skip to content</a><header class="site-header"><a class="brand" href="#home" aria-label="Heard home">${brand}</a><nav class="site-nav" aria-label="Main navigation"><a href="#home" ${page === 'home' ? 'aria-current="page"' : ''}>Home</a><a href="#how-it-works" data-home-link>How it works</a><a href="#about" ${page === 'about' ? 'aria-current="page"' : ''}>Our approach</a></nav><a class="button primary nav-cta" id="nav-action" href="#studio" ${page === 'studio' ? 'aria-current="page"' : ''}>Start practicing ${icon('arrow')}</a></header>`;
}

function footer() {
  return `<footer class="site-footer"><a class="brand" href="#home" aria-label="Heard home">${brand}</a><p>A little practice goes a long way.</p><nav aria-label="Footer navigation"><a href="#about">Our approach & privacy</a><a href="#studio">Start practicing ${icon('external')}</a></nav></footer>`;
}

function home() {
  return `<section class="landing-hero" id="home"><div class="hero-logo" aria-hidden="true">${mark}</div><div class="hero-copy"><p class="eyebrow">Your speaking studio</p><h1>A little practice.<br>A <em>clearer</em> voice.</h1><p class="hero-description">Practice a speech. Get feedback on your pace, pauses, and delivery.</p><form id="practice-launcher" class="practice-launcher"><label for="practice-topic">What are you practicing for?</label><div class="launcher-input"><input id="practice-topic" name="practice-topic" autocomplete="off" maxlength="400" placeholder="A presentation, an introduction, an idea…"><button class="button primary" id="enter" type="submit">Start practicing ${icon('arrow')}</button></div><div class="occasion-options"><button type="button" data-topic="Introduce an idea to my class">Class presentation</button><button type="button" data-topic="Introduce myself to someone new">An introduction</button><button type="button" data-topic="Explain something I care about">An idea</button></div></form><div class="hero-baseline"><span>${icon('clock')}Up to 15 minutes</span><span>${icon('shield')}Full video stays on your device</span></div><p class="hero-disclosure">AI review required · audio and selected images are shared.</p></div></section><section class="how-section" id="how-it-works"><div class="section-heading"><div><p class="eyebrow">How it works</p><h2>A little practice.<br>A useful next step.</h2></div><a class="text-link" href="#studio">Start practicing ${icon('arrow')}</a></div>${journey()}<div class="experience"><div class="experience-toolbar"><span class="content-label">One take. Three perspectives.</span><div role="tablist" aria-label="Explore review stages">${['audio', 'video', 'combined'].map((phase, i) => `<button role="tab" id="demo-tab-${phase}" data-demo="${phase}" aria-controls="demo-panel" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${icon(examples[phase].icon)}${phase === 'audio' ? 'Listen' : phase === 'video' ? 'Watch' : 'Reflect'}</button>`).join('')}</div></div><div id="demo-panel" class="demo-panel" role="tabpanel" aria-labelledby="demo-tab-audio" tabindex="0">${demoView()}</div></div></section><section class="faq-section"><div><p class="eyebrow">Before you start</p><h2>A few essentials.</h2></div><div class="faq-list">${[
    [
      'What do I need?',
      'A camera, microphone, and desktop Chrome or Edge. Write a script or generate an AI draft. Choose free practice or a timed memorization test.',
    ],
    [
      'Is AI review required?',
      'Yes. Consent and an available Gemini service are required before recording. You can always prepare your script.',
    ],
    [
      'What is shared with AI?',
      'Your script, audio, and up to 20 resized still frames. Full video stays in your browser. Use non-sensitive practice material. Read the data terms before accepting consent in the Studio.',
    ],
    [
      'Does Heard measure confidence?',
      'A webcam cannot measure how confident you feel. Feedback covers observable delivery. Limited posture tracking gives a labeled partial score. Insufficient speech evidence means no score.',
    ],
  ]
    .map(([q, a]) => `<details><summary>${q}${icon('down')}</summary><p>${a}</p></details>`)
    .join('')}</div></section>`;
}

function about() {
  return `<section class="about-hero" id="about"><p class="eyebrow">The Heard approach</p><h1>Your voice.<br>A little more <em>room.</em></h1><p>A place to rehearse without an audience.<br>One attempt. One observation. One useful next step.</p></section><section class="approach-grid">${[
    [
      'edit',
      'Start with your words.',
      'Write your own script or use Gemini for a first draft. Edit until it sounds like something you would actually say.',
    ],
    [
      'eye',
      'Notice, then adjust.',
      'Review sound and picture separately before putting them together. Feedback focuses on speaking habits, never your personality or internal confidence.',
    ],
    [
      'check',
      'Follow the evidence.',
      'Reviews link to moments in your recording. Scores use a fixed rubric for fillers, pace, pauses, and posture. AI does not determine your score.',
    ],
  ]
    .map(
      ([ico, title, text]) =>
        `<article><span class="icon-box">${icon(ico)}</span><h2>${title}</h2><p>${text}</p></article>`,
    )
    .join(
      '',
    )}</section><section class="privacy-section"><div><p class="eyebrow">Privacy, plainly</p><h2>You choose<br>what leaves your device.</h2></div><div><article><h3>Video stays local</h3><p>Write your script locally. Full video and playback stay in your browser. Drafts stay in this tab. Recordings are cleared when you reset or close the page.</p></article><article><h3>Consent before practice</h3><p>Every practice includes AI review and requires your consent. AI drafting sends your topic and audience to Gemini. Talking-point cards share your script; recording review shares audio and up to 20 resized still frames. Full video is never uploaded.</p></article><article><h3>Know the trade-off</h3><p>Google’s free service may use content for product improvement and human review. Use non-sensitive practice material. Uploaded audio is deleted after processing; provider deletion failures are shown.</p><a class="text-link" href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener noreferrer">Read Gemini’s data terms ${icon('external')}</a></article></div></section><section class="about-cta"><h2>Give your next talk<br>a practice run.</h2><a class="button primary" href="#studio">Start practicing ${icon('arrow')}</a></section>`;
}

export function publicPage(page) {
  return `<div class="public-site">${navigation(page)}<main id="page-content" tabindex="-1"><div id="home-page" ${page === 'home' ? '' : 'hidden'}>${home()}</div><div id="about-page" ${page === 'about' ? '' : 'hidden'}>${about()}</div><section class="studio-section" id="studio" aria-label="Speaking studio" ${page === 'studio' ? '' : 'hidden'}><div id="studio-content"></div></section></main>${footer()}</div>`;
}
