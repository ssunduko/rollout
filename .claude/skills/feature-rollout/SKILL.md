---
name: feature-rollout
description: Use when asked to create a feature one-pager, rollout PDF, feature web page, launch assets or help-center article from a feature description (e.g. "roll out smart-scheduling", "make the one-pager and web page for input/<slug>", "publish the help article for <slug>", "put the feature page for <slug> on the website"). Orchestrates the copywriter, visual-designer, QA and help-writer agents over the sidecar pipeline and delivers output/<slug>/<Feature> One-Pager.pdf, output/<slug>/web/, the social pack in output/<slug>/assets/social/ and the help article in output/<slug>/help/, created or updated in the help center on request, and the feature page built on the website from its components, as a draft, on request.
---

# Feature rollout

Turns `input/<slug>/feature.md` into a branded two-page one-pager PDF and a
matching web page. Architecture: `docs/ARCHITECTURE.md`. The agents author
sidecars; `node pipeline/rollout.mjs` renders them. Run everything from the
repo root.

## Procedure

0. **Check prerequisites** (report, don't silently fix): `node_modules/`
   installed (`npm install`), Chrome found, `ffmpeg` on PATH or `FFMPEG` set,
   `.env` present (`cp .env.example .env`) with `BRAND_DIR` pointing at a
   folder under `brand/`. `node pipeline/rollout.mjs brand` proves the brand
   loads.
   **The application**: visuals are captured by logging into it
   (`docs/capture.md`). `node pipeline/rollout.mjs targets` must show the
   feature's target (`feature.json` `target`, else `CAPTURE_TARGET`) with no
   unset variables. SSO targets need a session: ask the user to run
   `! node pipeline/rollout.mjs login <target>` once. The app must be
   running and reachable — if it is down, ask; never start it yourself (the
   example app is the exception: `npm run demo-app`).

1. **Input.** `node pipeline/rollout.mjs status <slug>`.
   - No `input/<slug>/`: `node pipeline/rollout.mjs init <slug> --name "<Name>"`,
     then write `feature.md` from what the user gave you (ask for what is
     missing: capabilities, status, words to avoid). Don't invent capabilities.
   - Assets the user supplied (screenshots, logos) go in `input/<slug>/assets/`
     and are listed in `feature.json` `assets` with what each shows.

2. **Copy.** Run the `rollout-copywriter` agent: "Write the brief for <slug>."
   Read `library/features/<slug>/brief.json` when it returns.

3. **Visuals.** Run the `rollout-visual-designer` agent: "Capture the scenes
   for <slug> from target <target>." It probes the signed-in app, writes
   capture scenes and records them — each recording gives the PDF its GIF and
   still and the web page its framed 1180×676 web cut. It also writes
   `library/features/<slug>/social.json`, the social pack's sidecar
   (`docs/social.md`). If it reports reusing a library scene
   under another id, update the brief's `scene` field to that id.
   **If it reports steps marked `mutates`** (they send, create, edit or delete
   live data), show the user exactly what each does and where, and only on a
   yes resume it with "--allow-mutations is approved for <scene ids>".
   `node pipeline/rollout.mjs validate <slug>` must show no errors.

4. **Build.** `node pipeline/rollout.mjs build <slug>`. Unchanged scenes are
   reused from `library/renders/`; `--force` re-captures and re-renders all
   (do it when the app's UI changed). The web page follows the site's
   feature-page layout (`docs/brief.md`, "Web page"): its chrome comes from
   the brand's `web` block, and its video slot shows a placeholder until the
   brief's `web.video` is set — say so when delivering.

5. **QA.** Run the `rollout-qa` agent: "QA <slug>." It reviews the PDF and
   the web page (served over HTTP, desktop and mobile); a verdict that does
   not cover both is incomplete — send it back. Show the user its verdict
   and proposed fixes, and **ask before applying any of them**. Apply approved
   fixes by sending them back to the agent that owns the file (copy →
   copywriter, scene → visual-designer), then rebuild and re-run QA.

6. **Show the page.** Only on a QA PASS. Start the local server in the
   background (Bash `run_in_background`):
   `node pipeline/rollout.mjs serve <slug> --open` — it serves
   `output/<slug>/web/` on `http://localhost:<WEB_PORT>/` (default 4400) and
   opens it in the user's browser. Confirm it renders: `curl` the URL for a
   200, then Read `output/<slug>/qa/web-desktop-fold.png` and
   `web-mobile-fold.png` (taken from the same served folder) and say what the
   first screen shows. If the port is taken, set `WEB_PORT` for that run.
   Leave the server running and tell the user the URL and how to stop it.

7. **Help article.** Run the `rollout-help-writer` agent: "Write the help
   article for <slug>." It finds the help-center article that already covers
   the feature (`help-find`, over the help center's API; `docs/help.md`),
   writes `library/features/<slug>/help.json` and builds
   `output/<slug>/help/`. Show the user its report: create or update (which
   article, and the other candidates), for a new article the collection it
   chose and why, the sections added, changed and kept,
   the blockers, and `output/<slug>/help/preview.html`. If it could not
   connect (`node pipeline/rollout.mjs help-center` fails), say which `.env`
   key is missing (`docs/help.md`, "The help center connection") and stop at
   the built preview.
   **Ask before sending**: the action, the article (or the collection) and
   draft or published.
   If the article is already published, say that the update goes live the
   moment it is sent. Only on a yes resume the agent with "Publish the help
   article for <slug>; approved: <create | update <id>>, <draft | published>[,
   live]." — never as published or live unless the user said so, and never
   past a refusal (an article edited in the help center since it was read).

8. **Website page (on request).** When the user wants the feature page on
   their website, run the `rollout-web-publisher` agent: "Plan the web page
   for <slug> in the site." It reads the site's pages and components
   (`site-find`), plans the page from them in
   `library/features/<slug>/site.json` (`docs/website.md`) and reports: create
   or update (which page), the components part by part, which are new and
   what they are based on, the images to upload. If `node pipeline/rollout.mjs
   site` fails, say which `.env` key is missing (`docs/website.md`, "The
   connection") and stop.
   **Ask before building**: the action (create, or update of a page id).
   Only on a yes resume the agent with "Build the web page for <slug> in the
   site; approved: <create | update <pageId>>, draft." It stays a draft;
   publishing the site is the user's, from the site builder.

9. **Deliver.** Report:
   - `output/<slug>/<Feature> One-Pager.pdf`
   - `output/<slug>/web/index.html` (self-contained folder; `page.json` is the
     same content as data for CMS import)
   - `output/<slug>/assets/social/`: the cover and carousel slides
     (1080×1350, plus the carousel as one PDF for LinkedIn), the feature,
     podcast and YouTube thumbnails (1280×720), the email image (1100×600,
     transparent) and the email-signature banner (500×175)
   - `output/<slug>/help/` and, when it was sent, the help article's id,
     URL and state
   - when it was built, the website page's id and path (a draft)
   - which scenes were new and which were reused.
   Offer to open the PDF. Publishing anywhere external (a CMS, a
   shared drive, a ticket) only on the user's explicit go-ahead.

## Changing things later

- Copy tweak: edit the brief (or ask the copywriter), then `build`.
- Visual tweak: edit `library/scenes/<id>/scene.json`, `scene <id> --force`,
  then `build`.
- Social image tweak: edit `library/features/<slug>/social.json` (slide
  title accents, crops), then `social <slug>`.
- The app changed: `build <slug> --force` re-captures everything.
- Help article tweak: edit `library/features/<slug>/help.json` (or ask the
  help writer), `help <slug>`, then publish it again on the user's yes —
  it updates the article recorded in `publish`.
- Another brand: point `BRAND_DIR` at another folder in `brand/` (or use
  `BRAND_*` overrides) and `build` — layouts and kit scenes re-render in the
  new brand; captures are reused (the app paints itself).
- A standing rule from the user: add it to `docs/rules.md` with why and the date.
