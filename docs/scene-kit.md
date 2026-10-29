# Scene kit

> Feature visuals are **captured from the application** (`docs/capture.md`).
> The kit is for the hero composition — which embeds a captured still with
> `<img src="scene:<capture-id>">` — and for UI that does not exist yet
> (coming soon).

A **kit scene** is one visual: a moment of product UI, drawn in HTML
from the kit classes below, painted in the current brand, optionally animated
with a cursor. It lives in `library/scenes/<id>/` and renders to a PNG still
(PDF, web hero) and an animated GIF (web page).

- Kit CSS: `pipeline/kit/kit.css` · runtime: `pipeline/kit/runtime.js`
- Render one: `node pipeline/rollout.mjs scene <id>` (`--force` to re-render)
- Find one to reuse: `node pipeline/rollout.mjs library search <words>`
- Copy one to adapt: `node pipeline/rollout.mjs library fork <from> <to>`
- Worked examples: `library/scenes/smart-scheduling--*`

## Files

`library/scenes/<feature>--<name>/`

- `scene.json` — the sidecar
- `scene.html` — the markup (a fragment: no `<html>`, `<head>` or `<script>`)
- any local images it references (`src="photo.png"`), inlined at render time

```json
{
  "title": "Short description, for search",
  "description": "What it shows and what happens in the animation.",
  "tags": ["chat", "menu", "settings"],
  "feature": "smart-scheduling",
  "size": { "width": 480, "height": 380 },
  "transparent": false,
  "background": null,
  "gifBackground": null,
  "cursor": true,
  "cursorStart": [420, 400],
  "stillAt": 3000,
  "css": "#slot.on { border-color: var(--primary); }",
  "animation": {
    "duration": 3500,
    "holdEnd": 1200,
    "steps": [
      { "at": 900, "cursor": "#button" },
      { "at": 1050, "click": true, "sel": "#button" },
      { "at": 1100, "show": "#menu" }
    ]
  }
}
```

| Field | Default | Meaning |
|---|---|---|
| `size` | 640×480 | CSS pixels. **Sections: 480×380.** Hero: about 680×560. Signature motif (`docs/social.md`): 224×167 |
| `transparent` | false | Hero only: the web page shows the PNG (not the GIF) over its gradient |
| `background` | transparent | Fill behind the scene in the still |
| `gifBackground` | brand surface | Fill behind GIF frames (GIF has no soft transparency). Use `#ffffff` for a hero |
| `cursor` | true | `false` for scenes animated without a pointer (messages arriving) |
| `cursorStart` | below the bottom-right | Where the cursor enters from |
| `stillAt` | `duration` | The ms whose frame becomes the still. Pick the moment that tells the story |
| `css` | — | Extra CSS for this scene only. Brand variables only, no hex brand colours |
| `animation.duration` | 0 | 0 = still only, no GIF |
| `animation.holdEnd` | 1200 | ms the GIF rests on the end state before looping |
| `web` | — | Section scenes: `{}` or `{ "size": {w,h} }` also renders the web page's version (`web.gif`) at that size (default 600×344, the web frame's 1.75:1 shape), framed like a capture's web cut. The page gets class `web` on `<html>`, so `css` can set the web layout: `.web .bubble{font-size:22px}`. Without it the web page fits the PDF render into the frame, which is small on phones |
| `title`/`description`/`tags`/`feature` | — | Metadata: editing them never re-renders |

## Steps

Each step has `at` (ms) and any of:

| Key | With | Effect |
|---|---|---|
| `cursor` | `[x, y]` or a selector | Cursor arrives there at `at`; travels for `move` ms (default 650). A hidden target keeps the cursor where it was |
| `click` | `true`, optional `sel` | Ripple at the cursor; `sel` gets `.pressed` for 220 ms |
| `addClass` / `removeClass` / `toggleClass` | `sel` | Change classes (e.g. `on`, `focus`) |
| `show` / `hide` | a selector | Remove / add `.is-hidden`. Author hidden elements with `class="is-hidden"` |
| `text` | `sel` | Replace text |
| `type` | `sel`, `dur`, `append` | Type text over `dur` ms (default 40 ms a character), with a caret |
| `scroll` | `sel`, `dur` | Scroll the element to that `scrollTop` |

The runtime rebuilds the stage from scratch for every frame and replays the
steps up to that time, so steps are declarative states, not events. CSS
transitions are disabled; motion comes only from steps.

Typical rhythm: 0.6–1 s settle, cursor moves (0.65 s), click, result appears
0.05–0.1 s later, 0.6–1 s to read it, next action; end with the cursor resting
just beside the result. Total 2.5–4.5 s.

## Layout of a section scene

```html
<div class="window bleed abs" style="left:22px;top:22px;right:22px;bottom:0;padding:18px">
  <div class="row between"><div class="title">Panel title</div><span class="badge new">New</span></div>
  ...
</div>
```

The PDF shows the still inside a soft panel; the window bleeds off the
bottom as if cropped from the app. Keep content in the top ~330 px. Base text
is 13 px; at print size the scene is shrunk to ~60%, so don't go below
`.small` (11 px) for anything that matters, and don't cram more than ~6 rows.

## Classes

Layout: `.row` (flex, centred, gap 10) · `.row.top` · `.row.between` ·
`.col` · `.stack` (column, gap 12) · `.stack.lg` · `.grow` / `.spacer` ·
`.center` · `.abs` (absolute; position with inline `left/top/right/bottom`) ·
`.fill` · `.pad` · `.pad-lg` · `.sep`

Surfaces: `.window` (white card, shadow, radius 16) · `.window.bleed` ·
`.window.flat` · `.panel` (soft grey) · `.panel.tint` · `.panel.warm` ·
`.panel.line` (white, bordered) · `.bubble-icon` (floating round icon)

Type: `.h1` · `.title` · `.subtitle` · `.muted` · `.label` · `.text` ·
`.small` · `.strong` · `.accent` · `.link`

Controls: `.field` (input) · `.field.area` · `.field.focus` · `.select`
(adds a chevron) · `.placeholder` · `.btn` · `.btn.primary` · `.btn.cta` ·
`.btn.soft` · `.btn.line` · `.btn.ghost` · `.btn.block` · `.toggle` ·
`.toggle.on` · `.check` / `.check.on` · `.radio` / `.radio.on` · `.tabs` >
`.tab` / `.tab.on` · `.seg` > `span.on`

Tokens: `.chip` · `.var` (highlighted variable, e.g. a field name in a
prompt) · `.var.danger` · `.badge` (warning tint) · `.badge.new` ·
`.badge.success` · `.badge.danger` · `.pill` · `.kbd`

Status: `.status.success|danger|warning|info` (round icon holder) ·
`.rail.success|danger` (coloured left rail) · `.callout` · `.callout.warn`

Menus and lists: `.menu` · `.menu-search` · `.menu-head` · `.menu-item` ·
`.menu-item.on` (hovered) · `.list-item` · `.list-item.on` · `.list-item.chev`
· `table.table`

People and messages: `.avatar` (initials; colour with `style="--c:#8b5cf6"`;
may hold an `<img>`) · `.avatar.sm|lg|xl` · `.avatar.ring` · `.thread` ·
`.bubble.in` · `.bubble.out` · `.meta` (time inside a bubble) · `.composer` ·
`.phone` · `.phone-bar`

Overlays: `.tooltip` (position with `.abs` coordinates) · `.toast` ·
`.skeleton`

Data: `.stat` > `.value` + `.label` · `.bars` > `i` (`style="--h:60%"`,
`.on`) · `.progress` > `i` (`style="--w:40%"`)

Brand marks in markup: `src="brand:logo"`, `brand:logo-reversed`, `brand:icon`.
Another scene's still: `src="scene:<id>"` (rendered first; part of the hash).
The renderer records where it sits, and the web page and `onepager.html` lay
that scene's GIF exactly over it — so a hero that embeds a capture animates.

## Icons

`<i data-icon="name"></i>` — 16 px, `currentColor`. Size with inline
`width/height`, colour with `.accent` or `style="color:..."`.

plus · check · x · search · calendar · clock · tag · note · send · user ·
users · chevron-right · chevron-down · arrow-left · arrow-right · sparkle ·
info · link · phone · mail · globe · settings · bell · chart · star · bolt ·
message · lock · filter · more · smile · image · inbox · hash · trash · edit ·
play · robot · shield · refresh · upload

## Do / don't

- Do use the feature's real labels, fields and statuses from `feature.md`.
- Do use generic people (initials avatars, common first names) and generic
  data; never real customers, real phone numbers or emails.
- Don't draw another company's logo or name (partners named in the feature
  description may appear as text labels).
- Don't use brand hex colours; use `var(--primary)`, `var(--cta)`,
  `var(--ink)`, `var(--muted)`, `var(--navy)`, `var(--surface)`,
  `var(--hero-tint)`, `var(--success)`, `var(--danger)`, `var(--warning)`.
  Neutral non-brand tints (avatar colours) are fine.
- Don't load anything from the network.
- When the kit is missing something general, use `css` in the scene and
  report it; the kit gains it in `kit.css` and here.
