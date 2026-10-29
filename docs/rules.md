# Rules

Standing rules for every rollout. Each has its reason, so edge cases can be
judged. Add new ones with why and the date.

### Generic code, configured brand
No company, product or person is named in `pipeline/`, the kit, the agents or
the skill. Brand facts live in a brand folder's `brand.json`, deployment facts
in `.env`.
*Why:* the pipeline must serve any brand by configuration (2026-10-26).

### Agents write sidecars, the core renders
Agents edit only `library/features/*/brief.json`, `library/features/*/social.json`
and `library/scenes/*`. They
never edit `pipeline/` or hand-edit anything in `output/`.
*Why:* every build must be reproducible from the sidecars alone (2026-10-26).

### Keep every asset
Briefs, scenes and renders stay in `library/`. Reuse or fork a scene before
drawing a new one; never delete a scene another feature uses (`usedBy` in
`library/index.json`).
*Why:* assets are meant for reuse across future rollouts (2026-10-26).

### Ask before applying QA fixes
Show the rollout-qa verdict and proposed fixes; wait for a yes before changing
a brief or scene because of them.

### Live data: look, don't touch
Captures log into real applications. A step that sends, creates, edits or
deletes is marked `"mutates": true` and runs only with `--allow-mutations`,
after the user approved that scene. Never click tracked links.
*Why:* capture accounts are live (2026-10-26).

### Blur personal data
Every contact name, phone number, email and similar is blurred in captures
(target `blurSelectors`, scene `blur`). An unblurred one fails QA. Kit scenes
use invented people only.

### Visuals come from the application
Feature visuals are captured from the logged-in app. Kit-drawn scenes only for
the hero composition and UI that does not exist yet.
*Why:* the user asked for screenshots of the real product (2026-10-26).

### Captures sign in with their own profile
A target uses its own Chrome profile (`profiles/<target>/`, filled by
`node pipeline/rollout.mjs login <target>`), never another project's
signed-in profile.
*Why:* the user asked that captures never share another project's signed-in
profile (2026-10-26).

### All brands live in brand/
One folder per brand under `brand/`, chosen with `BRAND_DIR`.
*Why:* user request (2026-10-26).

### Publish only on request
Uploading outputs anywhere external (CMS, drive, ticket) only when the user
says so for that rollout.

### The web page matches the site's feature pages
Same layout, calls to action, header and footer as the site's existing
feature pages (listed in the local `examples/website.txt`); section visuals are framed 1180x676
web cuts, not the one-pager's GIFs; the top video slot holds a placeholder
image — a screenshot of the feature with a play button — until the feature
video exists. Site chrome lives in the brand's `web` block, including the
integrations logo strip and app-store badges, the only places other
companies' logos may appear (user request, 2026-10-26).
*Why:* the page is integrated into the site as is; the user asked for it to
mimic the existing feature pages (2026-10-26).

### Nothing brand-specific in the repo
Only the fictional example is committed: `brand/example/`, the `demo-app`
target and the `smart-scheduling` feature. Real brands, their targets,
features (input, brief, scenes), renders, `examples/` reference material and
`scratch/` stay on this machine; `.gitignore` allowlists the example and
ignores everything else by default.
*Why:* the user asked that nothing specific to a real company be committed
(2026-10-26).
