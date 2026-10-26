// Demo app behaviour: icons, delayed content, and the feature's interactions.
// All state is in the page; reloading resets it.

const ICON_PATHS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 2"/>',
  send: '<path d="M4 12l16-8-6 16-2.5-6.5L4 12z"/>',
  users: '<circle cx="9" cy="9" r="3"/><path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5"/><circle cx="17" cy="8" r="2.5"/><path d="M16 13.6c2.2 0 3.9 1.3 4.5 3.9"/>',
  sparkle: '<path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6-5.6-1.9 5.6-1.9L12 3z" fill="currentColor"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.6v.4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4L18 18M6 18l1.6-1.6M16.4 7.6L18 6"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  message: '<path d="M4.5 5.5h15a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-4.5 3.5v-3.5h-1a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/>',
  smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14a4.5 4.5 0 0 0 7 0M9 9.5v.5M15 9.5v.5"/>',
  inbox: '<path d="M4 13l2.5-7.5h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5z"/><path d="M4 13h4.5l1.5 2.5h4l1.5-2.5H20"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
  play: '<path d="M8 5l11 7-11 7V5z" fill="currentColor"/>',
  star: '<path d="M12 4l2.4 5 5.4.7-4 3.8 1 5.4L12 16.3 7.2 19l1-5.4-4-3.8 5.4-.7L12 4z"/>',
};
const icons = (root = document) =>
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[el.dataset.icon] || ICON_PATHS.info}</svg>`;
  });
icons();

// content arrives after a short "network" delay
const tpl = document.querySelector('template[data-content]');
if (tpl) {
  setTimeout(() => {
    document.querySelector('[data-testid=loading]')?.remove();
    tpl.replaceWith(tpl.content.cloneNode(true));
    icons();
    wire();
  }, 700);
}

function wire() {
  const $ = (s) => document.querySelector(s);

  // conversations: Suggest times
  const menu = $('#schedule-menu');
  $('[data-testid=composer-schedule]')?.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('is-hidden'); });
  document.addEventListener('click', (e) => { if (menu && !menu.contains(e.target)) menu.classList.add('is-hidden'); });
  menu?.querySelector('[data-action=suggest]')?.addEventListener('click', () => {
    menu.classList.add('is-hidden');
    const draft = $('#draft');
    const text = 'Here are a few open times — just reply with a number:';
    draft.textContent = '';
    let i = 0;
    const t = setInterval(() => {
      draft.textContent = text.slice(0, ++i);
      $('#count').textContent = `${i}/160`;
      if (i >= text.length) clearInterval(t);
    }, 22);
    const slots = $('#slots');
    slots.innerHTML = ['1 · Tue 10:00 AM', '2 · Tue 2:30 PM', '3 · Wed 9:00 AM'].map((s) => `<span class="chip"><i data-icon="calendar" class="accent"></i>${s}</span>`).join('');
    icons(slots);
    slots.classList.remove('is-hidden');
  });
  $('[data-testid=composer-send]')?.addEventListener('click', () => {
    const draft = $('#draft');
    if (!draft.textContent.trim()) return;
    const b = document.createElement('div');
    b.className = 'bubble out';
    b.innerHTML = `${draft.textContent}<div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">${$('#slots').innerHTML}</div><span class="meta">now</span>`;
    $('[data-testid=thread]').append(b);
    draft.textContent = '';
    $('#slots').classList.add('is-hidden');
  });

  // settings: round-robin
  $('[data-testid=round-robin]')?.addEventListener('click', (e) => {
    const on = e.currentTarget.classList.toggle('on');
    e.currentTarget.setAttribute('aria-checked', String(on));
    $('#rr-note').classList.toggle('is-hidden', !on);
  });
  document.querySelectorAll('.toggle:not([data-testid])').forEach((t) => t.addEventListener('click', () => t.classList.toggle('on')));

  // meetings: send reminders
  $('[data-testid=send-reminders]')?.addEventListener('click', () => {
    const st = $('[data-status]');
    setTimeout(() => {
      st.className = 'badge success';
      st.textContent = 'Reminded';
      $('#toast').classList.remove('is-hidden');
    }, 500);
  });
}
