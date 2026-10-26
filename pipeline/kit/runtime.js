// Scene runtime: makes a scene seekable.
//
// The renderer calls window.__scene.seek(ms) for every frame it captures. seek
// rebuilds the stage from its initial markup and replays every step up to ms,
// so a frame depends only on its time — never on how long the previous
// screenshot took. That is what makes GIFs reproducible and stills exact.
//
// Steps (spec.animation.steps), each with "at" (ms) and any of:
//   cursor: [x, y] | "<css selector>"   arrive there at "at" (moves for "move" ms, default 650)
//   click: true                          ripple at the cursor, and press "sel" if given
//   addClass / removeClass / toggleClass: "<class>"  on "sel"
//   show / hide: "<css selector>"        toggles the kit's .is-hidden
//   text: "<string>"                     replace the text of "sel"
//   type: "<string>"                     type into "sel" over "dur" ms (default 40ms a character)
//   scroll: <px>                         scroll "sel" to px over "dur" ms

(() => {
  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 2"/>',
    tag: '<path d="M4 12.6V5a1 1 0 0 1 1-1h7.6l7.4 7.4-8.6 8.6L4 12.6z"/><circle cx="8.5" cy="8.5" r="1.3"/>',
    note: '<path d="M14.5 4.5l5 5L9 20H4v-5L14.5 4.5z"/>',
    send: '<path d="M4 12l16-8-6 16-2.5-6.5L4 12z"/>',
    user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c1-3.6 3.8-5.5 7-5.5s6 1.9 7 5.5"/>',
    users: '<circle cx="9" cy="9" r="3"/><path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5"/><circle cx="17" cy="8" r="2.5"/><path d="M16 13.6c2.2 0 3.9 1.3 4.5 3.9"/>',
    'chevron-right': '<path d="M9.5 6l6 6-6 6"/>',
    'chevron-down': '<path d="M6 9.5l6 6 6-6"/>',
    'arrow-left': '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
    sparkle: '<path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6-5.6-1.9 5.6-1.9L12 3z" fill="currentColor"/><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" fill="currentColor"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.6v.4"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    phone: '<path d="M6.5 4h3l1.5 4-2 1.3a10 10 0 0 0 5.7 5.7L16 13l4 1.5v3a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 4.5 6.2 2 2 0 0 1 6.5 4z"/>',
    mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.3 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.3-3.5-8.5s1.1-6.1 3.5-8.5z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4L18 18M6 18l1.6-1.6M16.4 7.6L18 6"/>',
    bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
    star: '<path d="M12 4l2.4 5 5.4.7-4 3.8 1 5.4L12 16.3 7.2 19l1-5.4-4-3.8 5.4-.7L12 4z"/>',
    bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z"/>',
    message: '<path d="M4.5 5.5h15a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-4.5 3.5v-3.5h-1a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    filter: '<path d="M4 5h16l-6 7.5V19l-4-2v-4.5L4 5z"/>',
    more: '<circle cx="6" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18" cy="12" r="1.2" fill="currentColor"/>',
    smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14a4.5 4.5 0 0 0 7 0M9 9.5v.5M15 9.5v.5"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/>',
    inbox: '<path d="M4 13l2.5-7.5h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5z"/><path d="M4 13h4.5l1.5 2.5h4l1.5-2.5H20"/>',
    hash: '<path d="M5 9h14M5 15h14M10 4L8 20M16 4l-2 16"/>',
    trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>',
    edit: '<path d="M14.5 4.5l5 5L9 20H4v-5L14.5 4.5z"/>',
    play: '<path d="M8 5l11 7-11 7V5z" fill="currentColor"/>',
    robot: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13v1M15 13v1M3 13v2M21 13v2"/>',
    shield: '<path d="M12 3.5l7 3v5c0 4.4-3 7.8-7 9-4-1.2-7-4.6-7-9v-5l7-3z"/><path d="M9 12l2 2 4-4"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
    upload: '<path d="M12 16V5M7 9.5l5-5 5 5M5 19.5h14"/>',
  };

  const CURSOR =
    '<svg viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg"><path d="M4 2.5l21 9.6-9.2 2.6L11.6 24 4 2.5z" fill="#111" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';

  const spec = window.__sceneSpec || {};
  const anim = spec.animation || {};
  const steps = (anim.steps || []).slice().sort((a, b) => a.at - b.at);
  const frame = document.getElementById('frame');
  const stage = document.getElementById('stage');
  const initial = stage.innerHTML;

  const svg = (name) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.info}</svg>`;
  const fillIcons = () => stage.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = svg(el.dataset.icon); });

  const cursorEl = document.createElement('div');
  cursorEl.id = 'cursor';
  cursorEl.innerHTML = CURSOR;
  const rippleEl = document.createElement('div');
  rippleEl.id = 'ripple';
  frame.append(rippleEl, cursorEl);

  const each = (sel, fn) => sel && stage.querySelectorAll(sel).forEach(fn);
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

  // Apply one step at progress p (0..1, for steps that take time).
  function apply(s, p) {
    if (s.addClass) each(s.sel, (el) => el.classList.add(...s.addClass.split(/\s+/)));
    if (s.removeClass) each(s.sel, (el) => el.classList.remove(...s.removeClass.split(/\s+/)));
    if (s.toggleClass) each(s.sel, (el) => el.classList.toggle(s.toggleClass));
    if (s.show) each(s.show, (el) => el.classList.remove('is-hidden'));
    if (s.hide) each(s.hide, (el) => el.classList.add('is-hidden'));
    if (s.text !== undefined) each(s.sel, (el) => { el.textContent = s.text; });
    if (s.type !== undefined) {
      const n = Math.round(s.type.length * p);
      each(s.sel, (el) => {
        const base = s.append ? (el.dataset.base ??= el.textContent) : '';
        el.textContent = base + s.type.slice(0, n);
        el.classList.toggle('typing', p < 1);
      });
    }
    // the stage is rebuilt every seek, so scrollTop here is where earlier steps left it
    if (s.scroll !== undefined) each(s.sel, (el) => { const from = el.scrollTop; el.scrollTop = from + (s.scroll - from) * ease(p); });
    if (s.click && s.sel && p < 1) each(s.sel, (el) => el.classList.add('pressed'));
  }

  const duration = (s) => (s.type !== undefined ? s.dur ?? s.type.length * 40 : s.scroll !== undefined ? s.dur ?? 600 : s.click ? 220 : 0);

  function pointOf(target) {
    if (Array.isArray(target)) return { x: target[0], y: target[1] };
    const el = stage.querySelector(target);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return null; // hidden at this moment: keep the cursor where it was
    const f = frame.getBoundingClientRect();
    // aim a little left of centre, where a hand would click a label
    return { x: r.left - f.left + Math.min(r.width / 2, 40), y: r.top - f.top + r.height / 2 };
  }

  function seek(t) {
    stage.innerHTML = initial;
    fillIcons();
    for (const s of steps) {
      if (s.at > t) break;
      const d = duration(s);
      apply(s, d ? clamp01((t - s.at) / d) : 1);
    }

    // cursor: keyframes resolved against the stage as it is at time t
    const show = spec.cursor !== false && steps.some((s) => s.cursor);
    cursorEl.style.display = show ? 'block' : 'none';
    rippleEl.style.display = 'none';
    if (!show) return;
    const start = (spec.cursorStart && pointOf(spec.cursorStart)) || { x: frame.clientWidth * 0.85, y: frame.clientHeight * 1.05 };
    let prev = { at: 0, p: start };
    let pos = start;
    for (const s of steps.filter((s) => s.cursor)) {
      const p = pointOf(s.cursor) || prev.p;
      const move = s.move ?? 650;
      const from = Math.max(prev.at, s.at - move);
      if (t >= s.at) pos = p;
      else if (t > from) {
        const k = ease((t - from) / (s.at - from));
        pos = { x: prev.p.x + (p.x - prev.p.x) * k, y: prev.p.y + (p.y - prev.p.y) * k };
        break;
      } else break;
      prev = { at: s.at, p };
    }
    cursorEl.style.transform = `translate(${pos.x - 4}px, ${pos.y - 2}px)`;

    const click = steps.filter((s) => s.click && s.at <= t && t < s.at + 450).pop();
    if (click) {
      const k = (t - click.at) / 450;
      const r = 6 + 18 * k;
      Object.assign(rippleEl.style, {
        display: 'block', left: `${pos.x - r}px`, top: `${pos.y - r}px`, width: `${2 * r}px`, height: `${2 * r}px`, opacity: String(1 - k),
      });
      cursorEl.style.transform += ` scale(${k < 0.4 ? 0.88 : 1})`;
    }
  }

  window.__scene = { seek, duration: anim.duration || 0, stillAt: spec.stillAt ?? anim.duration ?? 0 };
  seek(window.__scene.stillAt);
})();
