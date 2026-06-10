(function () {
  'use strict';

  const intro = document.getElementById('story-intro');
  if (!intro) return;
  const screens = Array.from(intro.querySelectorAll('.story-screen'));
  if (screens.length < 2) return;

  const screenOne = screens[0];
  const screenTwo = screens[1];
  const nextBtn = document.getElementById('story-next');
  const enterBtn = document.getElementById('story-enter');
  const scrolly = document.getElementById('scrolly');
  const firstStep = document.querySelector('#steps .step');
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!nextBtn || !enterBtn || !scrolly) return;

const BEAT_DELAY_MS = 1250;
const PUNCHLINE_PAUSE_MS = 450;

  let timers = [];

  function clearTimers() {
    timers.forEach(timer => window.clearTimeout(timer));
    timers = [];
  }

  function queue(fn, delayMs) {
    const timer = window.setTimeout(fn, delayMs);
    timers.push(timer);
    return timer;
  }

  function showActionButton(button) {
    button.hidden = false;
    button.disabled = false;
    button.classList.add('is-visible');
  }

  function hideActionButton(button) {
    button.classList.remove('is-visible');
    button.disabled = true;
    button.hidden = true;
  }

  function setPunchlineEffect(beat) {
    intro.classList.remove('is-punchline-ocean', 'is-punchline-thesis');
    if (!beat || !beat.classList.contains('story-punchline')) return;
    if (beat.classList.contains('story-punchline-ocean')) {
      intro.classList.add('is-punchline-ocean');
    } else if (beat.classList.contains('story-punchline-thesis')) {
      intro.classList.add('is-punchline-thesis');
    }
  }

  function activateScreen(targetScreen) {
    screens.forEach(screen => {
      const isActive = screen === targetScreen;
      screen.classList.toggle('is-active', isActive);
      screen.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    });
  }

  function resetScreen(screen) {
    screen.querySelectorAll('.story-beat').forEach(beat => beat.classList.remove('is-visible'));
  }

  function revealScreen(screen, done) {
    const beats = Array.from(screen.querySelectorAll('.story-beat'));
    const button = screen === screenOne ? nextBtn : enterBtn;
    const otherButton = screen === screenOne ? enterBtn : nextBtn;

    hideActionButton(otherButton);
    intro.classList.remove('is-punchline-ocean', 'is-punchline-thesis');
    resetScreen(screen);

    if (prefersReducedMotion) {
      beats.forEach(beat => beat.classList.add('is-visible'));
      showActionButton(button);
      if (done) done();
      return;
    }

    showActionButton(button);

    let delay = 280;
    beats.forEach((beat, index) => {
      if (index > 0) {
        delay += BEAT_DELAY_MS;
        if (beat.classList.contains('story-punchline')) {
          delay += PUNCHLINE_PAUSE_MS;
        }
      }
      queue(() => {
        beat.classList.add('is-visible');
        setPunchlineEffect(beat);
      }, delay);
    });

    if (done) queue(done, delay + 100);
  }

  function startSecondScreen() {
    clearTimers();
    intro.classList.add('is-transitioning');
    intro.classList.remove('is-punchline-ocean', 'is-punchline-thesis');

    queue(() => {
      activateScreen(screenTwo);
      intro.classList.remove('is-transitioning');
      revealScreen(screenTwo);
    }, prefersReducedMotion ? 0 : 380);
  }

  function exitIntro() {
    clearTimers();
    document.body.classList.remove('story-locked');
    intro.classList.remove('is-punchline-ocean', 'is-punchline-thesis');
    intro.classList.add('is-exiting');

    const onDone = () => {
      intro.hidden = true;
      scrolly.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Move keyboard focus into the first narrative step after scrolling.
      window.setTimeout(() => {
        if (!firstStep) return;
        firstStep.setAttribute('tabindex', '-1');
        firstStep.focus({ preventScroll: true });
      }, 520);
    };

    if (prefersReducedMotion) {
      onDone();
      return;
    }
    queue(onDone, 520);
  }

  function reopenIntro() {
    clearTimers();
    intro.hidden = false;
    intro.classList.remove('is-exiting');
    document.body.classList.add('story-locked');
    activateScreen(screenOne);
    hideActionButton(enterBtn);
    revealScreen(screenOne);
    window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
  }

  window.StoryIntro = { reopen: reopenIntro };

  document.body.classList.add('story-locked');
  hideActionButton(nextBtn);
  hideActionButton(enterBtn);

  nextBtn.addEventListener('click', startSecondScreen);
  enterBtn.addEventListener('click', exitIntro);

  revealScreen(screenOne);
})();
