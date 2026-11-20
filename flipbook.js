/*
 * 背包日記攝影集 — dependency-free page-turn viewer.
 *
 * Wide screens show two-page spreads like a real book; narrow screens show
 * one page at a time. Pages turn by tapping / clicking, dragging or swiping,
 * the arrow buttons, the slider, or the keyboard ← → keys.
 *
 * Only the leaves around the current page are rendered and only their
 * images are downloaded, so the 120-page album stays light on phones.
 *
 * Markup contract (see index.html):
 *   .flipbook[data-pages][data-ratio][data-src][data-widths]
 *     .flipbook__viewport > .flipbook__book
 *     .flipbook__controls with [data-turn="-1"], [data-turn="1"],
 *       .flipbook__range and .flipbook__counter
 */
(() => {
  'use strict';

  const SPREAD_MIN_WIDTH = 700; // container width needed for two-page spreads
  const TURN_MS = 800;
  const DRAG_THRESHOLD = 8; // px of movement before a press becomes a drag
  const PRELOAD = 3; // leaves to load ahead of / behind the current one

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const easeOut = (t) => 1 - (1 - t) ** 3;

  class FlipBook {
    constructor(root) {
      this.root = root;
      this.count = Number(root.dataset.pages); // including front & back cover
      this.ratio = Number(root.dataset.ratio); // page width / height
      this.pattern = root.dataset.src; // e.g. img/album/p{n}-{w}.webp
      this.widths = root.dataset.widths.split(',').map(Number);

      this.viewport = root.querySelector('.flipbook__viewport');
      this.book = root.querySelector('.flipbook__book');
      this.controls = root.querySelector('.flipbook__controls');
      this.prevBtn = root.querySelector('[data-turn="-1"]');
      this.nextBtn = root.querySelector('[data-turn="1"]');
      this.range = root.querySelector('.flipbook__range');
      this.counter = root.querySelector('.flipbook__counter');

      this.cols = 0; // 1 = single page, 2 = spread
      this.leaves = [];
      this.current = 0; // number of leaves turned to the left
      this.page = 0; // first visible page, kept across layout changes
      this.turning = null;
      this.anim = null;
      this.drag = null;
      this.near = false; // close enough to the viewport to load images
      this.inView = false; // visible enough to take arrow keys

      this.layout();
      this.bind();
      root.classList.add('is-ready');
    }

    /* ---------- layout ---------- */

    layout() {
      const cs = getComputedStyle(this.root);
      const width = this.root.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const cols = width >= SPREAD_MIN_WIDTH ? 2 : 1;
      const nav = document.querySelector('.site-nav');
      const reserve = (nav ? nav.offsetHeight : 0) + this.controls.offsetHeight + 56;
      // clientHeight ignores mobile URL bars collapsing, so the book doesn't
      // resize while the page scrolls.
      const viewH = document.documentElement.clientHeight || window.innerHeight;
      const maxH = Math.max(200, viewH - reserve);
      const pageW = Math.floor(Math.min(width / cols, maxH * this.ratio));
      if (cols === this.cols && pageW === this.pageW) return;

      this.abort();
      this.pageW = pageW;
      this.pageH = Math.round(pageW / this.ratio);
      this.root.style.setProperty('--page-w', `${pageW}px`);
      this.root.style.setProperty('--page-h', `${this.pageH}px`);

      if (cols !== this.cols) {
        this.cols = cols;
        this.root.classList.toggle('is-spread', cols === 2);
        this.root.classList.toggle('is-single', cols === 1);
        this.build();
        this.current = cols === 2 ? Math.ceil(this.page / 2) : this.page;
      }
      this.book.querySelectorAll('img[srcset]').forEach((img) => {
        img.sizes = `${pageW}px`;
      });
      this.render();
    }

    // Spread mode: leaf i carries page 2i on its front and 2i+1 on its back,
    // so the cover sits alone on the right and the back cover alone on the
    // left. Single mode: one page per leaf, blank backs.
    build() {
      const spread = this.cols === 2;
      const total = spread ? Math.ceil(this.count / 2) : this.count;
      this.book.textContent = '';
      this.leaves = [];
      for (let i = 0; i < total; i++) {
        const front = spread ? 2 * i : i;
        const back = spread && 2 * i + 1 < this.count ? 2 * i + 1 : -1;
        const el = document.createElement('div');
        el.className = 'leaf';
        el.hidden = true;
        el.append(this.face(front, 'front'), this.face(back, 'back'));
        this.book.append(el);
        this.leaves.push({ el, loaded: false });
      }
      // In single mode the last page cannot be turned away.
      this.max = spread ? total : total - 1;
      this.range.max = this.max;
    }

    face(page, side) {
      const face = document.createElement('div');
      face.className = `face face--${side}`;
      if (page === 0 || page === this.count - 1) face.classList.add('face--cover');
      if (page >= 0) {
        const img = document.createElement('img');
        img.alt = this.label(page);
        img.decoding = 'async';
        img.draggable = false;
        img.dataset.page = page;
        face.append(img);
      }
      return face;
    }

    label(page) {
      if (page === 0) return '攝影集封面';
      if (page === this.count - 1) return '攝影集封底';
      return `攝影集第 ${page} 頁`;
    }

    src(page, width) {
      return this.pattern.replace('{n}', String(page).padStart(3, '0')).replace('{w}', width);
    }

    /* ---------- state ---------- */

    visiblePages() {
      const c = this.current;
      if (this.cols === 1) return [c];
      return [2 * c - 1, 2 * c].filter((p) => p >= 0 && p < this.count);
    }

    // Spread mode centres the closed book instead of leaving half empty.
    shiftFor(current) {
      if (this.cols === 1) return 0;
      if (current === 0) return -this.pageW / 2;
      if (current === this.max) return this.pageW / 2;
      return 0;
    }

    setShift(px) {
      this.book.style.transform = px ? `translateX(${px}px)` : '';
    }

    render() {
      const n = this.leaves.length;
      const c = this.current;
      this.leaves.forEach((leaf, i) => {
        // The two facing leaves plus the ones directly underneath them.
        const visible = i >= c - 2 && i <= c + 1;
        leaf.el.hidden = !visible;
        if (!visible) return;
        const turned = i < c;
        leaf.el.style.transform = turned ? 'rotateY(-180deg)' : '';
        leaf.el.style.zIndex = turned ? i + 1 : n - i;
        leaf.el.style.removeProperty('--shade');
      });
      this.setShift(this.shiftFor(c));
      this.load();
      this.updateControls();
    }

    load() {
      if (!this.near) return;
      const lo = Math.max(0, this.current - PRELOAD);
      const hi = Math.min(this.leaves.length - 1, this.current + PRELOAD);
      for (let i = lo; i <= hi; i++) {
        const leaf = this.leaves[i];
        if (leaf.loaded) continue;
        leaf.loaded = true;
        leaf.el.querySelectorAll('img').forEach((img) => {
          const page = Number(img.dataset.page);
          img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
          img.sizes = `${this.pageW}px`;
          img.srcset = this.widths.map((w) => `${this.src(page, w)} ${w}w`).join(', ');
          img.src = this.src(page, this.widths[this.widths.length - 1]);
        });
      }
    }

    updateControls() {
      const pages = this.visiblePages();
      const inner = this.count - 2;
      let text;
      if (pages.length === 1 && pages[0] === 0) text = '封面';
      else if (pages.length === 1 && pages[0] === this.count - 1) text = '封底';
      else text = `${pages.join('–')} / ${inner}`;
      this.counter.textContent = text;
      this.range.value = this.current;
      this.range.setAttribute('aria-valuetext', text);
      this.prevBtn.disabled = this.current <= 0;
      this.nextBtn.disabled = this.current >= this.max;
    }

    canTurn(dir) {
      return dir > 0 ? this.current < this.max : this.current > 0;
    }

    jump(target) {
      this.abort();
      this.current = clamp(target, 0, this.max);
      this.page = this.visiblePages()[0];
      this.render();
    }

    /* ---------- turning ---------- */

    turn(dir) {
      this.finish();
      if (!this.canTurn(dir)) return;
      this.begin(dir);
      this.play(0, 1, TURN_MS, true, easeInOut);
    }

    begin(dir) {
      const i = dir > 0 ? this.current : this.current - 1;
      const el = this.leaves[i].el;
      el.style.zIndex = this.leaves.length + 1;
      el.classList.add('is-turning');
      this.turning = {
        el,
        dir,
        p: 0,
        from: this.shiftFor(this.current),
        to: this.shiftFor(this.current + dir),
      };
    }

    // p = 0: leaf where it started; p = 1: leaf fully turned.
    progress(p) {
      const t = this.turning;
      const angle = t.dir > 0 ? -180 * p : -180 * (1 - p);
      t.el.style.transform = `rotateY(${angle.toFixed(2)}deg)`;
      t.el.style.setProperty('--shade', Math.sin(p * Math.PI).toFixed(3));
      this.setShift(lerp(t.from, t.to, p));
      t.p = p;
    }

    play(from, to, ms, commit, ease) {
      const done = () => {
        this.anim = null;
        this.end(commit);
      };
      if (ms <= 0 || reducedMotion.matches) {
        this.progress(to);
        done();
        return;
      }
      const start = performance.now();
      const step = (now) => {
        const k = clamp((now - start) / ms, 0, 1);
        this.progress(lerp(from, to, ease(k)));
        if (k < 1) this.anim.raf = requestAnimationFrame(step);
        else done();
      };
      this.anim = {
        raf: requestAnimationFrame(step),
        finish: () => {
          cancelAnimationFrame(this.anim.raf);
          this.progress(to);
          done();
        },
      };
    }

    end(commit) {
      const t = this.turning;
      this.turning = null;
      t.el.classList.remove('is-turning');
      if (commit) {
        this.current += t.dir;
        this.page = this.visiblePages()[0];
      }
      this.render();
    }

    // Complete a running animation immediately (e.g. on a rapid second click).
    finish() {
      if (this.anim) this.anim.finish();
    }

    // Drop any animation or drag without turning (used on layout changes).
    abort() {
      if (this.anim) {
        cancelAnimationFrame(this.anim.raf);
        this.anim = null;
      }
      if (this.turning) {
        this.turning.el.classList.remove('is-turning');
        this.turning = null;
      }
      this.drag = null;
      this.root.classList.remove('is-dragging');
    }

    /* ---------- input ---------- */

    bind() {
      this.prevBtn.addEventListener('click', () => this.turn(-1));
      this.nextBtn.addEventListener('click', () => this.turn(1));
      this.range.addEventListener('input', () => this.jump(Number(this.range.value)));

      const vp = this.viewport;
      vp.addEventListener('pointerdown', (e) => this.onDown(e));
      vp.addEventListener('pointermove', (e) => this.onMove(e));
      vp.addEventListener('pointerup', (e) => this.onUp(e));
      vp.addEventListener('pointercancel', (e) => this.onUp(e));
      vp.addEventListener('dragstart', (e) => e.preventDefault());

      document.addEventListener('keydown', (e) => this.onKey(e));

      let raf = 0;
      window.addEventListener('resize', () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => this.layout());
      });

      const nearObserver = new IntersectionObserver(
        (entries) => {
          if (!entries[0].isIntersecting) return;
          this.near = true;
          this.layout(); // fonts / header may have changed size since startup
          this.load();
          nearObserver.disconnect();
        },
        { rootMargin: '800px 0px' },
      );
      nearObserver.observe(this.root);

      new IntersectionObserver(
        (entries) => {
          this.inView = entries[0].intersectionRatio >= 0.5;
        },
        { threshold: [0, 0.5, 1] },
      ).observe(vp);
    }

    onDown(e) {
      if (e.button > 0 || this.drag) return;
      this.drag = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        active: false,
        samples: [[e.timeStamp, e.clientX]],
      };
    }

    onMove(e) {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;

      if (!d.active) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        if (Math.abs(dy) > Math.abs(dx)) {
          this.drag = null; // vertical gesture: let the page scroll
          return;
        }
        const dir = dx < 0 ? 1 : -1;
        this.finish();
        if (!this.canTurn(dir)) {
          this.drag = null;
          return;
        }
        d.active = true;
        d.dir = dir;
        this.begin(dir);
        this.root.classList.add('is-dragging');
        try {
          this.viewport.setPointerCapture(e.pointerId);
        } catch {
          /* pointer already released */
        }
      }

      d.samples.push([e.timeStamp, e.clientX]);
      if (d.samples.length > 6) d.samples.shift();
      const span = this.pageW * (this.cols === 2 ? 1.6 : 1.1);
      this.progress(clamp((d.dir > 0 ? -dx : dx) / span, 0, 1));
    }

    onUp(e) {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      this.drag = null;
      this.root.classList.remove('is-dragging');

      if (!d.active) {
        if (e.type === 'pointerup') this.tap(e.clientX);
        return;
      }

      const [t0, x0] = d.samples[0];
      const velocity = (e.clientX - x0) / Math.max(1, e.timeStamp - t0); // px per ms
      const flingForward = d.dir > 0 ? velocity < -0.35 : velocity > 0.35;
      const flingBack = d.dir > 0 ? velocity > 0.35 : velocity < -0.35;
      const p = this.turning.p;
      const commit = e.type === 'pointerup' && !flingBack && (flingForward || p > 0.4);
      const remaining = commit ? 1 - p : p;
      this.play(p, commit ? 1 : 0, Math.max(140, TURN_MS * 0.75 * remaining), commit, easeOut);
    }

    tap(clientX) {
      const r = this.viewport.getBoundingClientRect();
      const x = (clientX - r.left) / r.width;
      let dir;
      if (this.cols === 1) dir = x < 0.3 ? -1 : 1;
      else if (this.current === 0) dir = 1;
      else if (this.current === this.max) dir = -1;
      else dir = x < 0.5 ? -1 : 1;
      this.turn(dir);
    }

    onKey(e) {
      if (!this.inView || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target;
      if (t instanceof Element && t.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'ArrowRight') this.turn(1);
      else if (e.key === 'ArrowLeft') this.turn(-1);
      else return;
      e.preventDefault();
    }
  }

  document.querySelectorAll('.flipbook').forEach((el) => new FlipBook(el));
})();
