---
name: feature-rollout
description: Use when asked to create a feature one-pager, rollout PDF, feature web page, launch email, social posts, podcast brief or other launch assets from a feature description or from an umbrella ticket, rollout parent ticket or rollout wiki page (e.g. "roll out smart-scheduling", "make the one-pager and web page for input/<slug>", "roll out <ticket key>"). Orchestrates the scope, copywriter, visual-designer and QA agents over the sidecar pipeline and delivers output/<slug>/<Feature> One-Pager.pdf, output/<slug>/web/, the social pack in output/<slug>/assets/social/ and the copy pack in output/<slug>/copy/.
---

# Feature rollout

Turns `input/<slug>/feature.md` (written by hand, or by the `rollout-scope`
agent from tickets) into a branded two-page one-pager PDF, a matching web
page, the social images and the launch copy (email, posts, podcast brief). Architecture: `docs/ARCHITECTURE.md`. The agents author
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
   - **The user gave a ticket or a page** (an umbrella ticket, a "<Feature>
     Rollout" parent, a "Rollout Assets" wiki page, or a messaging brief to
     find the tickets for): run the `rollout-scope` agent: "Scope <ref> for
     <slug>." Show the user its report as is (subheadlines with ticket links,
     Dropped, Needs Info, Possibly Incomplete) and **wait for their
     confirmation or edits**. If they want a ticket from another umbrella,
     pass that on. Then resume the same agent with "Scope confirmed: <the
     final list and edits>. Write the input for <slug>." It writes
     `feature.md` and the `sources` in `feature.json`; read `feature.md`.
     `node pipeline/rollout.mjs tracker` must show the tracker settings
     (`TRACKER_*` in `.env`); if they are empty, the agent searches without
     them, so say so.
   - No `input/<slug>/` and no ticket: `node pipeline/rollout.mjs init <slug> --name "<Name>"`,
     then write `feature.md` from what the user gave you (ask for what is
     missing: capabilities, status, words to avoid). Don't invent capabilities.
   - Assets the user supplied (screenshots, logos) go in `input/<slug>/assets/`
     and are listed in `feature.json` `assets` with what each shows.

2. **Copy.** Run the `rollout-copywriter` agent: "Write the brief and the
   copy pack for <slug>." It writes `library/features/<slug>/brief.json`
   and `copy.json` (email, posts, podcast brief: `docs/copy.md`). Read both
   when it returns. If the scope was not confirmed in step 1, show the user
   the section titles and wait for a yes before step 3.

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

4. **Build.** `node pipeline/rollout.mjs build <slug>` (it also writes the
   copy pack into `output/<slug>/copy/`, after the social pack whose images
   the posts attach). Unchanged scenes are
   reused from `library/renders/`; `--force` re-captures and re-renders all
   (do it when the app's UI changed). The web page follows the site's
   feature-page layout (`docs/brief.md`, "Web page"): its chrome comes from
   the brand's `web` block, and its video slot shows a placeholder until the
   brief's `web.video` is set — say so when delivering.

5. **QA.** Run the `rollout-qa` agent: "QA <slug>." It reviews the PDF and
   the web page (served over HTTP, desktop and mobile) and the copy pack; a
   verdict that does not cover all three is incomplete — send it back. Show the user its verdict
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

7. **Deliver.** Report:
   - `output/<slug>/<Feature> One-Pager.pdf`
   - `output/<slug>/web/index.html` (self-contained folder; `page.json` is the
     same content as data for CMS import)
   - `output/<slug>/assets/social/`: the cover and carousel slides
     (1080×1350, plus the carousel as one PDF for LinkedIn), the feature,
     podcast and YouTube thumbnails (1280×720), the email image (1100×600,
     transparent) and the email-signature banner (500×175)
   - `output/<slug>/copy/`: `rollout-copy.md` (subfeature descriptions, page
     header, one-pager intro, email, posts, podcast brief), one `.txt` per
     channel ready to paste, and `email.html`. **Show `rollout-copy.md`
     inline in the chat** (it is what the user pastes from).
   - which scenes were new and which were reused.
   Offer to open the PDF. Publishing anywhere external (a CMS, a
   shared drive, a ticket) only on the user's explicit go-ahead.

## Changing things later

- Copy tweak: edit the brief (or ask the copywriter), then `build`.
- Visual tweak: edit `library/scenes/<id>/scene.json`, `scene <id> --force`,
  then `build`.
- Social image tweak: edit `library/features/<slug>/social.json` (slide
  title accents, crops), then `social <slug>`.
- Email or post tweak: edit `library/features/<slug>/copy.json` (or ask the
  copywriter), then `copy <slug>`. A change to a section's wording belongs
  in the brief, then `build`: the copy pack follows it.
- House style (dashes, banned openers, sign-off, hashtags, bullet markers,
  podcast hosts): the brand's `copy` block in `brand.json`.
- The app changed: `build <slug> --force` re-captures everything.
- Another brand: point `BRAND_DIR` at another folder in `brand/` (or use
  `BRAND_*` overrides) and `build` — layouts and kit scenes re-render in the
  new brand; captures are reused (the app paints itself).
- A standing rule from the user: add it to `docs/rules.md` with why and the date.
