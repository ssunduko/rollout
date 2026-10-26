#!/usr/bin/env node
// A stand-in application for the example rollout: a small web app with a real
// login form, a session cookie and a few pages that implement the example
// feature (input/smart-scheduling). Captures log into it exactly as they would
// log into a production app, so the whole pipeline can be tried end to end
// without access to one.
//
//   node demo-app/server.mjs                 (DEMO_APP_PORT, default 4173)
//
// Credentials: DEMO_APP_USERNAME / DEMO_APP_PASSWORD from .env. No
// dependencies; state lives in the browser only, so nothing a capture does
// here persists.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { env, KIT_DIR, ROOT } from '../pipeline/env.mjs';
import { loadBrand, brandCss } from '../pipeline/brand.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(env('DEMO_APP_PORT', 4173));
const USER = env('DEMO_APP_USERNAME', 'demo@acme.example');
const PASS = env('DEMO_APP_PASSWORD', 'demo-password');
const brand = loadBrand(path.join(ROOT, 'brand', 'example'));
const sessions = new Set();

const CSS = `${brandCss(brand, { fontUrl: (p) => `/fonts/${path.basename(p)}` })}
${fs.readFileSync(path.join(KIT_DIR, 'kit.css'), 'utf8')}
${fs.readFileSync(path.join(HERE, 'app.css'), 'utf8')}`;

const page = (title, body, { shell = true, active = '' } = {}) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · ${brand.name}</title>
<link rel="stylesheet" href="/app.css"></head>
<body><div id="stage" class="app${shell ? '' : ' bare'}">
${shell ? `<aside class="sidebar">
  <div class="brand">${brand.logo.icon}</div>
  <nav>
    ${[['conversations', 'message', 'Conversations'], ['meetings', 'calendar', 'Meetings'], ['settings/scheduling', 'settings', 'Settings']]
      .map(([href, icon, label]) => `<a href="/${href}" aria-label="Nav ${label}" class="${active === href.split('/')[0] ? 'on' : ''}"><i data-icon="${icon}"></i><span>${label}</span></a>`).join('')}
  </nav>
  <div class="spacer"></div>
  <a href="/logout" class="avatar sm" data-testid="user-menu" aria-label="Account" style="--c:#0ea5e9">JL</a>
</aside>` : ''}
<main class="main">
${shell ? `<div class="banner" data-testid="system-banner"><i data-icon="bell"></i>Desktop notifications are off. <a href="#" class="link">Turn on</a></div>` : ''}
${body}
</main></div>
<script src="/app.js"></script></body></html>`;

const settingsTabs = (on) => `<div class="tabs page-tabs">
  <a class="tab ${on === 'scheduling' ? 'on' : ''}" href="/settings/scheduling">Scheduling</a>
  <a class="tab ${on === 'booking-rules' ? 'on' : ''}" href="/settings/booking-rules">Booking rules</a>
</div>`;

// Content arrives a moment after the page, behind a spinner, like a real SPA.
const loads = (html) => `<div class="loading" data-testid="loading"><div class="spinner"></div></div><template data-content>${html}</template>`;

const ROUTES = {
  '/conversations': () => page('Conversations', `
<div class="split">
  <section class="inbox-list">
    <div class="field"><i data-icon="search"></i><span class="placeholder">Search conversations</span></div>
    ${[['MR', '#8b5cf6', 'Maria Rossi', 'Can we find a time to walk through pricing?', true], ['AK', '#10b981', 'Ana Kim', 'Thanks, see you Wednesday!'], ['SP', '#f97316', 'Sam Patel', 'Got it 👍'], ['LC', '#0ea5e9', 'Lee Chen', 'Is the 4pm slot still open?']]
      .map(([i, c, n, m, on]) => `<div class="list-item ${on ? 'on' : ''}"><div class="avatar" style="--c:${c}">${i}</div><div class="grow"><div class="strong" data-pii>${n}</div><div class="small muted ellipsis">${m}</div></div></div>`).join('')}
  </section>
  <section class="conversation" data-testid="conversation">
    <header class="row conv-head"><div class="avatar sm" style="--c:#8b5cf6">MR</div><div class="grow"><div class="strong" data-pii>Maria Rossi</div><div class="small muted" data-pii>+1 (555) 014-2290</div></div><span class="chip"><i data-icon="message"></i>SMS</span></header>
    ${loads(`<div class="thread" data-testid="thread">
      <div class="bubble in">Hi! I saw the pricing page. Could we go through the plans together?<span class="meta">11:48 am</span></div>
      <div class="bubble out">Absolutely — happy to walk you through it.<span class="meta">11:49 am</span></div>
      <div class="bubble in">Can we find a time to walk through pricing?<span class="meta">11:51 am</span></div>
    </div>
    <div class="composer" data-testid="composer">
      <div id="draft" class="text" contenteditable="true" data-testid="composer-input" aria-label="Message"></div>
      <div id="slots" class="row is-hidden" style="flex-wrap:wrap;gap:6px"></div>
      <div class="row tools">
        <button class="icon-btn" aria-label="Attach"><i data-icon="plus"></i></button>
        <button class="icon-btn" aria-label="Emoji"><i data-icon="smile"></i></button>
        <button class="icon-btn accent" aria-label="Scheduling" data-testid="composer-schedule"><i data-icon="calendar"></i></button>
        <span class="grow"></span><span class="small muted" id="count">0/160</span>
        <button class="btn primary" data-testid="composer-send" aria-label="Send"><i data-icon="send"></i></button>
      </div>
      <div id="schedule-menu" class="menu is-hidden" role="menu" data-testid="schedule-menu">
        <div class="menu-head">Scheduling</div>
        <div class="menu-item" role="menuitem" data-action="suggest"><i data-icon="sparkle"></i>Suggest times</div>
        <div class="menu-item" role="menuitem"><i data-icon="link"></i>Share booking page</div>
        <div class="menu-item" role="menuitem"><i data-icon="clock"></i>Propose a specific time</div>
      </div>
    </div>`)}
  </section>
</div>`, { active: 'conversations' }),

  '/meetings': () => page('Meetings', `
<header class="page-head"><h1 class="h1">Meetings</h1><div class="muted">Booked from conversations, confirmed and reminded automatically.</div></header>
${loads(`<section class="window meetings" data-testid="meetings">
  <div class="row between" style="margin-bottom:12px"><div class="title">Upcoming meetings</div><button class="btn soft" data-testid="send-reminders"><i data-icon="bell"></i>Send due reminders</button></div>
  <div class="stack" style="gap:4px">
    ${[['calendar', 'Demo', 'Jordan Lee', 'Tue 2:30 PM · 30 min', '<span class="badge new" data-status>Booked</span>'], ['calendar', 'Onboarding', 'Ana Kim', 'Wed 11:00 AM · 45 min', '<span class="badge new">Booked</span>'], ['refresh', 'Demo', 'Sam Patel', 'Thu 9:00 AM · 30 min', '<span class="badge">Rescheduled</span>'], ['calendar', 'Consultation', 'Lee Chen', 'Mon 4:00 PM · 30 min', '<span class="badge danger">No-show</span>']]
      .map(([ic, type, who, when, st], i) => `<div class="list-item${i === 0 ? ' on' : ''}" ${i === 0 ? 'data-testid="meeting-first"' : ''}><i data-icon="${ic}" class="accent"></i><div class="grow"><div class="strong">${type} · <span data-pii>${who}</span></div><div class="small muted">${when}</div></div>${st}</div>`).join('')}
  </div>
  <div id="toast" class="toast is-hidden" data-testid="toast"><i data-icon="bell"></i><span>Reminder sent to <span data-pii>Jordan</span>: “See you tomorrow at 2:30 PM! Reply 1 to confirm.”</span></div>
</section>`)}`, { active: 'meetings' }),

  '/settings/scheduling': () => page('Scheduling', `
<header class="page-head"><h1 class="h1">Settings</h1></header>
${settingsTabs('scheduling')}
${loads(`<section class="window settings-card" data-testid="scheduling-card">
  <div class="row between"><div class="title">Scheduling</div><span class="badge success">2 calendars connected</span></div>
  <div class="subtitle" style="margin:2px 0 16px">Connect calendars so customers only see times your team is free.</div>
  <div class="stack" style="gap:8px">
    <div class="row panel line"><div class="avatar sm" style="--c:#0ea5e9">JL</div><div class="grow"><div class="strong" data-pii>Jordan Lee</div><div class="small muted">Google Calendar</div></div><span class="badge success">Connected</span></div>
    <div class="row panel line"><div class="avatar sm" style="--c:#8b5cf6">MR</div><div class="grow"><div class="strong" data-pii>Maria Rossi</div><div class="small muted">Microsoft Outlook</div></div><span class="badge success">Connected</span></div>
  </div>
  <div class="row" style="gap:12px;margin-top:16px">
    <label class="col grow"><span class="label">Working hours</span><div class="field select">Mon – Fri · 9:00 AM – 5:00 PM</div></label>
    <label class="col" style="width:150px"><span class="label">Meeting length</span><div class="field select">30 min</div></label>
  </div>
  <div class="row panel" style="margin-top:16px"><i data-icon="users" class="accent"></i><div class="grow"><div class="strong">Round-robin assignment</div><div class="small muted">Give each booking to the next available rep</div></div><button class="toggle" role="switch" aria-checked="false" aria-label="Round-robin assignment" data-testid="round-robin"></button></div>
  <div id="rr-note" class="callout is-hidden" style="margin-top:10px"><i data-icon="info"></i>New bookings now rotate between 2 reps.</div>
</section>`)}`, { active: 'settings' }),

  '/settings/booking-rules': () => page('Booking rules', `
<header class="page-head"><h1 class="h1">Settings</h1></header>
${settingsTabs('booking-rules')}
${loads(`<section class="window settings-card" data-testid="booking-rules-card">
  <div class="row between"><div class="title">Booking rules</div><div class="field select" style="min-height:32px;padding:5px 10px;width:210px"><i data-icon="inbox" class="accent"></i>West Coast Sales</div></div>
  <div class="label" style="margin:16px 0 8px">Meeting types</div>
  <div class="stack" style="gap:8px">
    ${[['info', 'play', 'Demo', '30 min', true], ['success', 'check', 'Onboarding', '45 min', true], ['warning', 'star', 'Quarterly review', '60 min', false]]
      .map(([st, ic, n, d, on]) => `<div class="row panel line"><span class="status ${st}"><i data-icon="${ic}"></i></span><div class="grow strong">${n}</div><span class="chip">${d}</span><button class="toggle${on ? ' on' : ''}" role="switch" aria-label="${n}"></button></div>`).join('')}
  </div>
  <div class="label" style="margin:16px 0 8px">Ask before booking</div>
  <input class="field input" data-testid="booking-question" placeholder="Add a question…" aria-label="Question to ask before booking">
  <button class="btn soft block" style="margin-top:10px" data-testid="add-question"><i data-icon="plus"></i>Add question</button>
</section>`)}`, { active: 'settings' }),
};

const loginPage = (next, error) => page('Log in', `
<form class="login window" method="post" action="/login">
  <div class="brand-row">${brand.logo.primary}</div>
  <h1 class="h1">Welcome back</h1>
  <div class="muted" style="margin-bottom:18px">Log in to your workspace</div>
  ${error ? '<div class="callout warn" style="margin-bottom:12px"><i data-icon="info"></i>Wrong email or password</div>' : ''}
  <input type="hidden" name="next" value="${next.replace(/"/g, '')}">
  <label class="col"><span class="label">Email</span><input class="field input" type="email" name="email" autocomplete="username" required></label>
  <label class="col" style="margin-top:12px"><span class="label">Password</span><input class="field input" type="password" name="password" autocomplete="current-password" required></label>
  <button class="btn primary block" type="submit" style="margin-top:18px">Log in</button>
</form>`, { shell: false });

const cookieSession = (req) => /(?:^|;\s*)sid=([a-f0-9]+)/.exec(req.headers.cookie ?? '')?.[1];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const send = (status, body, type = 'text/html; charset=utf-8', headers = {}) => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers }); res.end(body); };

  if (url.pathname === '/app.css') return send(200, CSS, 'text/css');
  if (url.pathname === '/app.js') return send(200, fs.readFileSync(path.join(HERE, 'app.js')), 'text/javascript');
  if (url.pathname.startsWith('/fonts/')) {
    const file = brand.fonts.body.faces.concat(brand.fonts.display.faces).find((f) => path.basename(f.path) === path.basename(url.pathname));
    return file ? send(200, fs.readFileSync(file.path), 'font/woff2') : send(404, 'not found', 'text/plain');
  }
  if (url.pathname === '/login' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const form = new URLSearchParams(body);
      if (form.get('email') === USER && form.get('password') === PASS) {
        const sid = crypto.randomBytes(16).toString('hex');
        sessions.add(sid);
        const next = (form.get('next') || '/conversations').startsWith('/') ? form.get('next') || '/conversations' : '/conversations';
        return send(302, '', 'text/plain', { location: next, 'set-cookie': `sid=${sid}; Path=/; HttpOnly; SameSite=Lax` });
      }
      send(401, loginPage(form.get('next') || '/conversations', true));
    });
    return;
  }
  if (url.pathname === '/login') return send(200, loginPage(url.searchParams.get('next') || '/conversations'));
  if (url.pathname === '/logout') {
    sessions.delete(cookieSession(req));
    return send(302, '', 'text/plain', { location: '/login', 'set-cookie': 'sid=; Path=/; Max-Age=0' });
  }
  const route = ROUTES[url.pathname === '/' ? '/conversations' : url.pathname];
  if (!route) return send(404, page('Not found', '<h1 class="h1">Not found</h1>'));
  if (!sessions.has(cookieSession(req))) return send(302, '', 'text/plain', { location: `/login?next=${encodeURIComponent(url.pathname)}` });
  send(200, route());
});

server.listen(PORT, () => console.log(`demo app on http://localhost:${PORT} — log in as ${USER}`));
