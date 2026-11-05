# Rollout

Agent-authored feature launch assets. Give it a plain-English feature
description; Claude Code agents write the copy, **log into the application and
capture every screenshot and animated GIF** of the feature being used, and the
pipeline builds:

- `output/<slug>/<Feature> One-Pager.pdf` — a branded two-page one-pager
- `output/<slug>/assets/social/` — the social pack: a cover and one slide
  per section with a short title only (1080×1350, also a carousel PDF),
  feature, podcast and YouTube thumbnails (1280×720), an email image and an
  email-signature banner cut from the hero (`docs/social.md`)
- `output/<slug>/web/` — a matching, self-contained, responsive feature page
  with an animated GIF for every visual (plus `page.json`, the same content as
  data for a CMS)
- `output/<slug>/help/` — the help-center article that teaches the feature,
  created in the help center or updated where one already covers it, on your
  go-ahead (`docs/help.md`)
- the feature page on your website — an item of the site's feature CMS
  collection when it keeps feature pages there, else rebuilt from the site's
  own components; as a draft, on your go-ahead (`docs/website.md`)
- a podcast episode made from the feature's video — two hosts talking it
  through, voiced into an MP3 you upload to your show on Spotify, with its
  page on your website, on your go-ahead; once it is published, found on
  Spotify and saved to your library if you signed in (`docs/podcast.md`)
- the feature video's own page on your website — an item of the site's video
  collection with the YouTube video, a summary, the transcript and related
  videos; as a draft, on your go-ahead (`docs/video.md`)
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
7. `rollout-web-publisher` plans the feature page for your website — as an
   item of its feature CMS collection, or from its components — and, once you
   approve, builds it there as a draft (creating any component the site lacks,
   for reuse); you publish it. On request it does the same for the feature
   video's page, an item of the site's video collection
8. `rollout-podcast-producer` transcribes the feature's video, plans the
   episode and writes its two-host script for you to read; once you approve,
   it has the script voiced into an MP3 you
   upload to your show, finds it on Spotify once published (saving it to
   your Spotify library after a one-time `spotify-login`) and builds its
   draft page on your website

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
| `site` · `site-find <slug> [<words>]` · `site-get <slug> <id> [--item]` | The website: connection, folders and components; the inventory (with the feature collection) and pages or items that may be the feature's; one page, or with `--item` one collection item |
| `site-plan <slug>` · `site-assets <slug> --yes` · `site-record <slug> <id> [--item]` | Check `site.json`; upload its images, after your approval; record the built page or item (`docs/website.md`) |
| `seo <slug> [--live] [--url <url>]` | Search and answer-engine checks of the brief, website plan and episode page; their structured data (JSON-LD) into `output/<slug>/seo/`; `--live` audits the published pages (`docs/seo.md`) |
| `podcast-check` · `google-login` · `spotify-login` | The podcast services: connections, voices, the show, whether you are signed in to Spotify; the one-time sign-ins to Google (to read the videos) and to Spotify (to save episodes to your library), saving their tokens in `.env` |
| `podcast-transcribe <slug>` · `podcast-script <slug>` · `podcast <slug> --yes [--force]` | Transcribe the feature video; show the episode's script (written by the agent) with its length; voice it (spends studio credits) into `output/<slug>/podcast/` (`docs/podcast.md`) |
| `podcast-find <slug>` | Once you uploaded and published the episode in the show: find it on the directory and record its link; signed in (`spotify-login`), save it to your library once |
| `podcast-site <slug>` · `podcast-site-assets <slug> --yes` · `podcast-site-record <slug> <itemId>` | The website's episode collection; upload the page's images; record the built episode page |
| `video-transcribe <slug>` · `video-site <slug>` · `video-plan <slug>` · `video-site-assets <slug> --yes` · `video-site-record <slug> <itemId>` | The feature video's page: the video as text (shared with the podcast); the website's video collection and the next sort order; check `video.json`; upload its images; record the built item (`docs/video.md`) |
| `qa <slug>` | Measured checks + screenshots in `output/<slug>/qa/` (PDF pages; web page served over HTTP, desktop + mobile) |
| `serve <slug> [--open]` | Serve `output/<slug>/web/` on `WEB_PORT` (default 4400) and optionally open it in the browser |
| `library [list\|search <words>\|show <id>\|fork <from> <to>\|index]` | The asset library |
| `brand` | The resolved brand after `.env` overrides |

All are `node pipeline/rollout.mjs <command>`.

## Tests

`npm test` runs the unit tests (every module and adapter, in seconds) and the
integration tests (the CLI, the demo app, the podcast and a full build of the
example feature, with Chrome and ffmpeg). They read `.env.example` and a
throwaway copy of the example, never your `.env` or library. GitHub Actions
runs them on every pull request. See `test/README.md`.

## Folders

| Folder | Holds | Written by |
|---|---|---|
| `input/<slug>/` | `feature.md`, `feature.json` sidecar, optional `assets/` | a person |
| `input/_template/` | the template `init` copies | — |
| `brand/<id>/` | one folder per brand (e.g. `example`): `brand.json`, logos, icons, fonts, `StyleGuide.txt` | a person, once per brand |
| `targets/` | applications captures log into (`*.local.json` gitignored) | a person, once per app |
| `profiles/` | signed-in Chrome profiles (gitignored) | `login` / captures |
| `demo-app/` | example application with a login, for trying the pipeline | — |
| `library/features/` | per feature: `brief.json`, `social.json`, `help.json`, `site.json`, `podcast.json`, and the `*.published.json` records | the agents; records by `rollout.mjs` |
| `library/scenes/` | capture scenes (`scene.json`) and kit scenes (+ `scene.html`) | visual-designer agent |
| `library/renders/` | stills and GIFs, content-addressed | `scenes.mjs` / `capture.mjs` |
| `library/index.json` | searchable index (derived) | `library.mjs` |
| `output/<slug>/` | PDF, web folder, social pack, help article, website inventory and assets, podcast episode and transcripts, build and QA records | `rollout.mjs` |
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
| `FFPROBE` | next to ffmpeg / PATH | For frame checks |
| `CAPTURE_DEBUG` | | Set: keep the raw capture frames for debugging |
| `DEMO_APP_URL`, `DEMO_APP_PORT`, `DEMO_APP_USERNAME`, `DEMO_APP_PASSWORD` | | The example app and its target |
| `WEB_GIF_WIDTH`, `WEB_GIF_HEIGHT`, `WEB_GIF_FPS` | `1180`, `676`, `20` | The web page's framed section GIFs |
| `WEB_FRAME_BORDER`, `WEB_FRAME_RADIUS` | `#e3e7ec`, `20` | Their frame |
| `WEB_PORT` | `4400` | Port of `serve` |
| `HELP_CENTER`, `HELP_CENTER_TOKEN`, `HELP_CENTER_API_URL`, `HELP_CENTER_API_VERSION`, `HELP_AUTHOR_ID`, `HELP_COLLECTION_ID` | | The help center connection (`docs/help.md`) |
| `HELP_IMAGE_STORE`, `HELP_IMAGE_BUCKET`, `HELP_IMAGE_REGION`, `HELP_IMAGE_PREFIX`, `HELP_IMAGE_ENDPOINT`, `HELP_IMAGE_URL_TTL`, `HELP_IMAGE_BASE_URL`, `AWS_*` | | Where the help article's images are hosted (`docs/help.md`) |
| `HELP_FRAME_PAD`, `HELP_FRAME_RADIUS`, `HELP_FRAME_BORDER` | `24`, `12`, `WEB_FRAME_BORDER` | The frame drawn into help-article images |
| `WEBSITE`, `WEBFLOW_API_URL`, `WEBFLOW_API_TOKEN`, `WEBFLOW_SITE_ID`, `WEBFLOW_FEATURES_COLLECTION_ID`, `WEBFLOW_PAGE_FOLDER_ID`, `WEBFLOW_COMPONENT_GROUP` | | The website connection (`docs/website.md`) |
| `PODCAST_VIDEO_SOURCE`, `PODCAST_STUDIO`, `PODCAST_DIRECTORY` | | The podcast's services: `gdrive`, `elevenlabs`, `spotify` (`docs/podcast.md`) |
| `GOOGLE_OAUTH_*` or `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`, `ELEVENLABS_*`, `SPOTIFY_*`, `WEBFLOW_PODCASTS_COLLECTION_ID`, `PODCAST_VIDEO_MAX_MB` | | Their keys, the show's two voices, the show, the website's episode collection |
| `WEBFLOW_VIDEOS_COLLECTION_ID` | | The website's video collection, for the feature video's page (`docs/video.md`) |

Every key, with its comment, is in `.env.example`.

## Adding a brand

Copy `brand/example/` to `brand/<id>/`, replace the logos (SVG — inline
`<text>` uses the brand fonts — or PNG), fonts (woff2, woff, ttf or otf) and
`brand.json` values, set `BRAND_DIR=brand/<id>`, rebuild. Optional colour
tokens: `ctaButton` (the CTA button colour if it differs from `cta`).
Optional `cursor` block: the brand's own cursor over captures
(`docs/capture.md`). Every scene re-renders in the new brand; the previous
brand's renders stay in the library.

## Docs

- `docs/ARCHITECTURE.md` — sidecar architecture, data flow, code map
- `docs/brief.md` — the copy format and limits, the reference layout
- `docs/capture.md` — targets, probing, capture scenes, live-data and blur rules
- `docs/scene-kit.md` — kit scenes (hero composition, coming soon)
- `docs/social.md` — the social pack
- `docs/help.md` — the help-center article, its images and publishing
- `docs/website.md` — the feature page on the website (CMS item or components)
- `docs/seo.md` — search (SEO) and answer engines (AEO): the rules, where they apply, structured data
- `docs/podcast.md` — the podcast episode from the feature video, its services and page
- `docs/video.md` — the feature video's own page, an item of the site's video collection
- `docs/rules.md` — standing rules
- `test/README.md` — the tests: what they cover and how they stay off real data
- `docs/c4/` — C4 architecture diagrams (PlantUML)
