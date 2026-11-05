# Search and answer engines (SEO and AEO)

Every page a rollout puts on the website — the feature page, as a CMS item or
a page of components, the podcast episode page and the feature video's page —
is written to be found
by search engines (SEO) and quoted by answer engines: AI search and
assistants that answer a question with a passage from a page (AEO). The
rules live in `pipeline/seo.mjs`; the copywriter writes for them, the
publishing agents carry them to the site, and the pipeline checks them.

## The rules

| What | Rule | Why |
|---|---|---|
| Keyword | `seo.keyword` in the brief: the words people search for the feature by; default the feature's name | One subject per page, named the way customers name it |
| SEO title | 30–60 characters, the keyword first, the brand last (`Smart Scheduling: Book Meetings Over Text \| Acme`) | Search results cut titles after about 60 characters |
| Meta description | 120–160 characters, names the keyword, says what the feature does for the reader; not the title again | Results show about 160 characters |
| Heading | One `<h1>` per page, the page's title; rich text uses `<h2>`/`<h3>`. On a CMS template that styles rich-text headings by tag, new items match the existing items' tag, and an `<h1>` there is a template fix (its text styles give `<h2>`/`<h3>` the same look), not a content change | Several `<h1>`s blur what the page is about; a tag swap alone changes the design |
| Lead | Answer-first: the first sentence says what the feature is and does, naming it ("Smart Scheduling books meetings inside the text thread…") | Answer engines quote the first direct answer they find |
| FAQ | 3–8 questions customers ask, each ending in "?"; each answer 40–320 characters, starts with the answer, and makes sense quoted alone | Answer engines quote short, self-contained answers |
| Alt text | Every image: what it shows, in a sentence, 10–125 characters; never a file name or "image of…" | Screen readers, image search, and engines that read images through their alt |
| Address | The slug carries the keyword, six words at most | Readable, stable addresses |
| Canonical | The page says its own address (`<link rel="canonical">`) | One address per page, no duplicates |
| Link preview | One `og:image`: the page's own | Several make previews pick one at random |
| Structured data | JSON-LD: `WebPage` + `SoftwareApplication` (the feature) + `FAQPage` (+ `VideoObject` with a video) on the feature page; `PodcastEpisode` (with its transcript) on the episode page | Tells engines what the page is about, its questions and answers, and what the episode says |

Malformed data (an FAQ entry without an answer, JSON-LD that does not parse)
is an error; everything else is a warning — SEO never blocks a build.

## Where each rule is applied

| Stage | What |
|---|---|
| Copywriter (`brief.json`) | `seo.keyword`, `seo.title`, `seo.description`, the answer-first `lead`, `faq`, every `alt` |
| `validate` | the brief's SEO text, FAQ and alt text (`pipeline/brief.mjs`) |
| `build` | the web page: canonical (`web.pageUrl` in the brand, e.g. `https://www.acme.example/features/{slug}`), one `<h1>`, the FAQ section, JSON-LD in the head; `page.json` carries `keyword`, `url`, `faq` and `structuredData` for the publisher |
| `qa` | the built page as an engine reads it (`seo` findings in `qa.json`) |
| Web publisher (`site.json`) | the item's or page's SEO fields from the brief, alt text on every image, rich-text headings in the existing items' tag, the FAQ where the template has a place for it, JSON-LD as page code on a page of components; `site-plan` warns on each |
| Podcast producer (`podcast.json`) | the episode page's SEO title and description, image alt text, the transcript; `podcast-check`-style validation warns on each |
| Web publisher (`video.json`) | the video page's meta title and description, its slug, the cover and thumbnail alt text, the transcript; `video-plan` warns on each (`docs/video.md`) |
| `seo <slug> [--live] [--url <url>]` | all of the above for one feature, the JSON-LD for its feature and episode pages written to `output/<slug>/seo/`, and with `--live` (the recorded published pages) or `--url` the pages as served — read only |

## Structured data on CMS pages

A CMS item cannot carry code of its own: its structured data comes from the
collection's template page. Once per template, someone with design access
adds an embed to the template's head that builds the JSON-LD from the item's
fields — the shape is `output/<slug>/seo/feature.jsonld.json` (feature
template) or `episode.jsonld.json` (podcast template), with each value bound
to its field. The agents never change templates (`docs/website.md`); `seo
--live` reports a template without structured data, an empty `<h1>`, or a
second `og:image` coming from the site's own head code, for a person to fix.

## Checking a published page

```
node pipeline/rollout.mjs seo <slug> --live
```

prints, for the brief, the website plan, the episode page and each published
page, what to fix, and saves it all in `output/<slug>/seo/seo.json`. A page
that does not answer (HTTP error) or whose JSON-LD does not parse fails the
command.
