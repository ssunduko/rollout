# The podcast episode

Each rollout can have a podcast episode: the show's two hosts talking through
the feature, made from the feature's video. The `rollout-podcast-producer`
agent plans it in `library/features/<slug>/podcast.json` and writes its script —
the two hosts' lines, from the brief and the video; the pipeline transcribes
the video and has the studio voice the script into an MP3; a person uploads
it to the show in the directory's own app (Spotify for Creators — it has no
upload API); the pipeline then finds it on the directory, and the agent builds
the website episode page from it.

Nothing costs credits or leaves the machine without the user's approval:
the script is read and approved before it is voiced, voicing spends studio
credits (`podcast --yes`), and the upload to the show is done by hand.
The website episode page is a draft CMS item the user publishes.

## How it works

| Step | Who | What |
|---|---|---|
| plan | agent | reads the brief and the website's recent episodes (`podcast-site`, which also saves the newest published transcripts to `output/<slug>/podcast/reference/` as the style to match), writes `podcast.json` |
| transcribe | pipeline | `podcast-transcribe <slug>`: the video, read from Drive (as the person who ran `google-login`, or a service account) and sent to the studio's speech to text — never saved — → `output/<slug>/podcast/video-transcript.json` |
| script | agent | writes the conversation in `script.lines` from the brief, the video transcript and the instructions; `podcast-script <slug>` shows it as the hosts say it, with its length, for the user to read |
| produce | pipeline | `podcast <slug> --yes`: the studio voices the script in parts of up to about 2,000 characters (Text to Dialogue), each conditioned on the parts before it; the pipeline joins them into `episode.mp3` and writes the transcript (`transcript.html` / `.txt` / `.json`) — the script as said |
| upload | person | in the show's app (Spotify for Creators): a new episode with `episode.mp3`, the social pack's podcast image, and `podcast.json`'s episode title and description; publish it there |
| find | pipeline | `podcast-find <slug>`: the published episode on the directory, by title → its link and embed URL |
| page | agent | `podcast-site-assets --yes`, then the episode page as a draft CMS item (Webflow MCP server), linked from the feature page; `podcast-site-record` |

Every step is recorded in `library/features/<slug>/podcast.published.json`:
`video` (which file, which version), `studio` (each voiced part; a run that stops resumes
with the parts it has, and voicing a changed script again needs `--force`),
`directory` (link and embed) and `site` (the episode page and its assets).

## The services

Each is an adapter folder, chosen in `.env`; nothing else names a provider.

| Role | `.env` | Adapter | Keys |
|---|---|---|---|
| video source | `PODCAST_VIDEO_SOURCE=gdrive` | `pipeline/videosource/gdrive.mjs` | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN` (from `google-login`); or `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` |
| studio | `PODCAST_STUDIO=elevenlabs` | `pipeline/podcaststudio/elevenlabs.mjs` | `ELEVENLABS_API_KEY` (Voices read, Speech to Text, Text to Speech), `ELEVENLABS_HOST_VOICE_ID` / `_NAME`, `ELEVENLABS_GUEST_VOICE_ID` / `_NAME`; optional `ELEVENLABS_MODEL_ID`, `ELEVENLABS_STT_MODEL`, `ELEVENLABS_API_URL` |
| directory | `PODCAST_DIRECTORY=spotify` | `pipeline/podcastdirectory/spotify.mjs` | `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_SHOW_ID`; optional `SPOTIFY_MARKET` |
| website | (the website's) | `pipeline/website/webflow.mjs` | `WEBFLOW_PODCASTS_COLLECTION_ID` |

`node pipeline/rollout.mjs podcast-check` tests all of them and lists the
studio's voices and the directory's show.

### Setting them up

- **Video source (Google Drive).** Two ways to sign in; either reads with
  `drive.readonly`, into memory, and sends the video to the studio
  (`PODCAST_VIDEO_MAX_MB`, default 2048, caps its size).
  - *As a person* (reads whatever that account can see; nothing to share).
    In a Google Cloud project, enable the Drive API; under APIs & Services >
    OAuth consent screen, choose **Internal** if the project belongs to your
    Google Workspace (an External app left in "Testing" issues sign-ins that
    expire after 7 days); under Credentials, create an OAuth client ID of type
    **Desktop app**. Put its client id and secret in `GOOGLE_OAUTH_CLIENT_ID`
    / `_SECRET` and run `node pipeline/rollout.mjs google-login`: it opens
    Google's sign-in, receives the code on `http://127.0.0.1:8766/callback`
    (`GOOGLE_OAUTH_REDIRECT_URI`) and saves `GOOGLE_OAUTH_REFRESH_TOKEN` in
    `.env` without printing it. A refresh token wins over a service account.
  - *As a service account* (unattended; reads only what is shared with it).
    Create a service account and a JSON key for it, and save the key outside
    the repo; `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` is its path. Share the folder
    with the feature videos with the service account's email (Viewer).
- **Studio (ElevenLabs).** An API key with Voices read, Speech to Text and
  Text to Speech access (Text to Dialogue; the Studio podcast API, which
  writes the conversation itself, needs an allowlisted account and is not used).
  The show's two fixed voices: `podcast-check` lists the account's voices;
  put the host's and the guest's ids and the names the transcript shows
  (the hosts' first names) in `.env`. Without a guest voice, the host reads
  every line. A voice from the Voice Library must be added to the account
  ("Add to my voices") before it can be used. `ELEVENLABS_MODEL_ID` (default
  `eleven_v3`) is the voice model.
- **Directory (Spotify).** An app at developer.spotify.com (no redirect
  needed: the Client Credentials flow reads public data). `SPOTIFY_SHOW_ID` is
  the show's id from its `open.spotify.com/show/<id>` link. Spotify's Web API
  answers only when the app's owner has an active Spotify Premium
  subscription (otherwise 403, "Active premium subscription required"; after
  subscribing it can take a few hours). The show itself is hosted on Spotify
  for Creators, where episodes are uploaded by hand.

## podcast.json

```json
{
  "video": { "file": "https://drive.google.com/file/d/<id>/view", "speakers": 1 },
  "episode": {
    "number": 23,
    "title": "Episode 23: Book the Right Time in One Tap",
    "description": "Show notes, 2–4 sentences.",
    "tags": ["scheduling", "sms"],
    "image": "assets/social/podcast-1280x720.png"
  },
  "script": {
    "instructions": "Two hosts walk a sales team through …; upbeat, practical.",
    "notes": "Facts and limits the hosts must respect.",
    "minutes": 8,
    "intro": "Welcome to …",
    "lines": [
      { "speaker": "guest", "text": "So you just tell it what you need?" },
      { "speaker": "host", "text": "[laughs] Exactly. You ask, and it books the time." }
    ],
    "outro": "That is it for this episode …",
    "language": "en"
  },
  "site": {
    "fields": {
      "name": "Episode 23: Book the Right Time in One Tap",
      "slug": "episode-23-smart-scheduling",
      "main-image": { "asset": "assets/social/podcast-1280x720.png", "alt": "…" }
    }
  }
}
```

| Field | What |
|---|---|
| `video.file` | the feature video: a Drive share link or file id the signed-in Google account (or service account) can open |
| `video.speakers` | how many people talk in the video, if known (helps the speaker labels) |
| `episode.number`, `episode.title` | the next episode, named like the recent ones |
| `episode.description` | the show notes, pasted into the show's app on upload |
| `episode.tags` | keywords for the episode |
| `episode.image` | the episode image, relative to `output/<slug>/`; default the social pack's podcast thumbnail |
| `script.instructions` | who listens, the angle and the tone — the agent writes the lines to it |
| `script.notes` | facts and limits the lines must respect |
| `script.minutes` | the target length; `podcast-script` and validation compare it with the script at about 180 words a minute (the dialogue model's pace) |
| `script.intro`, `script.outro` | said by the host first and last |
| `script.lines` | the conversation: `speaker` `host` or `guest`, `text` (at most 1,200 characters a line). The voice model reads audio tags in square brackets — `[laughs]`, `[excited]`, `[pause]` — as delivery; they are left out of the transcript |
| `script.language` | the language code |
| `site.fields` | the website episode page by the collection's field slugs (`podcast-site` reads them); images as `{ "asset": "<path in output/<slug>/>", "alt": "…" }` |

To change the episode, change the lines and voice it again (`podcast --yes
--force`): only parts from the first changed one on are voiced again.

## The website episode page

Episodes live in a CMS collection (`WEBFLOW_PODCASTS_COLLECTION_ID`), one item
each, filled like the recent items: the title, the image, the directory
episode's link and player embed, and the transcript with the hosts' names
(`transcript.html`, one paragraph per line, the speaker in bold). The agent
creates it as a draft, and links it from the feature's CMS item when that has
a podcast link field. Publishing both is the user's (`docs/website.md`,
"Publishing").

The page is written for search and answer engines (`docs/seo.md`):
- its SEO title (30–60 characters) and description (120–160) name the feature;
- the image has alt text;
- the transcript is on the page, since that is what answer engines read of an episode.

Validation warns on each. `seo <slug>` writes the episode's `PodcastEpisode` structured data to `output/<slug>/seo/episode.jsonld.json`.
