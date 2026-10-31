# Capturing feature visuals from the application

Feature GIFs and stills are **captured from the real application**: the
pipeline logs into it, puts it in the right state, and records the feature
being used — with a smooth cursor, click ripples, banners hidden and personal
data blurred. It is built from targets, a persistent signed-in Chrome profile,
eased human-paced input, and a CDP screencast.

Drawn kit scenes (`docs/scene-kit.md`) remain for two things only: the hero
composition (which embeds a captured still) and UI that does not exist yet
(coming soon).

## 1. A target: where the app is and how to sign in

`targets/<name>.json` (copy `targets/_template.json`). Committed, no secrets.
Credentials and URLs come from `.env` through `"env:NAME"` references, or from
`targets/<name>.local.json` (gitignored).

| Key | Meaning |
|---|---|
| `app` | the app's URL |
| `startUrl` | default start page |
| `viewport` | browser size in CSS px (default 1440×900) |
| `auth.mode` | `form`: fill the login form off camera when it appears · `none`: use the profile's session (SSO, email codes) |
| `auth.selectors` | `username`, `password`, `submit`, optional `signInLink`; `signedIn` proves the app loaded |
| `pageUrlMatch` | extra hosts that count as the app (identity provider) |
| `blockUrls` | patterns kept from loading (chat widgets, surveys) |
| `hideSelectors` | hidden during captures (banners unrelated to features) |
| `blurSelectors` | blurred during captures (names, phone numbers, emails) |
| `profile` | Chrome profile folder (default `profiles/<name>/`, gitignored) |
| `secrets` | values for `{name}` placeholders in scene URLs (internal ids) |

Which target a scene uses: the scene's `target`, else
`input/<slug>/feature.json` `target`, else `CAPTURE_TARGET` in `.env`.

SSO apps: sign in once by hand — `node pipeline/rollout.mjs login <target>`
opens Chrome on the target's profile; sign in, close the window. Captures reuse
that session (headless). Each target keeps its own profile; never point a
target at another project's signed-in profile (`docs/rules.md`).

`node pipeline/rollout.mjs targets` lists targets, their auth mode, whether a
profile exists and which variables are unset.

## 2. Probe: find selectors and clip regions

```
node pipeline/rollout.mjs probe <target> --open settings/scheduling
node pipeline/rollout.mjs probe <target> --open conversations --setup steps.json
```

Signs in, opens the page (optionally runs setup steps, e.g. to open a menu),
and writes `output/_probe/<target>/probe.png` (what is on screen) and
`probe.json` (visible interactive elements and containers with their boxes and
a suggested selector + match count). Preference order for selectors:
`data-testid` → stable `id` → `aria-label` → `name`/`placeholder` →
`btn:Text` → `::-p-text(Heading)`. Never generated class names.

In Git Bash on Windows write the path without its leading slash
(`--open settings/scheduling`); `/settings/...` is rewritten into a Windows
path by the shell.

## 3. A capture scene

`library/scenes/<feature>--<name>/scene.json` — no `scene.html`:

```json
{
  "title": "Scheduling settings: round-robin switched on (captured)",
  "description": "What it shows and what happens.",
  "tags": ["capture", "settings", "toggle"],
  "feature": "smart-scheduling",
  "source": "capture",
  "target": "demo-app",
  "start": "/settings/scheduling",
  "viewport": { "width": 1280, "height": 800 },
  "setup": [ { "op": "wait", "sel": "[data-testid=\"scheduling-card\"]" } ],
  "steps": [
    { "op": "hold", "ms": 700 },
    { "op": "click", "sel": "[data-testid=\"round-robin\"]" },
    { "op": "wait", "sel": "#rr-note" },
    { "op": "hold", "ms": 600 },
    { "op": "still" }
  ],
  "clip": "[data-testid=\"scheduling-card\"]",
  "pad": 14,
  "aspect": 1.26,
  "anchor": "top"
}
```

| Field | Meaning |
|---|---|
| `start` | first URL (relative; `{secret}` placeholders allowed) |
| `setup` | steps run **before** recording: navigate, wait for content, close popups |
| `steps` | steps run **while** recording |
| `clip` | a selector (its box at the still moment, plus `pad`), a rect `{x,y,width,height}`, or `"viewport"` |
| `aspect` | bring the clip to width/height — **1.26 matches the PDF panel**. Tall clips are cropped (keeping `anchor`); wide ones are extended with the page below (above for `anchor: "bottom"`); sides are never cut |
| `anchor` | `top` · `center` · `bottom` |
| `web` | the web page's cut of the same recording (below). Optional: `clip` (selector or rect to cut from), `pad`, `width` (CSS px shown; less = more zoom, default 600 or wide enough for every point), `align` (with `clip`: `top-left` · `top` · `center`) |
| `viewport` | override the target's — a narrower browser makes the UI larger relative to the clip |
| `hide`, `blur` | extra selectors for this scene |
| `holdEnd` | ms recorded after the last step (default 1200) |

### Steps

| op | fields | does |
|---|---|---|
| `open` | `url` | navigate (counts as a wait) |
| `wait` / `waitGone` | `sel`, `timeout` | wait for an element to appear / disappear |
| `click` | `sel`, `mutates` | glide to it, press, release |
| `hover` / `move` | `sel` or `to: [x,y]` | glide the cursor |
| `type` | `sel`, `text` or `secret`, `delay`, `clear` | click, verify focus, type at human pace |
| `press` | `key` | a key, e.g. `Enter` |
| `scroll` | `sel`, `dy` | wheel over an element |
| `hold` | `ms` | let the viewer read |
| `ifAppears` | `sel`, `timeout`, `then` | close a popup only if it shows |
| `still` | | take the still here (default: after the last step) |

Selectors are puppeteer selectors (CSS, `::-p-text(...)`, `::-p-aria(...)`)
or `btn:Exact text|Alt` for a visible button, link or menu item.

### What the recording does for you

- **Cursor**: an overlay injected into every page, moved with eased motion;
  click ripples; so it appears in the frames (headless Chrome has none).
- **Waits**: any wait longer than `CAPTURE_MAX_WAIT_MS` (default 700) is
  fast-forwarded in the GIF, so page loads don't become dead air.
- **Still**: a separate screenshot at `CAPTURE_SCALE` (default 2×) — print
  quality for the PDF.
- **GIF** (`anim.gif`): frames cropped to the clip, scaled to at most
  `GIF_WIDTH`, `GIF_FPS` frames per second, palette-optimised.
- **Web cut** (`web.gif`): the same frames, cut to the web page's format —
  `WEB_GIF_WIDTH`×`WEB_GIF_HEIGHT` (default 1180×676, the site's feature
  pages), about 600 CSS px of UI shown across (twice the PDF's zoom), inside
  a 2 px light-grey rounded frame that is part of the image. Without a `web`
  field the region keeps the clip's left edge and centres vertically on the
  points the steps moved the cursor to; it may bleed off the UI's right and
  bottom edges, as the site's pages do. Set `web.clip` / `web.width` when
  that misses the action or cuts a label.

Where it animates: `onepager.html` in a browser shows the GIF and the web
page shows the web cut; the printed PDF shows the still. QA fails a GIF with fewer than 3
distinct frames — a capture whose steps never changed the screen.

Render: `node pipeline/rollout.mjs scene <id>` (cached by content; `--force`
re-captures after the app changed). Debug visibly: `CAPTURE_HEADLESS=false`;
keep the raw frames and the frame list next to the GIF: `CAPTURE_DEBUG=1`.

## Live data: look, don't touch

Captures run against a real account. Any step that sends, creates, edits or
deletes must carry `"mutates": true`; capture refuses such scenes unless
`--allow-mutations` is passed — and that flag is passed only after the user
has said yes for that scene. Prefer states that already exist (an existing
conversation, a prepared record) and UI that is local until saved (opening a
menu, typing into a field without submitting). Never click tracked links.

## Personal data

Blur any contact's name, phone number, email and similar wherever they appear
(`blurSelectors` on the target, `blur` on the scene). Check every still; an
unblurred one fails QA.

## Private applications

Captures show the real product. For a private app, keep its target
gitignored and consider gitignoring `library/renders/` (see `.gitignore`).

## The example application

`npm run demo-app` starts `demo-app/` on `DEMO_APP_URL` — a small app
with a login form (`DEMO_APP_USERNAME` / `DEMO_APP_PASSWORD`), a loading
spinner, a banner (hidden by the target) and contact details (blurred by the
target). `targets/demo-app.json` and the `smart-scheduling` capture scenes
show every part of this document working.
