# The help article

Beside the one-pager and web page that sell a feature, a rollout can carry
the help-center article that teaches it. The `rollout-help-writer` agent
writes it as a sidecar, `library/features/<slug>/help.json`;
`pipeline/help.mjs` renders it into `output/<slug>/help/`; and, on the
user's approval, `pipeline/helpcenter.mjs` creates the article in the help
center or updates the one that already covers the feature, over the help
center's REST API.

`node pipeline/rollout.mjs build <slug>` makes the article whenever the
sidecar exists; `node pipeline/rollout.mjs help <slug>` remakes only the
article. Neither sends anything; only `help-publish` does.

| Command | Does |
|---|---|
| `help <slug>` | Builds `output/<slug>/help/` |
| `help-center` | Checks the connection; lists authors (`HELP_AUTHOR_ID`) and collections |
| `help-find <slug> [<words>]` | Articles that may already cover the feature, drafts included, with the collection each is in |
| `help-get <slug> <id>` | Reads a live article into `output/<slug>/help-live/<id>.json`: its HTML body and `updatedAt` |
| `help-publish <slug> --yes [--state draft\|published] [--live]` | Builds, then creates or updates the article, and records it in `help.published.json` |

## What it makes

| File | What |
|---|---|
| `article.html` | The body exactly as it is sent, in the markup the help center keeps as is (below) |
| `article.json` | Title, description, `action` (create or update), where it goes (`publish`), the live article (`live`), its images, and `blockers` to publishing |
| `preview.html` | The article as a page with local images, to read before it is sent |
| `images/` | The scene stills (or GIFs) it shows |

## help.json

```json
{
  "title": "Smart Scheduling",
  "description": "Offer open times in a text conversation and let customers book without leaving the thread.",
  "intro": [
    "What it does, who it is for, where it lives in the app.",
    { "image": "smart-scheduling--suggest-times", "alt": "The hero visual" }
  ],
  "sections": [
    {
      "heading": "Getting started",
      "level": 1,
      "blocks": [{ "p": "What this section achieves." }]
    },
    {
      "heading": "Step 1: Connect a calendar",
      "level": 2,
      "blocks": [
        { "p": "Text with **bold**, *italic* and [links](https://…)." },
        { "steps": ["Go to **Settings > Scheduling**.", "…"] },
        { "bullets": ["**Option**\nwhat it does."] },
        { "image": "smart-scheduling--calendars", "alt": "What it shows" },
        { "image": "https://…/existing.png", "alt": "An image already in the live article" },
        { "video": "https://www.youtube.com/embed/<id>" },
        { "note": "A caveat, rendered as a Note: line." },
        { "table": { "head": ["Status", "Meaning"], "rows": [["Booked", "…"]] } }
      ]
    }
  ],
  "faq": [{ "q": "Which calendars can I connect?", "a": "Google and Microsoft calendars." }],
  "publish": {
    "articleId": "123456",
    "state": "draft",
    "updatedAt": 1761800000
  }
}
```

| Field | Limit | Notes |
|---|---|---|
| `title` | 3–80 | Default: the brief's `feature` |
| `description` | 20–160 | The line under the title in the help center |
| `intro` | | Paragraphs (strings) or blocks before the first heading: the hero image goes here |
| `sections[].heading` | 90 | |
| `sections[].level` | 1–3 | 1: a section (`h2` under a divider; default); 2: a step (`h3`); 3: a sub-topic (`h4`). The first section is level 1 |
| `sections[].blocks` | | One key each: `p`, `steps`, `bullets`, `image`, `video`, `note`, `table`. May be empty for a section that holds only steps |
| `image` | | A scene id (copied into `images/`) or the https URL of an image already in the live article. A scene shows its GIF; `"animated": false` its still |
| `width` | px | Display width of an image, when its true screen size reads too large (the height follows). For a live-article URL, `width` and `height` keep its size |
| `alt` | 140 | |
| `video` | | Embed URL from YouTube, Vimeo, Wistia, Loom, Vidyard or StreamIO; any other fails the request |
| `faq[]` | | `q` and `a`; rendered under the brand's `faqTitle` |
| `cta`, `closing` | | Override the brand's; `false` leaves them out |
| `publish.articleId` | | The existing article to update. Default: the one in `help.published.json`; none means create |
| `publish.state` | draft, published | What a publish sends. Draft unless the user says published |
| `publish.authorId` | | Default `HELP_AUTHOR_ID`; required to create |
| `publish.parentId` | | Collection id a new article is filed in, chosen by the agent from context (below). Default `HELP_COLLECTION_ID`. An update never moves the article |
| `publish.updatedAt` | | The article's `updatedAt` from `help-get`: a publish stops if it changed since |

Inline markup is `**bold**`, `*italic*`, `[text](https://… or mailto:…)` and
a line break (`\n`); everything else is escaped.

The body follows the house style of the existing articles (the examples in
the local `examples/help.txt`), in markup the help center keeps:

- the trial link is the only `h1`, centred;
- a divider (`<hr>`) before every level-1 section, the FAQ and the closing;
  sections are `h2`, steps `h3`, sub-topics `h4`, all bold; the FAQ and
  closing headings are `h2`;
- paragraphs have no margin in the help center, so a blank paragraph spaces
  the blocks and sits above and below every image (none after a heading
  before text, none before a divider). It holds a zero-width space: the help
  center drops an empty paragraph sent over its API;
- each scene image is framed: drawn on white, `HELP_FRAME_PAD` px (default
  24) inside a thin rounded border (`HELP_FRAME_RADIUS`, default 12;
  `HELP_FRAME_BORDER`, default `WEB_FRAME_BORDER`) that is part of the
  image, since the help center keeps no CSS border;
- each image sits in the help center's own container
  (`<div class="intercom-container">`) with `width`, `height` and
  `style="height: auto;"`: its true screen size — a GIF as recorded (1x), a
  still at half its pixels (`STILL_SCALE`), frame included — scaled down to
  the column by the help center. Images narrower than 640px (UI panels) are centred
  (`intercom-align-center`);
- `ol`/`ul` with plain `li`, `table` of plain rows (a header row is a row in
  bold: `thead` and `th` are not kept), an `iframe` for video, `b`, `i`,
  `a`, `br`. Any other `div` or unknown tag would become a paragraph.

Validation (`rollout.mjs validate <slug>`) checks lengths, levels, block
shapes, links, and that every scene exists.

`library/features/<slug>/help.published.json` is written by the pipeline
after each publish — article id, URL, state, `updatedAt`, and `images`: the
help center's copy of each image file, with the file's content hash — so the
next publish updates the same article and reuses the images. Never edit it by
hand.

## Images

There is no upload in the articles API: the help center fetches each image
from its `src` URL when the article is sent and serves its own copy (PNG,
JPEG, SVG or GIF; a full public URL). So the images must be reachable only
while the article is sent.

After each publish, `help-publish` reads the article back and records the
help center's copy of each image in `help.published.json`, against the
image file's content hash. Later builds use that copy for every image whose
file is unchanged, so only new or changed images need hosting
(`article.json` `images[].reused`). An image the help center did not copy is
not recorded, and is sent again next time.

New or changed images need hosting while the article is sent, one of three
ways:

1. **An image store** (`HELP_IMAGE_STORE=s3`): `help-publish` uploads each
   one to the bucket, then builds the body again with links to them, then
   sends it. The help center copies them from there. The build marks them
   `upload: true` in `article.json` and does not block on them.
2. **Your own hosting** (`HELP_IMAGE_BASE_URL` with no store): host
   `output/<slug>/help/images/` at `<base>/<slug>/` while publishing; the body
   points there.
3. **Neither**: each one is a visible `[Image: …]` placeholder,
   `article.json` lists it as a blocker, and the article may be sent only as
   a draft for an editor to add the images in the help center.

Images already in a live article stay as their help-center URLs.

### The image store

`pipeline/imagestore.mjs` uploads to the adapter `HELP_IMAGE_STORE` names in
`pipeline/imagestore/` (`s3`: Amazon S3, or any S3-compatible store through
`HELP_IMAGE_ENDPOINT`). Requests are signed with Signature V4 — no SDK.

- **Keys** carry the file's content hash:
  `<HELP_IMAGE_PREFIX>/<slug>/<scene>.<hash>.png` (prefix default `help`).
  An object never changes once written, so an image already there is not
  uploaded again, and no cache can serve an old picture.
- **Links** are presigned GET URLs valid `HELP_IMAGE_URL_TTL` seconds
  (default 86400, at most 7 days), so the bucket stays private: the help
  center reads each image once, when the article is sent, and serves its own
  copy after. With `HELP_IMAGE_BASE_URL` set as well, the objects are linked
  as `<base>/<slug>/<object>` instead — for a public bucket or a CDN in front
  of the prefix.
- **Credentials**: `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (and
  `AWS_SESSION_TOKEN`) in `.env`, else the keys of profile `AWS_PROFILE`
  (default `default`) in `~/.aws/credentials`. They need `s3:PutObject` and
  `s3:GetObject` on the prefix (`s3:ListBucket` too, or a missing object
  reads as forbidden and is simply uploaded).
- **Region**: `HELP_IMAGE_REGION`, else `AWS_REGION`, else the profile's
  region in `~/.aws/config`, else `us-east-1`.

Uploads happen only in `help-publish --yes`, before the article is sent.
The objects are not deleted afterwards: they are small, and once the help
center has its copy nothing links to them.

## Updating an existing article

The agent searches the help center (`help-find`) for an article that already
covers the feature. When the feature is part of a broader article, it reads
the article (`help-get`), converts the whole body into help.json, keeps every
section that is not about the feature (and its images, by URL), and revises
or adds only the ones that are. It reports which sections it added, changed
and kept.

`help-publish` refuses, with the reason, when sending would lose someone's
work or publish what was not approved:

- the article changed in the help center since it was last read (its
  `updatedAt` is newer than `publish.updatedAt` and the last publish);
- the article is published and `--live` is missing: an edit to a published
  article goes live at once — the API has no separate draft of a live
  article — and sending it as a draft would unpublish it, so that is refused
  outright;
- placeholder images in anything that is or would become published;
- a create with no author.

## Choosing the collection

The agent files each new article where customers would look for it: the
collection most of the closest related articles share (`help-find` shows
each article's collection), preferring the most specific one, and never a
news, getting-started or FAQ collection for a feature how-to. It reports the
choice, the reason and the runner-up before anything is sent.
`HELP_COLLECTION_ID` is only the fallback when nothing fits.

## Brand

`brand.json` may hold a `help` block: the parts every article has, kept out
of help.json.

```json
"help": {
  "provider": "intercom",
  "cta": { "label": "Start your free 14-day trial", "url": "https://…" },
  "faqTitle": "Frequently Asked Questions",
  "closing": { "title": "Need Help?", "body": "Chat with us or email [support](mailto:…)." }
}
```

`cta` is a centred heading link above the intro; `closing` is the last section;
`provider` is the help center, unless `HELP_CENTER` names another.

## The help center connection

Set in `.env`:

| Key | |
|---|---|
| `HELP_CENTER` | The adapter in `pipeline/helpcenter/`: `intercom`. Default: the brand's `help.provider` |
| `HELP_CENTER_TOKEN` | An access token that can read and write articles (Intercom: Developer Hub, your app, Authentication) |
| `HELP_CENTER_API_URL` | Default `https://api.intercom.io`; EU `https://api.eu.intercom.io`, AU `https://api.au.intercom.io` |
| `HELP_CENTER_API_VERSION` | The `Intercom-Version` header, default `2.14` |
| `HELP_AUTHOR_ID` | From `help-center` |
| `HELP_COLLECTION_ID` | Optional fallback collection (from `help-center`) |
| `HELP_IMAGE_STORE` | Where new images are uploaded while publishing: `s3`. Empty: none (see Images) |
| `HELP_IMAGE_BUCKET`, `HELP_IMAGE_REGION`, `HELP_IMAGE_PREFIX`, `HELP_IMAGE_ENDPOINT`, `HELP_IMAGE_URL_TTL` | The store's bucket, region, key prefix, S3-compatible endpoint and link lifetime |
| `HELP_IMAGE_BASE_URL` | Public base URL of the images: the store's prefix, or your own hosting |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_PROFILE` | The store's credentials (or `~/.aws/credentials`) |

`node pipeline/rollout.mjs help-center` proves the token works and finds the
ids: the author is a teammate's id (Intercom's `author_id`), and it lists
every teammate, marking the one the token belongs to — usually the one to
use. Collection ids are listed below them. Another help
center is another adapter with the same calls (`find`, `get`, `create`,
`update`, `me`, `authors`, `collections`), listed in `helpcenter.mjs`.
