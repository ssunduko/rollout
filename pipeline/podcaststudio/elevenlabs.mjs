// ElevenLabs adapter for pipeline/podcast.mjs: Speech to Text, and Text to
// Dialogue to voice the episode's script.
//
//   ELEVENLABS_API_KEY   the xi-api-key (voices read, speech to text, text to
//                        speech). Secret
//   ELEVENLABS_API_URL   https://api.elevenlabs.io (or a regional server)
//
// Text to Dialogue voices a list of lines, each with its voice, in one
// request; a request should stay at or below about 2,000 characters, so a
// long script is voiced in parts, each conditioned on the request ids of the
// parts before it so the voices carry on naturally.

const DEFAULT_URL = 'https://api.elevenlabs.io';

export function connect({ apiKey, baseUrl = DEFAULT_URL }) {
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set in .env');
  const base = baseUrl.replace(/\/$/, '');
  const call = async (method, route, { json, form } = {}) => {
    const res = await fetch(`${base}${route}`, {
      method,
      headers: { 'xi-api-key': apiKey, ...(json ? { 'Content-Type': 'application/json' } : {}) },
      body: json ? JSON.stringify(json) : form,
    });
    if (!res.ok) {
      const text = await res.text();
      let why = text.slice(0, 400);
      try {
        const d = JSON.parse(text).detail;
        why = Array.isArray(d) ? d.map((x) => `${(x.loc ?? []).join('.')}: ${x.msg}`).join('; ') : (d?.message ?? JSON.stringify(d));
      } catch { /* not JSON */ }
      throw new Error(`podcast studio ${method} ${route} -> ${res.status} ${why}`);
    }
    return res;
  };
  const get = async (route) => (await call('GET', route)).json();
  // models that refuse previous_request_ids (eleven_v3 does): learned on the first refusal
  const noChaining = new Set();

  return {
    // the most text one dialogue request should carry
    maxChars: 2000,
    // the voices the key can use: [{ id, name, category }]
    async voices() {
      const r = await get('/v2/voices?page_size=100');
      return (r.voices ?? []).map((v) => ({ id: v.voice_id, name: v.name, category: v.category ?? null }));
    },
    async voice(id) {
      const v = await get(`/v1/voices/${encodeURIComponent(id)}`);
      return { id: v.voice_id, name: v.name };
    },
    // Speech to text with speakers: { text, language, seconds, utterances: [{ speaker, text, start }] }
    async transcribe({ blob, name, model, speakers }) {
      const form = new FormData();
      form.append('model_id', model);
      form.append('diarize', 'true');
      if (speakers) form.append('num_speakers', String(speakers));
      form.append('file', blob, name);
      const r = await (await call('POST', '/v1/speech-to-text', { form })).json();
      // words come one by one, each with its speaker: join runs of one speaker into utterances
      const utterances = [];
      for (const w of r.words ?? []) {
        if (w.type === 'audio_event') continue;
        const last = utterances.at(-1);
        if (last && last.speaker === (w.speaker_id ?? null)) last.text += w.text;
        else utterances.push({ speaker: w.speaker_id ?? null, text: w.text.trimStart(), start: w.start ?? null });
      }
      utterances.forEach((u) => (u.text = u.text.replace(/\s+/g, ' ').trim()));
      return { text: r.text ?? '', language: r.language_code ?? null, seconds: r.audio_duration_secs ?? null, utterances: utterances.filter((u) => u.text) };
    },
    // Voice one part of the script: lines [{ voiceId, text }] -> { audio (MP3 bytes), requestId }.
    // Earlier parts' request ids carry the voices on where the model takes
    // them; a model that refuses them voices each part on its own.
    // stability: lower is more expressive (eleven_v3 takes 0 Creative, 0.5 Natural, 1 Robust).
    async dialogue({ lines, model, language, stability, previousRequestIds = [], seed }) {
      const send = (chain) => call('POST', '/v1/text-to-dialogue?output_format=mp3_44100_128', {
        json: {
          inputs: lines.map((l) => ({ text: l.text, voice_id: l.voiceId })),
          ...(model ? { model_id: model } : {}),
          ...(language ? { language_code: language } : {}),
          ...(stability != null ? { settings: { stability } } : {}),
          ...(chain && previousRequestIds.length ? { previous_request_ids: previousRequestIds.slice(-3) } : {}),
          ...(seed != null ? { seed } : {}),
        },
      });
      let res;
      try {
        res = await send(!noChaining.has(model));
      } catch (err) {
        if (!/previous_request_ids.*not supported/i.test(err.message)) throw err;
        noChaining.add(model);
        res = await send(false);
      }
      return { audio: Buffer.from(await res.arrayBuffer()), requestId: res.headers.get('request-id') ?? null };
    },
  };
}
