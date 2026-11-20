(() => {
  'use strict';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- Highlight the nav link of the section in view ---------- */
  const nav = document.querySelector('.site-nav__list');
  const links = new Map(
    [...document.querySelectorAll('.site-nav__list a[href^="#"]')].map((a) => [a.hash.slice(1), a]),
  );

  const setActive = (id) => {
    links.forEach((a, key) => {
      const on = key === id;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
    const a = links.get(id);
    // On phones the nav scrolls sideways: keep the active link in view.
    if (a && nav.scrollWidth > nav.clientWidth) {
      const left = a.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2;
      nav.scrollTo({ left, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    }
  };

  const spy = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) setActive(entry.target.id);
      });
    },
    // A section is "current" while it crosses the middle of the screen.
    { rootMargin: '-50% 0px -50% 0px' },
  );
  links.forEach((_, id) => {
    const section = document.getElementById(id);
    if (section) spy.observe(section);
  });

  /* ---------- Back-to-top button ---------- */
  const gotop = document.querySelector('.gotop');
  if (gotop) {
    let ticking = false;
    const update = () => {
      gotop.classList.toggle('is-visible', window.scrollY > 300);
      ticking = false;
    };
    window.addEventListener(
      'scroll',
      () => {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(update);
        }
      },
      { passive: true },
    );
    update();
    gotop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    });
  }

  /* ---------- YouTube: show a thumbnail, load the player on demand ---------- */
  // Ten embedded players would download several MB of script up front;
  // a thumbnail link costs one small image until someone presses play.
  document.querySelectorAll('.video[data-yt]').forEach((video) => {
    video.addEventListener('click', (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return; // allow "open in new tab"
      e.preventDefault();
      const id = video.dataset.yt;
      const iframe = document.createElement('iframe');
      iframe.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1`;
      iframe.title = video.getAttribute('aria-label') || 'YouTube video';
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
      iframe.allowFullscreen = true;
      iframe.className = 'video__frame';
      const wrap = document.createElement('div');
      wrap.className = 'video is-playing';
      wrap.append(iframe);
      video.replaceWith(wrap);
      iframe.focus();
    });
  });
})();
