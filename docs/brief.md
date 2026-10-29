# The brief

`library/features/<slug>/brief.json` holds all the copy of one rollout. Both
outputs are built from it. Limits are enforced by
`node pipeline/rollout.mjs validate <slug>` (`pipeline/brief.mjs` `LIMITS`) —
they are what physically fits the PDF.

```json
{
  "slug": "smart-scheduling",
  "feature": "Smart Scheduling",
  "headline": "Book meetings [right inside] the conversation",
  "intro": "3-4 sentences on what it does, for whom, and the result.",
  "lead": "The web page's line under the headline: the main things it lets you do.",
  "hero": { "scene": "smart-scheduling--hero", "alt": "What the hero visual shows" },
  "sections": [
    {
      "eyebrow": "Coming soon!",
      "title": "Benefit-led title",
      "body": "Two sentences: what the user does and what they get.",
      "short": "One sentence, benefit first.",
      "scene": "smart-scheduling--suggest-times",
      "alt": "What the visual shows"
    }
  ],
  "pill": "#product update",
  "cta": { "title": "", "subtitle": "", "button": "", "url": "" },
  "web": { "video": "https://www.youtube.com/embed/<id>", "poster": "<scene id>", "sectionButton": { "label": "", "url": "" } },
  "seo": { "title": "", "description": "", "url": "/smart-scheduling-updates" }
}
```

| Field | Required | Limit | Notes |
|---|---|---|---|
| `feature` | yes | 60 | Also names the PDF: `<feature> One-Pager.pdf` |
| `headline` | yes | 12–62 | `[words]` render in the brand's primary colour; one or two runs |
| `intro` | yes | 160–540 | Aim for 300–520. The PDF's hero text |
| `lead` | recommended | 60–220 | The web page's line under the headline; aim for 100–200. Falls back to `intro` |
| `hero.scene` | yes | scene id | Usually `<slug>--hero`, transparent background |
| `sections` | yes | 1–8 | 4–5 is the sweet spot (two pages) |
| `sections[].title` | yes | 8–70 | |
| `sections[].body` | yes | 110–330 | Aim for 180–320. The long description: at most 2 sentences (warning) |
| `sections[].short` | recommended | 40–200 | The short description: 1 sentence, benefit first. The copy pack's subfeature list (`docs/copy.md`) |
| `sections[].eyebrow` | no | 24 | Status line above the title |
| `sections[].scene` | yes | scene id | `<feature>--<name>`, may be another feature's scene |
| `*.alt` | recommended | 140 | Web alt text; the designer's spec |
| `pill` | no | 28 | Default: feature.json `pill`, then `TOPIC_PILL` |
| `cta.*` | no | title 64, subtitle 110 | Default: feature.json `cta`, then `CTA_*` in .env |
| `web.video` | no | https URL | Embed URL of the feature video; until set, the video slot shows a poster (`assets/video-poster.png`, 1600×900): the hero composition on the brand's hero gradient with a play button, framed like the section GIFs — no logo, pill or headline |
| `web.poster` | no | scene id | The scene the poster shows; default `hero.scene` |
| `web.sectionButton` | no | | `{label, url}` of every row's button; default the brand's `web.sectionButton` |
| `web.heroButton` | no | | Header button label for brands without a `web` block. Default `WEB_HERO_BUTTON` |
| `seo.title` | no | | Default `<feature> \| <brand name>` |
| `seo.description` | no | 155 | Default: start of the intro |
| `seo.url` | no | path | `/<feature>-updates`, lowercase and hyphenated. Default `/<slug>`. The copy pack's page header |

**The brand's copy rules.** Every text field (headline, intro, lead, section
titles, bodies and shorts, SEO description) is checked against the brand's
`copy.forbidden` (e.g. em and en dashes) and `copy.bannedOpeners` (e.g.
"Introducing"): a hit is a `validate` error. See `docs/copy.md`.

The email, posts and podcast brief are written from this brief into
`copy.json`: `docs/copy.md`.

## What good looks like

The reference layout (the original one-pagers are in `examples/`, local only):

- **Page 1**: hero band — logo top-left, pill top-right, headline (accent
  words) and intro on the left, hero visual on the right over a soft radial
  gradient. Then two feature rows: visual panel left / text right, then text
  left / visual right. Footer: website / phone, centred.
- **Later pages**: up to three alternating rows.
- **Last page**: rows, then the CTA band (title, subtitle, button) and a
  footer with logo, website / phone and social icons.
- Page one holds two rows (one if there are only two sections); later pages
  three; the CTA always shares the last page with at least one row.
- **Web page**: the site's feature-page layout, so it can be dropped into the
  site as is (reference: the site pages listed in `examples/website.txt`, local only):
  - header: logo, contact line, nav (dropdown chevrons), sign-in, two buttons;
  - centred headline (no accent colour) and `lead`;
  - a 16:9 video slot (a poster with a play button until `web.video`);
  - for brands that set it, an "integrations" logo strip;
  - a trial sign-up card;
  - one row per section, visual and text alternating sides: the scene's web
    cut (1180×676 framed GIF, `docs/capture.md`), a centred 40 px title, the
    body, and a trial button;
  - a closing band (cta title, subtitle, button, note) and a column footer
    with copyright and legal links.
  On phones: hamburger menu, a back link, rows stacked with the visual first.

## The brand's web block

Everything on the web page that is the site rather than the feature comes
from `web` in the brand's `brand.json` — labels and links only, never copy:

```json
"web": {
  "header": {
    "contact": { "label": "Questions? Text us", "value": "+1 (555) 010-0199", "url": "sms:+15550100199" },
    "nav": [{ "label": "Platform", "url": "https://…", "menu": true }],
    "signIn": { "label": "Sign In", "url": "https://…" },
    "buttons": [{ "label": "Get a Demo", "url": "https://…", "style": "primary" },
                { "label": "Sign Up", "url": "https://…", "style": "cta" }]
  },
  "back": { "label": "All features", "url": "https://…" },
  "signup": { "title": "Start Your [Free 14-Day] Trial", "subtitle": "…", "placeholder": "Work Email Address*",
              "button": "Get started", "field": "email", "action": "https://…" },
  "sectionButton": { "label": "Start Your 14-Day Trial", "url": "https://…" },
  "integrations": { "title": "…", "subtitle": "…", "logos": [{ "src": "https://…", "alt": "…" }] },
  "closing": { "note": "Still have questions? Text us: …" },
  "footer": {
    "columns": [{ "title": "Product", "links": [{ "label": "…", "url": "…", "badge": "NEW" }] }],
    "apps": [{ "src": "…", "alt": "…", "url": "…" }],
    "copyright": "Company, Inc. All rights reserved.",
    "legal": [{ "label": "Terms of Use", "url": "…" }]
  }
}
```

`titleCase: true` sets the page's headline and section titles in headline
style ("Turn Every Rating into the Right Follow-Up") when the site does; the
brief keeps sentence case. `[words]` in `signup.title` render in the CTA colour. `integrations` and
`footer.apps` are optional; their `src` is a file in the brand folder (copied
into the page's `assets/brand/`) or a URL. They are the only places other
companies' logos may appear. A brand without a `web` block still builds: header from
`nav`, footer from `nav` and `legal`.
