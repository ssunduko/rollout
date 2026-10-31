# Rollout

Agent-authored feature launch assets. Give it a plain-English feature
description; Claude Code agents write the copy, **log into the application and
capture every screenshot and animated GIF** of the feature being used, and the
pipeline builds:

- `output/<slug>/<Feature> One-Pager.pdf` — a branded two-page one-pager
- `output/<slug>/assets/social/` — the social pack: a cover and one slide
  per section (1080×1350, also a carousel PDF), feature, podcast and YouTube
  thumbnails (1280×720), an email image and an email-signature banner
  (`docs/social.md`)
- `output/<slug>/web/` — a matching, self-contained, responsive feature page
  with an animated GIF for every visual (plus `page.json`, the same content as
  data for a CMS)
- `output/<slug>/help/` — the help-center article that teaches the feature,
  created in the help center or updated where one already covers it, on your
  go-ahead (`docs/help.md`)
- the feature page on your website — rebuilt in the site builder from the
  site's own components, as a draft, on your go-ahead (`docs/website.md`)
- `output/<slug>/onepager.html` — the PDF's source: animated GIFs when viewed
  in a browser, high-resolution stills when printed

Where the animation shows: the web page and `onepager.html` in a browser. The
PDF itself is a print format and always carries the stills.

Nothing about a brand is in the code. The brand is a folder with a
`brand.json` sidecar, chosen in `.env`. See `docs/ARCHITECTURE.md` for the
sidecar design.

## Setup

Requirements: Node 22+, Google Chrome (or Edge), ffmpeg.

```
npm install
cp .env.example .env        # set BRAND_DIR, the CTA defaults, the capture target
node pipeline/rollout.mjs brand
node pipeline/rollout.mjs targets
```

Point it at your application: copy `targets/_template.json` to
`targets/<name>.json`, put credentials in `.env` (referenced as `env:NAME`),
set `CAPTURE_TARGET` or the feature's `target`. For SSO, sign in once:
`node pipeline/rollout.mjs login <name>`. Full guide: `docs/capture.md`.

To try everything without your own app, start the example application in
another terminal: `npm run demo-app`.

## Make a rollout

```
node pipeline/rollout.mjs init my-feature --name "My Feature"
# describe it in input/my-feature/feature.md (optional: screenshots in assets/)
```

Then ask Claude Code: **"roll out my-feature"**. The `feature-rollout` skill:

1. `rollout-copywriter` writes `library/features/my-feature/brief.json`
2. `rollout-visual-designer` probes the signed-in app and writes a capture
   scene per section (state to reach, steps to record, clip), records stills +
   GIFs; asks before anything that would change live data
3. `node pipeline/rollout.mjs build my-feature` prints the PDF and writes the page
4. `rollout-qa` checks the PDF and the web page (measured + visual) and proposes fixes; you approve them
5. `node pipeline/rollout.mjs serve my-feature --open` shows the page from a local server
6. `rollout-help-writer` finds the help article that covers the feature, writes
   the new or revised article, and creates or updates it in the help center
   once you approve
7. `rollout-web-publisher` plans the feature page from your website's
   components and, once you approve, builds it there as a draft — creating any
   component the site lacks, for reuse

The example `input/smart-scheduling/` is fully built for the fictional
example brand (`brand/example/`), captured from the example app
(`demo-app/`, target `demo-app`):
`npm run demo-app`, then `node pipeline/rollout.mjs build smart-scheduling --force`.

## CLI

| Command | Does |
|---|---|
| `init <slug> [--name "..."]` | New `input/<slug>/` from `input/_template/` |
| `status <slug>` | What exists and what is next |
| `validate <slug>` | Brief against the layout limits |
| `targets` | Capture targets, auth mode, profile, unset variables |
| `login <target>` | Sign in by hand once (SSO); the profile keeps the session |
| `probe <target> [--open <path>] [--setup <steps.json>]` | Signed-in screenshot + element list with suggested selectors |
| `scene <id> [--force] [--allow-mutations]` | Capture or render one scene; prints still / GIF |
| `scenes <slug> [--force] [--allow-mutations]` | Every scene the brief uses |
| `build <slug> [--force] [--allow-mutations]` | Scenes → PDF → web page, `build.json` |
| `social <slug> [--force]` | Only the social pack, into `output/<slug>/assets/social/` (`docs/social.md`); `build` makes it too |
| `help <slug> [--force]` | Only the help article, into `output/<slug>/help/` (`docs/help.md`); `build` makes it too. Never sends it |
| `help-center` · `help-find <slug>` · `help-get <slug> <id>` | The help center: connection, authors and collections; existing articles; one article's body |
| `help-publish <slug> --yes [--state draft\|published] [--live]` | Create or update the article in the help center, after your approval |
| `site` · `site-find <slug>` · `site-get <slug> <pageId>` | The website: connection, folders and components; the inventory and pages that may be the feature's; one page |
| `site-plan <slug>` · `site-assets <slug> --yes` · `site-record <slug> <pageId>` | Check `site.json`; upload its images, after your approval; record the built page (`docs/website.md`) |
| `qa <slug>` | Measured checks + screenshots in `output/<slug>/qa/` (PDF pages; web page served over HTTP, desktop + mobile) |
| `serve <slug> [--open]` | Serve `output/<slug>/web/` on `WEB_PORT` (default 4400) and optionally open it in the browser |
| `library [list\|search <words>\|show <id>\|fork <from> <to>\|index]` | The asset library |
| `brand` | The resolved brand after `.env` overrides |

All are `node pipeline/rollout.mjs <command>`.

## Folders

| Folder | Holds | Written by |
|---|---|---|
| `input/<slug>/` | `feature.md`, `feature.json` sidecar, optional `assets/` | a person |
| `input/_template/` | the template `init` copies | — |
| `brand/<id>/` | one folder per brand (e.g. `example`): `brand.json`, logos, icons, fonts, `StyleGuide.txt` | a person, once per brand |
| `targets/` | applications captures log into (`*.local.json` gitignored) | a person, once per app |
| `profiles/` | signed-in Chrome profiles (gitignored) | `login` / captures |
| `demo-app/` | example application with a login, for trying the pipeline | — |
| `library/features/` | briefs | copywriter agent |
| `library/scenes/` | capture scenes (`scene.json`) and kit scenes (+ `scene.html`) | visual-designer agent |
| `library/renders/` | stills and GIFs, content-addressed | `scenes.mjs` / `capture.mjs` |
| `library/index.json` | searchable index (derived) | `library.mjs` |
| `output/<slug>/` | PDF, web folder, build and QA records | `rollout.mjs` |
| `pipeline/` | the deterministic core | — |
| `.claude/` | agents and the `feature-rollout` skill | — |
| `examples/` | local reference material (real one-pagers, site pages): gitignored | — |

## Configuration (.env)

| Key | Default | Meaning |
|---|---|---|
| `BRAND_DIR` | `brand/example` | Brand folder |
| `BRAND_NAME`, `BRAND_WEBSITE`, `BRAND_WEBSITE_LABEL`, `BRAND_PHONE`, `BRAND_EMAIL` | brand.json | Overrides |
| `BRAND_COLOR_<TOKEN>` | brand.json | Override a colour, e.g. `BRAND_COLOR_PRIMARY` |
| `TOPIC_PILL` | `#product update` | Hero pill |
| `CTA_TITLE`, `CTA_SUBTITLE`, `CTA_BUTTON`, `CTA_URL` | | Closing call to action |
| `WEB_HERO_BUTTON` | `Try for free` | Web hero button |
| `INPUT_DIR`, `LIBRARY_DIR`, `OUTPUT_DIR` | `input`, `library`, `output` | Folders |
| `CHROME_PATH` | auto | Chrome / Edge |
| `FFMPEG` | `ffmpeg` | For GIFs |
| `PAGE_SIZE` | `A4` | `A4` or `Letter` |
| `STILL_SCALE` | `2` | Pixel density of stills |
| `GIF_FPS`, `GIF_SCALE` | `12`, `1` | GIF frame rate and scale |
| `QA_FORBIDDEN_TERMS` | | Comma list QA fails on (e.g. another brand's name) |
| `CAPTURE_TARGET` | | Default target for captures |
| `CAPTURE_HEADLESS` | `true` | `false` to watch captures |
| `CAPTURE_SCALE` | `2` | Pixel density of captured stills |
| `GIF_WIDTH` | `800` | Maximum captured GIF width |
| `CAPTURE_MAX_WAIT_MS` | `700` | Longer waits are fast-forwarded in GIFs |
| `DEMO_APP_URL`, `DEMO_APP_PORT`, `DEMO_APP_USERNAME`, `DEMO_APP_PASSWORD` | | The example app and its target |

## Adding a brand

Copy `brand/example/` to `brand/<id>/`, replace the logos (SVG — inline
`<text>` uses the brand fonts — or PNG), fonts (woff2) and `brand.json` values, set
`BRAND_DIR=brand/<id>`, rebuild. Optional colour tokens: `ctaButton` (the CTA
button colour if it differs from `cta`). Every scene re-renders in the new
brand; the previous brand's renders stay in the library.

## Docs

- `docs/ARCHITECTURE.md` — sidecar architecture, data flow, code map
- `docs/brief.md` — the copy format and limits, the reference layout
- `docs/capture.md` — targets, probing, capture scenes, live-data and blur rules
- `docs/scene-kit.md` — kit scenes (hero composition, coming soon)
- `docs/rules.md` — standing rules
