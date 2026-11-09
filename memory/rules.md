# Rules

Standing rules for every rollout. Each has its reason, so edge cases can be
judged. Add new ones with why and the date.

### Generic code, configured brand
No company, product or person is named in `pipeline/`, the kit, the agents or
the skill. Brand facts live in a brand folder's `brand.json`, deployment facts
in `.env`.
*Why:* the pipeline must serve any brand by configuration (2026-10-26).

### Agents write sidecars, the core renders
Agents edit only `library/features/*/brief.json`, `library/features/*/social.json`,
`library/features/*/help.json`, `library/features/*/site.json`,
`library/features/*/podcast.json`, `library/features/*/video.json` and
`library/scenes/*`. They
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

### Invented names in captures
Every name and identifier a capture or kit scene shows is invented, on every
screen (target `replaceText`, scene `replace`; `docs/capture.md`, "Personal
data"):
- **Inboxes**: one inbox shows as "Sales Inbox" and one as "Marketing
  Inbox", whichever fits; no other inbox takes either name. Every other inbox
  gets an invented name that fits a business ("Front Desk", "Support Line",
  "Downtown Office").
- **Everything else** — first and last names (with matching initials),
  emails, tags, phone numbers, broadcast and campaign names, agent and user
  names, trigger, workflow, pipeline and segment names, companies, and any
  other label drawn from the account — gets an invented value picked fresh for
  the scene and as true to its context as possible: a tag reads like a sales
  tag ("Hot Lead", "Demo Booked"), a broadcast like a real send ("Spring
  Open House Reminder"), a phone number keeps its country's format.
- One invented name stands for one real one (two real inboxes never both
  show as "Sales Inbox"); `capture` refuses a scene that breaks this.
Replacing is preferred to blurring.
*Why:* the user asked for realistic, readable screens without blur, and for
names that are random yet fit the business (2026-11-08).

### No real names in captures
A real name or identifier (above) that shows in a capture fails QA. Replace
it; blur (target `blurSelectors`, scene `blur`) only what a replacement
can't reach, such as a name inside an image. Kit scenes use invented values
only.
*Why:* updated 2026-11-08 at the user's request: names are replaced, not
blurred, and phone numbers are invented too.

### QA findings become lessons
Every QA FAIL or WARN that was fixed is written up, before the rollout is
called done, as a general lesson in `memory/lessons.md` under the agent that
owns the fix, and every authoring agent reads its section before it starts.
A lesson the pipeline can measure is proposed to the user as a check in
`pipeline/` (with its test), so it is enforced rather than remembered.
Lessons are written for any brand: no company, product, person or account
name in them.
*Why:* the user asked that what QA learns feeds back into the pipeline and
the agents' instructions, so the same defect is not made twice (2026-11-08).

### Visuals come from the application
Feature visuals are captured from the logged-in app. Kit-drawn scenes only for
the hero composition and UI that does not exist yet.
*Why:* the user asked for screenshots of the real product (2026-10-26).

### Never hide conversation history
A capture never hides the messages or history of a conversation (no `hide`
on the message list or timeline). Hiding a small banner over it is fine.
*Why:* the history is what shows the feature in context; the user asked that
it never be hidden (2026-11-08).

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
Uploading outputs anywhere external (CMS, drive, ticket, help center) only
when the user says so for that rollout.

### Help articles: update, don't duplicate
Before creating a help article, look for the one that already covers the
feature and update it. Keep every part of a live article that is not about
the feature, send drafts unless the user says publish, and never overwrite an
article edited in the help center since it was read.
*Why:* the help center is edited by people too, and one feature should have
one article (user request, 2026-10-30).

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
target, the `smart-scheduling` feature and `memory/features/example/`. Real
brands, their targets, features (input, brief, scenes), their memory
(`memory/features/<brand>/`), renders, `examples/` reference material and
`scratch/` stay on this machine; `.gitignore` allowlists the example and
ignores everything else by default.
*Why:* the user asked that nothing specific to a real company be committed
(2026-10-26).
