import '../setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockFetch, bodyOf } from '../helpers.mjs';
import { connect } from '../../pipeline/podcaststudio/elevenlabs.mjs';

const BASE = 'https://studio.test';

test('connect needs an API key', () => {
  assert.throws(() => connect({}), /ELEVENLABS_API_KEY is not set/);
});

test('voices: the key header, mapped voices, a trailing slash in the base URL', async () => {
  const m = mockFetch([{ url: `${BASE}/v2/voices`, reply: { json: { voices: [{ voice_id: 'v1', name: 'Ava', category: 'premade' }, { voice_id: 'v2', name: 'Ben' }] } } }]);
  try {
    const s = connect({ apiKey: 'k', baseUrl: `${BASE}/` });
    assert.equal(s.maxChars, 2000);
    assert.deepEqual(await s.voices(), [{ id: 'v1', name: 'Ava', category: 'premade' }, { id: 'v2', name: 'Ben', category: null }]);
    assert.equal(m.calls[0].url, `${BASE}/v2/voices?page_size=100`);
    assert.equal(m.calls[0].headers.get('xi-api-key'), 'k');
  } finally {
    m.restore();
  }
});

test('voice: one voice, its id encoded', async () => {
  const m = mockFetch([{ url: `${BASE}/v1/voices/`, reply: { json: { voice_id: 'a/b', name: 'Ava' } } }]);
  try {
    assert.deepEqual(await connect({ apiKey: 'k', baseUrl: BASE }).voice('a/b'), { id: 'a/b', name: 'Ava' });
    assert.equal(m.calls[0].url, `${BASE}/v1/voices/a%2Fb`);
  } finally {
    m.restore();
  }
});

test('errors carry the method, route, status and the API\'s detail', async () => {
  const m = mockFetch([
    { url: `${BASE}/v2/voices`, reply: { status: 401, json: { detail: { message: 'invalid api key' } } } },
    { url: `${BASE}/v1/voices/x`, reply: { status: 422, json: { detail: [{ loc: ['body', 'id'], msg: 'bad id' }] } } },
    { url: `${BASE}/v1/voices/y`, reply: { status: 500, text: 'gateway down' } },
  ]);
  try {
    const s = connect({ apiKey: 'k', baseUrl: BASE });
    await assert.rejects(s.voices(), /podcast studio GET \/v2\/voices\?page_size=100 -> 401 invalid api key/);
    await assert.rejects(s.voice('x'), /422 body\.id: bad id/);
    await assert.rejects(s.voice('y'), /500 gateway down/);
  } finally {
    m.restore();
  }
});

test('transcribe: multipart form, words joined into utterances by speaker, audio events dropped', async () => {
  let form;
  const m = mockFetch([{
    method: 'POST', url: `${BASE}/v1/speech-to-text`,
    reply: (req) => {
      form = req.body;
      return {
        json: {
          text: 'Hi there. Hello.', language_code: 'en', audio_duration_secs: 4.2,
          words: [
            { text: 'Hi', speaker_id: 'speaker_0', start: 0.1, type: 'word' },
            { text: ' ', speaker_id: 'speaker_0', type: 'spacing' },
            { text: 'there.', speaker_id: 'speaker_0', type: 'word' },
            { text: '(laughter)', speaker_id: 'speaker_1', type: 'audio_event' },
            { text: ' Hello.', speaker_id: 'speaker_1', start: 2, type: 'word' },
            { text: '   ', speaker_id: 'speaker_0', start: 3, type: 'spacing' },
          ],
        },
      };
    },
  }]);
  try {
    const t = await connect({ apiKey: 'k', baseUrl: BASE }).transcribe({ blob: new Blob(['video']), name: 'v.mp4', model: 'scribe_v2', speakers: 2 });
    assert.ok(form instanceof FormData);
    assert.equal(form.get('model_id'), 'scribe_v2');
    assert.equal(form.get('diarize'), 'true');
    assert.equal(form.get('num_speakers'), '2');
    assert.equal(form.get('file').name, 'v.mp4');
    assert.equal(m.calls[0].headers.get('content-type'), null, 'fetch sets the multipart boundary itself');
    assert.deepEqual(t, {
      text: 'Hi there. Hello.', language: 'en', seconds: 4.2,
      utterances: [{ speaker: 'speaker_0', text: 'Hi there.', start: 0.1 }, { speaker: 'speaker_1', text: 'Hello.', start: 2 }],
    });
  } finally {
    m.restore();
  }
});

test('transcribe without a speaker count leaves num_speakers out; empty results are safe', async () => {
  let form;
  const m = mockFetch([{ url: `${BASE}/v1/speech-to-text`, reply: (req) => { form = req.body; return { json: {} }; } }]);
  try {
    const t = await connect({ apiKey: 'k', baseUrl: BASE }).transcribe({ blob: new Blob(['v']), name: 'v.mp4', model: 'm' });
    assert.equal(form.has('num_speakers'), false);
    assert.deepEqual(t, { text: '', language: null, seconds: null, utterances: [] });
  } finally {
    m.restore();
  }
});

test('dialogue: the request body, the audio bytes and the request id', async () => {
  const m = mockFetch([{
    method: 'POST', url: `${BASE}/v1/text-to-dialogue`,
    reply: { body: Buffer.from('MP3DATA'), headers: { 'request-id': 'req-9', 'content-type': 'audio/mpeg' } },
  }]);
  try {
    const r = await connect({ apiKey: 'k', baseUrl: BASE }).dialogue({
      lines: [{ voiceId: 'v1', text: 'Hi' }, { voiceId: 'v2', text: 'Hello' }],
      model: 'eleven_v3', language: 'en', stability: 0, previousRequestIds: ['a', 'b', 'c', 'd'], seed: 5,
    });
    assert.equal(r.audio.toString(), 'MP3DATA');
    assert.ok(Buffer.isBuffer(r.audio));
    assert.equal(r.requestId, 'req-9');
    assert.equal(m.calls[0].url, `${BASE}/v1/text-to-dialogue?output_format=mp3_44100_128`);
    assert.equal(m.calls[0].headers.get('content-type'), 'application/json');
    assert.deepEqual(JSON.parse(await bodyOf(m.calls[0])), {
      inputs: [{ text: 'Hi', voice_id: 'v1' }, { text: 'Hello', voice_id: 'v2' }],
      model_id: 'eleven_v3', language_code: 'en', settings: { stability: 0 },
      previous_request_ids: ['b', 'c', 'd'], seed: 5,
    });
  } finally {
    m.restore();
  }
});

test('dialogue: optional settings are left out when not given', async () => {
  const m = mockFetch([{ url: `${BASE}/v1/text-to-dialogue`, reply: { body: 'x' } }]);
  try {
    const r = await connect({ apiKey: 'k', baseUrl: BASE }).dialogue({ lines: [{ voiceId: 'v', text: 't' }] });
    assert.equal(r.requestId, null);
    assert.deepEqual(JSON.parse(await bodyOf(m.calls[0])), { inputs: [{ text: 't', voice_id: 'v' }] });
  } finally {
    m.restore();
  }
});

test('dialogue: a model that refuses previous_request_ids is retried without, and remembered', async () => {
  const bodies = [];
  const m = mockFetch([{
    url: `${BASE}/v1/text-to-dialogue`,
    reply: async (req) => {
      const b = JSON.parse(await bodyOf(req));
      bodies.push(b);
      return b.previous_request_ids
        ? { status: 400, json: { detail: { message: 'previous_request_ids is not supported for this model' } } }
        : { body: 'ok' };
    },
  }]);
  try {
    const s = connect({ apiKey: 'k', baseUrl: BASE });
    const line = [{ voiceId: 'v', text: 't' }];
    await s.dialogue({ lines: line, model: 'eleven_v3', previousRequestIds: ['a'] });
    await s.dialogue({ lines: line, model: 'eleven_v3', previousRequestIds: ['a', 'b'] });
    assert.deepEqual(bodies.map((b) => 'previous_request_ids' in b), [true, false, false]);
  } finally {
    m.restore();
  }
});

test('dialogue: other errors are not retried', async () => {
  const m = mockFetch([{ url: `${BASE}/v1/text-to-dialogue`, reply: { status: 402, json: { detail: { message: 'quota exceeded' } } } }]);
  try {
    await assert.rejects(connect({ apiKey: 'k', baseUrl: BASE }).dialogue({ lines: [{ voiceId: 'v', text: 't' }], previousRequestIds: ['a'] }), /402 quota exceeded/);
    assert.equal(m.calls.length, 1);
  } finally {
    m.restore();
  }
});
