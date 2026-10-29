# The copy pack

Beside the one-pager, the web page and the social images, every rollout gets
its written launch copy, built by `pipeline/copy.mjs` into
`output/<slug>/copy/` from the brief and one sidecar,
`library/features/<slug>/copy.json`, which the `rollout-copywriter` writes
after the brief. `node pipeline/rollout.mjs build <slug>` makes the pack
whenever the sidecar exists (after the social pack, whose images the posts
attach); `node pipeline/rollout.mjs copy <slug>` remakes only the pack.

The pack is made from the brief, so it says what the one-pager says: the
subfeature descriptions, page header and intro come straight from it, and the
email, posts and podcast brief are written from it.

## What it makes

| File | What |
|---|---|
| `rollout-copy.md` | Everything below in order, separated by `---`, ready to paste: 1 subfeature descriptions (title, short, long), 2 rollout page header (headline, SEO URL, subheadline, meta description), 3 one-pager intro, 4 email announcement, 5 social posts (each with the image to attach), 6 podcast brief |
| `email.txt` | Subject, preview and body |
| `email-list.txt` | The second email (when `listEmail` is set): an intro, the sections as a numbered list (title: short description), a closing |
| `email.html` | The same email laid out for an email tool: the social pack's email image, the paragraphs, a CTA button in the brand's CTA colour, the sign-off |
| `feed.txt`, `instagram.txt`, `x.txt`, `in-app.txt` | One post per channel, composed and ready to paste |
| `podcast-brief.md` | The brief the hosts record from |
| `copy.json` | What was built |

| From the brief | Pack item |
|---|---|
| `sections[].title`, `short`, `body` | Subfeature title, short description (1 sentence), long description (at most 2) |
| `headline` (without accents), `seo.url`, `lead`, `seo.description` | Page header: headline, SEO URL, subheadline, meta description |
| `intro` | One-pager intro |

## copy.json

```json
{
  "link": "https://…",
  "email": {
    "subject": "📅 Book meetings right inside the conversation",
    "preview": "One sentence: the top capabilities.",
    "opener": "One line naming the problem the feature solves.",
    "paragraphs": ["What users can now do.", "Secondary capabilities or use cases."],
    "closing": "Benefit summary framing the CTA.",
    "cta": { "label": "See how it works", "url": "https://…" }
  },
  "headers": {
    "video": { "headline": "", "subheadline": "", "description": "" },
    "podcast": { "headline": "", "subheadline": "", "description": "" }
  },
  "listEmail": { "subject": "✨ 5 ways …", "preview": "", "intro": "", "closing": "" },
  "posts": {
    "feed": { "hook": "", "intro": "", "bullets": [], "closing": "", "cta": "See how it works:", "hashtags": [], "image": "cover" },
    "instagram": { "hook": "", "intro": "", "closing": "", "hashtags": [], "image": "slides" },
    "x": { "hook": "", "bullets": [], "cta": "See how:", "hashtags": [], "image": "feature" },
    "inApp": { "intro": "", "bullets": [], "closing": "", "cta": "", "image": "feature" }
  },
  "podcast": {
    "title": "", "status": "", "duration": "",
    "description": "", "audience": "",
    "value": { "proposition": "", "before": "", "after": "" },
    "steps": ["", "", "", ""],
    "standout": [], "useCases": { "primary": "", "secondary": [] },
    "focus": [], "talkingPoints": [], "questions": [], "tone": "",
    "cta": { "text": "", "resources": [{ "label": "", "url": "" }] },
    "hosts": [{ "focus": [] }, { "focus": [] }]
  }
}
```

| Field | Default | Checked by `validate` |
|---|---|---|
| `link` | the brief's `cta.url` | a URL, or a placeholder such as `[link]` until the page is published (a warning; X counts it as a link) |
| `headers.video`, `headers.podcast` | none | optional: the video and podcast pages' `headline`, `subheadline` and `description` (meta), listed after the web page's (the brief's) in the page header; description ≤ 160 |
| `email.subject` | | required; aim for ≤ 60 characters, error over 78 |
| `email.preview` | | required, 1 sentence; aim for ≤ 110, error over 140 |
| `email.opener`, `closing` | | required |
| `email.paragraphs` | | 2 (1–3) |
| `email.cta` | the brief's CTA button and `link` | `url` must be http(s) |
| `email.sender`, `signoff` | brand `copy.sender`, `copy.signoff` | |
| `listEmail` | none | optional; `subject`, `preview`, `intro`, `closing` required when set; the list is the brief's section titles and short descriptions |
| `posts.inApp.title` | none | optional; the post's title line |
| `posts.feed` (Facebook / LinkedIn) | | `hook`; 4–5 bullets, 4–5 hashtags; ≤ 3000 characters |
| `posts.instagram` | | `hook`; 4–5 hashtags; ≤ 2200; shorter than the feed post |
| `posts.x` | | `hook`; 2–3 hashtags; ≤ 280 as X counts them (a link is 23, an emoji 2) |
| `posts.inApp` | | `intro`; 3–5 bullets |
| `posts.*.hashtags` | brand `copy.hashtags` (not in-app) | written without `#` or with it |
| `posts.*.image` | feed `cover`, instagram `slides`, x and inApp `feature` | one of `cover`, `slides`, `carousel`, `feature`, `podcast`, `youtube`, `email`, `none` (`docs/social.md`) |
| `podcast.*` | | all required; `description` 3–4 sentences, `steps` 4, `focus` 3–4, `useCases.secondary` 2–3, one `hosts` entry per brand host |

Every text is also checked against the brand's `copy.forbidden` and
`copy.bannedOpeners`, as the brief is.

### How a post is composed

The copywriter writes the parts; `copy.mjs` puts them together with the
brand's markers, so every rollout's posts look the same:

| Channel | Composed as |
|---|---|
| feed | hook · intro · bullets (marker `copy.bullets.feed`) · closing · `ctaPrefix` cta link · hashtags |
| instagram | hook · intro · bullets · closing · `ctaPrefix` `copy.linkInBio` · hashtags |
| x | hook · bullets (`copy.bullets.x`) · `ctaPrefix` cta link · hashtags |
| inApp | `copy.greeting` · intro · bullets · closing · cta (no link) |
| email | opener · paragraphs · closing · `ctaPrefix` CTA label + link · sign-off |

## The brand's copy block

`brand.json` `copy` holds the house style. Everything is optional.

```json
"copy": {
  "sender": "Team Acme Cloud",
  "signoff": "The Acme Cloud Team",
  "ctaPrefix": "👉",
  "linkInBio": "Link in bio",
  "greeting": "Hi {{First Name}},",
  "bullets": { "feed": "🔷", "instagram": "🔷", "x": "✅", "inApp": "🔷" },
  "hashtags": ["AcmeCloud", "ProductUpdate"],
  "forbidden": ["—", "–"],
  "bannedOpeners": ["Introducing", "We're excited to", "Today we're announcing"],
  "labels": { "inApp": "In-app post" },
  "podcast": { "hosts": [{ "label": "Host A", "persona": "…" }, { "label": "Host B", "persona": "…" }] },
  "notes": ["Titles start with an action verb.", "Address the reader as you and your team."]
}
```

| Key | Default | Use |
|---|---|---|
| `sender`, `signoff` | brand name, "The <name> Team" | Email |
| `ctaPrefix` | none | Before every CTA line |
| `linkInBio`, `greeting` | "Link in bio", "Hi {{First Name}}," | Instagram CTA, in-app opener |
| `bullets` | `•` | Bullet marker per channel |
| `hashtags` | none | Posts that set none |
| `forbidden` | none | Strings no brief or copy text may contain: an error in `validate` and QA |
| `bannedOpeners` | none | Openers no text may start with: an error |
| `labels` | Facebook / LinkedIn, Instagram, Twitter / X, In-app post | Headings in `rollout-copy.md` |
| `podcast.hosts` | two unnamed hosts | The podcast brief's host focus areas |
| `titleCase` | the brand's `web.titleCase` | Section titles and headlines in headline style in the pack |
| `notes` | none | House rules the copywriter follows and QA reviews (not machine-checked) |

The brand's `voice` (tone) applies to the copy pack as to the brief.
