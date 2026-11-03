// Çınar Tattoo, the public page's script. The server wrote every element; this file moves them
// (anime.js) and wires the buttons. It creates no element but the map's iframe, writes no markup
// and sets styles only through CSSOM or anime. Each part checks for its elements and skips quietly
// when they are not on the page.
import { animate, createTimeline, stagger } from '/assets/vendor/anime.esm.min.js';

const root = document.documentElement;
// The CSS start states give way to `kurtar` about 4 s after the page opens. A script that only starts
// after 3.5 s (slow mobile data) plays no entrance: it would hide a page the visitor already sees and
// replay the intro over it. html.m (anime owns the start states) is set only at the motion block.
const late = performance.now() > 3500;

const GREETING = 'Merhaba Onur Bey, siteden yazıyorum.';
const motionOK = matchMedia('(prefers-reduced-motion: no-preference)').matches;
const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const pad = (n) => String(n).padStart(2, '0');
const OPEN = 'inset(0% 0% 0% 0%)';
const SHUT_B = 'inset(100% 0% 0% 0%)';
const SHUT_T = 'inset(0% 0% 100% 0%)';

// The WhatsApp number comes from the page (<html data-wa>), never from this file.
const waNumber = root.dataset.wa;
const wa = (message) => (waNumber ? `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}` : null);

const store = (kind) => {
  try {
    return window[kind];
  } catch {
    return null;
  }
};
const read = (kind, key) => {
  try {
    return store(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
};
const write = (kind, key, value) => {
  try {
    store(kind)?.setItem(key, value);
  } catch {
    /* private mode or a full store: nothing to keep */
  }
};

// Runs fn once, when el first comes into view.
const once = (el, fn, threshold = 0.2, rootMargin = '0px') => {
  const io = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        io.disconnect();
        fn();
      }
    },
    { threshold, rootMargin },
  );
  io.observe(el);
};
// A curtain that opens from the bottom, with the picture inside settling from a zoom.
const wipe = (el, delay = 0, duration = 1300) => {
  const media = $('img,video', el);
  animate(el, { clipPath: [SHUT_B, OPEN], duration, delay, ease: 'inOutQuart' });
  if (media) animate(media, { scale: [1.3, 1], duration: duration + 500, delay, ease: 'outQuart' });
};

/* ---------------- clicks: a beacon per booking action ---------------- */
document.addEventListener(
  'click',
  (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-track]') : null;
    if (!target) return;
    try {
      navigator.sendBeacon('/api/track', JSON.stringify({ kind: target.dataset.track }));
    } catch {
      /* counting must never get in the way */
    }
  },
  true,
);

/* ---------------- announcement ---------------- */
const notice = $('.duyuru');
if (notice) {
  const message = $('p', notice)?.textContent ?? '';
  const close = () => {
    notice.remove();
    document.body.classList.remove('has-duyuru');
  };
  if (read('localStorage', 'cinar-duyuru') === message) close();
  else
    $('.duyuru-kapat', notice)?.addEventListener('click', () => {
      write('localStorage', 'cinar-duyuru', message);
      close();
    });
}

/* ---------------- bar, dock, the section in view ---------------- */
const bar = $('#bar');
const dock = $('#dock');
const onScroll = () => {
  bar?.classList.toggle('solid', scrollY > 30);
  dock?.classList.toggle('on', scrollY > innerHeight * 0.8);
};
addEventListener('scroll', onScroll, { passive: true });
onScroll();
const menuLinks = $$('.menu a');
if (menuLinks.length > 0) {
  const sio = new IntersectionObserver(
    (entries) =>
      entries.forEach((entry) => {
        if (entry.isIntersecting) menuLinks.forEach((a) => a.setAttribute('aria-current', String(a.hash === `#${entry.target.id}`)));
      }),
    { rootMargin: '-45% 0px -50% 0px' },
  );
  menuLinks.forEach((a) => {
    const target = document.getElementById(a.hash.slice(1));
    if (target) sio.observe(target);
  });
}

/* ---------------- the menu sheet on phones ---------------- */
const sheet = $('#sheet');
const menuButton = $('#menuBtn');
if (sheet && menuButton) {
  const setSheet = (open) => {
    sheet.classList.toggle('open', open);
    menuButton.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('is-locked', open);
    if (open) {
      if (motionOK) animate($$(':scope > a', sheet), { opacity: [0, 1], y: [30, 0], duration: 700, delay: stagger(50), ease: 'outExpo' });
      $('a', sheet)?.focus();
    } else menuButton.focus();
  };
  menuButton.addEventListener('click', () => setSheet(true));
  $('#sheetClose')?.addEventListener('click', () => setSheet(false));
  sheet.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('a[href^="#"]')) setSheet(false);
  });
  sheet.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setSheet(false);
  });
}

/* ---------------- the strip moves sideways with the scroll ---------------- */
const strip = $('#strip');
const track = $('#stripTrack');
if (strip && track && motionOK) {
  strip.classList.add('drive');
  const moveStrip = () => {
    const box = strip.getBoundingClientRect();
    const max = track.scrollWidth - strip.clientWidth;
    const progress = Math.min(1, Math.max(0, (innerHeight - box.top) / (innerHeight + box.height)));
    track.style.transform = `translateX(${-progress * max}px)`;
  };
  addEventListener('scroll', () => requestAnimationFrame(moveStrip), { passive: true });
  addEventListener('resize', moveStrip);
  moveStrip();
}

/* ---------------- the banner's wall drifts against the scroll ---------------- */
const wall = $('#wall');
if (wall && motionOK) {
  const banner = wall.parentElement;
  const drift = () => {
    const box = banner.getBoundingClientRect();
    if (box.bottom < 0 || box.top > innerHeight) return;
    wall.style.transform = `translateY(${((innerHeight - box.top) / (innerHeight + box.height) - 0.5) * -14}%)`;
  };
  addEventListener('scroll', () => requestAnimationFrame(drift), { passive: true });
  drift();
}

/* ---------------- works: tabs, more, the viewer ---------------- */
const worksEl = $('#works');
const cards = worksEl ? $$('.work', worksEl) : [];
const PAGE = 24;
let shownCount = PAGE;
let filter = 'all';
let visible = cards.filter((card) => !card.hidden); // the cards the viewer steps through, in order
const moreButton = $('#daha');
const applyFilter = (animateIn) => {
  const matching = cards.filter((card) => filter === 'all' || card.dataset.style === filter);
  const fresh = [];
  for (const card of cards) {
    const rank = matching.indexOf(card);
    const show = rank !== -1 && rank < shownCount;
    if (show && card.hidden) fresh.push(card);
    card.hidden = !show;
  }
  visible = cards.filter((card) => !card.hidden);
  if (moreButton) moreButton.hidden = matching.length <= shownCount;
  if (animateIn && motionOK)
    (animateIn === 'all' ? visible : fresh).forEach((card, index) => {
      const button = $('button', card);
      button.style.clipPath = SHUT_B;
      wipe(button, index * 45, 900);
    });
};
const tabs = $('#tabs');
if (tabs) {
  tabs.addEventListener('click', (event) => {
    const tab = event.target instanceof Element ? event.target.closest('[data-f]') : null;
    if (!tab) return;
    $$('.tab', tabs).forEach((other) => other.setAttribute('aria-pressed', String(other === tab)));
    filter = tab.dataset.f;
    shownCount = PAGE;
    applyFilter('all');
  });
}
moreButton?.addEventListener('click', () => {
  shownCount += PAGE;
  applyFilter('fresh');
});

const lb = $('#lb');
const lbImg = $('#lbImg');
const lbCap = $('#lbCap');
const lbWa = $('#lbWa');
let current = 0;
const KIND = { dovme: 'dövme', piercing: 'piercing' };
const showCard = (index) => {
  current = (index + visible.length) % visible.length;
  const card = visible[current];
  const img = $('img', card);
  const caption = $('figcaption b', card)?.textContent.trim() ?? '';
  const no = card.dataset.no;
  lbImg.src = img.dataset.full || img.src;
  lbImg.alt = img.alt;
  lbCap.textContent = `No. ${pad(no)}${caption ? ` · ${caption}` : ''} · ${current + 1} / ${visible.length}`;
  if (lbWa) {
    const about = caption ? ` (${caption})` : '';
    const href = wa(`${GREETING} Sitedeki ${no} numaralı işe${about} benzer bir ${KIND[card.dataset.style] ?? 'iş'} istiyorum. ${location.origin}/#${card.id}`);
    if (href) lbWa.href = href;
  }
  if (motionOK) animate(lbImg, { opacity: [0, 1], scale: [0.97, 1], duration: 450, ease: 'outExpo' });
};
const openCard = (card) => {
  if (!lb || !lbImg || !lbCap) return;
  if (card.hidden) visible = [card, ...visible.filter((other) => other !== card)];
  showCard(visible.indexOf(card));
  if (!lb.open) lb.showModal();
};
if (worksEl && lb) {
  worksEl.addEventListener('click', (event) => {
    const card = event.target instanceof Element ? event.target.closest('.work') : null;
    if (card) openCard(card);
  });
  $('#lbPrev')?.addEventListener('click', () => showCard(current - 1));
  $('#lbNext')?.addEventListener('click', () => showCard(current + 1));
  $('#lbClose')?.addEventListener('click', () => lb.close());
  lb.addEventListener('click', (event) => {
    if (event.target === lb || (event.target instanceof Element && event.target.classList.contains('lb-in'))) lb.close();
  });
  lb.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') showCard(current - 1);
    if (event.key === 'ArrowRight') showCard(current + 1);
  });
  lb.addEventListener('close', () => {
    visible = cards.filter((card) => !card.hidden);
  });
  // A link to one work (/#is-<id>) opens it.
  const openFromHash = () => {
    const match = /^#is-(seed-[a-z0-9]+(?:-[a-z0-9]+)*|[0-9a-f]{20})$/.exec(location.hash);
    const card = match ? document.getElementById(`is-${match[1]}`) : null;
    if (card && cards.includes(card)) openCard(card);
  };
  addEventListener('hashchange', openFromHash);
  openFromHash();
}

/* ---------------- reels play while they are in view ---------------- */
const videos = $$('.clip video');
if (motionOK) {
  const vio = new IntersectionObserver(
    (entries) =>
      entries.forEach((entry) => {
        const video = entry.target;
        if (entry.isIntersecting) {
          video.preload = 'auto';
          video.play().catch(() => {});
        } else video.pause();
      }),
    { threshold: 0.35 },
  );
  videos.forEach((video) => {
    video.controls = false;
    vio.observe(video);
  });
}

/* ---------------- process: the step in view drives the sticky picture ---------------- */
const steps = $$('.pstep');
const procImgs = $$('#procStack img');
if (steps.length > 0) {
  const procNo = $('#procNo');
  const procName = $('#procName');
  let active = -1;
  const setStep = (index) => {
    if (index === active) return;
    const previous = active;
    active = index;
    steps.forEach((step, k) => step.classList.toggle('on', k === index));
    if (procNo) procNo.textContent = `${pad(index + 1)} / ${pad(steps.length)}`;
    if (procName) procName.textContent = $('h3', steps[index])?.textContent ?? '';
    if (procImgs.length === 0) return;
    procImgs.forEach((im, k) => {
      im.style.zIndex = k === index ? '3' : k === previous ? '2' : '1';
    });
    const im = procImgs[index];
    if (!im) return;
    if (!motionOK || previous < 0) {
      procImgs.forEach((other, k) => {
        other.style.clipPath = k <= index ? OPEN : SHUT_B;
      });
      return;
    }
    animate(im, { clipPath: [index > previous ? SHUT_B : SHUT_T, OPEN], duration: 1000, ease: 'inOutQuart' });
    animate(im, { scale: [1.2, 1], duration: 1400, ease: 'outQuart' });
  };
  const pio = new IntersectionObserver(
    (entries) =>
      entries.forEach((entry) => {
        if (entry.isIntersecting) setStep(steps.indexOf(entry.target));
      }),
    { rootMargin: '-48% 0px -48% 0px' },
  );
  steps.forEach((step) => pio.observe(step));
  setStep(0);
}

/* ---------------- reviews: one at a time ---------------- */
const quotes = $('#quotes');
const quoteItems = quotes ? $$('.q', quotes) : [];
if (quotes && quoteItems.length > 1) {
  const count = $('#qCount');
  const progress = $('#qProg');
  const body = $('.quote-body');
  const quote = $('#quote');
  let q = 0;
  let timer = null;
  let paused = false;
  const put = (index) => {
    q = (index + quoteItems.length) % quoteItems.length;
    quoteItems.forEach((item, k) => {
      item.hidden = k !== q;
    });
    if (count) count.textContent = `${pad(q + 1)} / ${pad(quoteItems.length)}`;
  };
  const tick = () => {
    clearTimeout(timer);
    if (paused || !motionOK) return;
    if (progress) animate(progress, { scaleX: [0, 1], duration: 8000, ease: 'linear' });
    timer = setTimeout(() => go(1), 8000);
  };
  const go = (step) => {
    const next = q + step;
    if (!motionOK || !body) {
      put(next);
      return;
    }
    animate(body, {
      opacity: [1, 0],
      y: [0, -14],
      duration: 350,
      ease: 'inQuad',
      onComplete: () => {
        put(next);
        animate(body, { opacity: [0, 1], y: [18, 0], filter: ['blur(8px)', 'blur(0px)'], duration: 900, ease: 'outExpo' });
      },
    });
    tick();
  };
  quotes.classList.add('go');
  put(0);
  $('#qPrev')?.addEventListener('click', () => go(-1));
  $('#qNext')?.addEventListener('click', () => go(1));
  if (quote) {
    const pause = () => {
      paused = true;
      clearTimeout(timer);
    };
    const resume = () => {
      paused = false;
      tick();
    };
    quote.addEventListener('pointerenter', pause);
    quote.addEventListener('pointerleave', resume);
    quote.addEventListener('focusin', pause);
    quote.addEventListener('focusout', resume);
    once(quote, tick, 0.3);
  }
}

/* ---------------- the map loads when asked ---------------- */
const mapButton = $('.map button[data-src]');
mapButton?.addEventListener('click', () => {
  const frame = document.createElement('iframe');
  frame.title = 'Çınar Tattoo haritada';
  frame.loading = 'lazy';
  frame.referrerPolicy = 'no-referrer-when-downgrade';
  frame.src = mapButton.dataset.src;
  mapButton.parentElement.replaceChildren(frame);
});

/* ---------------- the booking form opens WhatsApp with the message written ---------------- */
const form = $('#bookForm');
if (form) {
  const field = (name) => form.elements.namedItem(name);
  const value = (name) => {
    const element = field(name);
    return element && 'value' in element ? String(element.value).trim() : '';
  };
  const error = $('#formErr');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = value('name');
    const idea = value('idea');
    field('name')?.setAttribute('aria-invalid', String(!name));
    field('idea')?.setAttribute('aria-invalid', String(!idea));
    const missing = [];
    if (!name) missing.push('adını');
    if (!idea) missing.push('fikrini');
    if (missing.length > 0) {
      if (error) {
        error.textContent = `Mesajı hazırlamak için ${missing.join(' ve ')} yaz.`;
        error.hidden = false;
      }
      (name ? field('idea') : field('name'))?.focus();
      return;
    }
    if (error) error.hidden = true;
    const kind = value('kind');
    const message = [
      GREETING,
      `Ben ${name}.`,
      kind && `${kind} için yazıyorum.`,
      `Fikrim: ${idea}`,
      value('place') && `Bölge: ${value('place')}`,
      value('size') && `Boyut: ${value('size')}`,
      value('when') && `Zaman: ${value('when')}`,
      'Uygun bir randevu konuşabilir miyiz?',
    ]
      .filter(Boolean)
      .join('\n');
    const href = wa(message);
    if (href) window.open(href, '_blank', 'noopener');
  });
  // Only now does the page swap its plain WhatsApp link for the form (site.css): a script that did
  // not load or run leaves the link, never a form that cannot send.
  root.classList.add('form-on');
}

/* ---------------- motion: the intro, then everything rises as it arrives ---------------- */
// html.m is set only here, so an error anywhere above leaves `kurtar` to show the page at 4 s instead
// of an intro that never ends. Late (see `late`) or after an error here, html.still shows the page at
// once, as `kurtar` would.
const intro = $('#intro');
let introSeen = read('sessionStorage', 'cinar-intro') === '1';
if (location.hash === '#intro') introSeen = false;

function heroIn() {
  if (heroIn.done) return;
  heroIn.done = true;
  createTimeline({ defaults: { ease: 'outExpo' } })
    .add('.bar', { opacity: [0, 1], duration: 900 }, 0)
    .add('.hero h1 .ln > span', { y: ['105%', '0%'], duration: 1400, delay: stagger(110) }, 0)
    .add('.hero-sub', { opacity: [0, 1], y: [18, 0], duration: 1000 }, 450)
    .add('.hero-act', { opacity: [0, 1], y: [18, 0], duration: 1000 }, 600)
    .add('.facts .fact', { opacity: [0, 1], y: [20, 0], duration: 1000, delay: stagger(90) }, 750);
  animate('#heroLogo', { opacity: [0, 1], scale: [1.08, 1], duration: 2000, ease: 'outExpo' });
  animate('.hero-copy .lbl', { opacity: [0, 1], duration: 900, delay: 200, ease: 'outQuad' });
  // the services slide in from the left edge, the address from the right one
  const left = $('.hi-what');
  const right = $('.hi-where');
  if (left) {
    animate(left, { opacity: [0, 1], x: ['-45vw', '0vw'], duration: 1700, delay: 450, ease: 'outExpo' });
    animate(left.querySelectorAll('li'), { x: ['-12vw', '0vw'], duration: 1500, delay: stagger(110, { start: 550 }), ease: 'outExpo' });
  }
  if (right) {
    animate(right, { opacity: [0, 1], x: ['45vw', '0vw'], duration: 1700, delay: 600, ease: 'outExpo' });
    animate(right.querySelectorAll('.hi-place > *'), { x: ['12vw', '0vw'], duration: 1500, delay: stagger(110, { start: 700 }), ease: 'outExpo' });
  }
}

function playIntro() {
  const year = $('#introYear');
  const to = Number(year?.dataset.to) || new Date().getFullYear();
  const counter = { v: 2005 };
  document.body.classList.add('is-locked');
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    intro.remove();
    document.body.classList.remove('is-locked');
    write('sessionStorage', 'cinar-intro', '1');
    heroIn();
  };
  const timeline = createTimeline({ defaults: { ease: 'outExpo' }, onComplete: done })
    .add('#introLine', { scaleX: [0, 1], duration: 900, ease: 'inOutQuart' }, 0)
    .add('#introName .ch', { y: ['105%', '0%'], duration: 1100, delay: stagger(60) }, 500)
    .add('#introYear', { opacity: [0, 1], duration: 500 }, 700)
    .add(counter, { v: [2005, to], duration: 1500, ease: 'inOutQuad', onUpdate: () => year && (year.textContent = String(Math.round(counter.v))) }, 700)
    .add(['#introName', '#introYear', '#introSkip'], { opacity: [1, 0], duration: 450, ease: 'inQuad' }, 2350)
    .add('#introLine', { scaleX: [1, 0], duration: 600, ease: 'inOutQuart', transformOrigin: 'right' }, 2350)
    .add('.intro-half.t', { y: ['0%', '-101%'], duration: 1000, ease: 'inOutQuart', onBegin: heroIn }, 2700)
    .add('.intro-half.b', { y: ['0%', '101%'], duration: 1000, ease: 'inOutQuart' }, 2700);
  // the service names flash past under the line, one every 360 ms; the last one stays until the fade
  const names = [...document.querySelectorAll('#introSvc span')];
  names.forEach((name, index) => {
    const at = 900 + index * 360;
    timeline.add(name, { opacity: [0, 1], y: ['100%', '0%'], duration: 280, ease: 'outQuart' }, at);
    if (index < names.length - 1) timeline.add(name, { opacity: [1, 0], y: ['0%', '-100%'], duration: 220, ease: 'inQuad' }, at + 300);
    else timeline.add(name, { opacity: [1, 0], duration: 450, ease: 'inQuad' }, 2350);
  });
  $('#introSkip')?.addEventListener('click', () => {
    timeline.pause();
    heroIn();
    animate(intro, { opacity: 0, duration: 250, ease: 'linear', onComplete: done });
  });
  setTimeout(done, 6000); // whatever happens to the timeline, the page opens
}

function entrance() {
  if (intro && !introSeen) playIntro();
  else {
    intro?.remove();
    heroIn();
  }
  // section headings rise letter by letter, their numbers count up
  $$('.sec-head h2').forEach((heading) => {
    const letters = $$('.ch', heading);
    if (letters.length > 0) once(heading, () => animate(letters, { y: ['110%', '0%'], duration: 1100, delay: stagger(22), ease: 'outExpo' }), 0.4);
  });
  $$('.sec-no').forEach((number) => {
    const to = Number(number.textContent);
    const counter = { v: 0 };
    number.textContent = '00';
    once(number, () => animate(counter, { v: [0, to], duration: 900, ease: 'outQuad', onUpdate: () => (number.textContent = pad(Math.round(counter.v))) }), 0.5);
  });
  // works and reels open like curtains as they arrive
  cards.forEach((card, index) => once(card, () => wipe($('button', card), (index % 4) * 90), 0.1, '0px 0px -8% 0px'));
  $$('.clip').forEach((clip, index) => {
    const vid = $('.vid', clip);
    if (vid) once(clip, () => wipe(vid, (index % 2) * 140, 1400), 0.15);
  });
  // the artist's photo, watched through its figure: the frame itself is clipped shut
  const artist = $('.artist-ph');
  const frame = artist && $('.artist-frame', artist);
  if (frame) once(artist, () => wipe(frame, 0, 1500), 0.2);
  // blocks rise; their list items follow
  $$('[data-rise]').forEach((el) => {
    once(
      el,
      () => {
        const siblings = [...el.parentElement.children].filter((child) => child.hasAttribute('data-rise'));
        const order = siblings.indexOf(el);
        animate(el, { opacity: [0, 1], y: [40, 0], delay: order * 120, duration: 1100, ease: 'outExpo' });
        const items = $$('li', el);
        if (items.length > 0) animate(items, { opacity: [0, 1], x: [-12, 0], delay: stagger(80, { start: 250 + order * 120 }), duration: 800, ease: 'outExpo' });
      },
      0.2,
    );
  });
  // The name is watched through the footer: an element clipped shut never counts as in view.
  const big = $('.foot-big');
  if (big) {
    // Unclipped at the end: the cedilla of Ç hangs below the line box.
    const reveal = () => animate(big, { clipPath: [SHUT_B, OPEN], y: ['40%', '0%'], duration: 1400, ease: 'outExpo', onComplete: () => (big.style.clipPath = 'none') });
    once(big.parentElement, reveal, 0.2);
  }
}

const showAll = () => {
  intro?.remove();
  document.body.classList.remove('is-locked');
  root.classList.remove('m');
  root.classList.add('still');
};
if (motionOK && !late) {
  root.classList.add('m');
  try {
    entrance();
  } catch (error) {
    showAll(); // never leave the page covered or hidden
    throw error;
  }
} else showAll();

if (motionOK) {
  $$('.faq details').forEach((details) =>
    details.addEventListener('toggle', () => {
      const answer = $('.ans', details);
      if (details.open && answer) animate(answer, { opacity: [0, 1], y: [-8, 0], duration: 500, ease: 'outExpo' });
    }),
  );
}
