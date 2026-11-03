# The social pack

Beside the one-pager and the web page, every rollout gets the launch images
for social posts, email and video, built by `pipeline/social.mjs` into
`output/<slug>/assets/social/` from one sidecar,
`library/features/<slug>/social.json`, which the `rollout-visual-designer`
writes. `node pipeline/rollout.mjs build <slug>` makes the pack whenever the
sidecar exists; `node pipeline/rollout.mjs social <slug>` remakes only the
pack.

The pack is made from the rollout's own assets, so it reads as part of the
same launch: the brief's headline and sections, the hero composition
(`hero.scene`) and the same section stills the PDF shows, in the one-pager's
look — the hero band, soft surface panels, the solid primary-colour pill (as
on the PDF). It never adds copy of its own, and keeps copy on the images
short: a headline or a slide title, never a paragraph.

## What it makes

PNGs are rendered at `STILL_SCALE` (default 2), so a 1080×1350 slide is a
2160×2700 file. Names carry the logical size.

| File | Size | Use | Layout |
|---|---|---|---|
| `slide-1-cover-1080x1350.png` | 1080×1350 | Facebook, X; carousel slide 1 | hero band, logo and pill, the brief headline left-aligned, the hero composition below it, website and "N ways it helps →" |
| `slide-<n>-1080x1350.png` | 1080×1350 | Carousel slides 2…, one per section (Instagram, LinkedIn) | white page, logo and step counter (`01 / 05`), feature-name pill, a short section title, the section still on a surface panel that fits it, website and progress dots |
| `carousel-1080x1350.pdf` | 1080×1350 pages | LinkedIn document post | the cover and the slides, one page each |
| `feature-1280x720.png` | 1280×720 | Landing page / feature thumbnail | the one-pager's hero band: logo, pill, headline left, hero composition right; no lead under the headline |
| `podcast-1280x720.png` | 1280×720 | Podcast / video thumbnail | logo, pill, the hero composition in a framed card with a play button (`podcast.play`); no headline — the episode title sits beside the image |
| `youtube-1280x720.png` | 1280×720 | YouTube thumbnail | feature-name pill and a large headline, the whole hero composition on the right (never cut at the edge), logo bottom left |
| `email-1100x600.png` | 1100×600 | Email body image | the hero band, opaque: logo, pill, headline left, hero composition right |
| `signature-500x175.png` | 500×175 | Email signature banner | logo, headline and a CTA-coloured button in one left-aligned column, and beside it a crop of the hero (`signature`), so it reads as the same campaign |
| `social.json` | | | what was built, with each file's use |

## social.json

```json
{
  "name": "Smart Scheduling",
  "signature": { "crop": [0.1, 0, 0.6, 0.5] },
  "button": "See how it works",
  "podcast": { "play": [0.5, 0.5] },
  "slides": [
    { "section": 0, "title": "Offer [open times] without leaving the thread", "panel": { "crop": [0, 0, 1, 0.8] } }
  ]
}
```

| Field | Default | Notes |
|---|---|---|
| `name` | brief `feature` | The slides' and YouTube pill |
| `pill` | brief `pill`, then the brand's `pill` | Cover, feature, podcast pill |
| `headline` | brief `headline` | `\n` breaks a line (ignored by the signature) |
| `button` | brand `socialPack.button`, then `cta.heroButton` | The signature's button |
| `hero` | brief `hero.scene` | The composition every wide format and the cover show. It must carry the feature's core idea (the visual designer's hero rules) |
| `signature` | the hero | `{ "crop": [x, y, width, height] }` of the hero still (preferred: the campaign's own image), or a kit scene id, 224×159, transparent |
| `podcast.play` | `[0.5, 0.5]` | The play button's centre, fractions of the card: put it on a quiet part of the hero, never over text |
| `slides[]` | one per section | `section` is the brief section index |
| `slides[].title` | the section title | A short title, 60 characters at most, with one or two `[accent]` runs |
| `slides[].body` | none | Only when a slide needs one line under its title; 140 characters at most |
| `slides[].panel.scene` | the section's scene | |
| `slides[].panel.crop` | whole still | `[x, y, width, height]`, fractions of the still: cut the empty page so the panel shows what the title is about |
| `formats` | all | Which formats to make |

Validation (`rollout.mjs validate <slug>`) checks crops, the signature and
play button, accent brackets and title and body length.

## Brand

`brand.json` may hold a `socialPack` block of defaults:
`{ "button": "See how it works" }`. Colours, fonts and the logo come from the
brand like every other output; the signature's button uses the CTA colour,
the one call to action on it.
