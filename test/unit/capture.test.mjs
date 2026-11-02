import '../setup.mjs';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { captureSettings, checkMutations } from '../../pipeline/capture.mjs';

afterEach(() => { for (const k of ['CAPTURE_SCALE', 'GIF_FPS', 'GIF_WIDTH', 'CAPTURE_MAX_WAIT_MS']) delete process.env[k]; });

test('captureSettings: the .env.example values', () => {
  assert.deepEqual(captureSettings(), { scale: 2, gifFps: 12, gifWidth: 800, maxWaitMs: 700 });
});

test('captureSettings reads the environment at call time', () => {
  process.env.CAPTURE_SCALE = '1';
  process.env.GIF_FPS = '24';
  process.env.GIF_WIDTH = 'wide'; // junk: the default
  assert.deepEqual(captureSettings(), { scale: 1, gifFps: 24, gifWidth: 800, maxWaitMs: 700 });
});

test('checkMutations: no mutating steps pass either way', () => {
  const scene = { id: 'x--y', setup: [{ op: 'wait', sel: '#a' }], steps: [{ op: 'click', sel: '#b' }] };
  assert.doesNotThrow(() => checkMutations(scene, false));
  assert.doesNotThrow(() => checkMutations({ id: 'x--empty' }, false));
});

test('checkMutations refuses mutating steps without approval, naming them', () => {
  const scene = {
    id: 'x--send',
    setup: [{ op: 'open', url: '/inbox', mutates: true }],
    steps: [{ op: 'click', sel: '#send', mutates: true }, { op: 'hold', ms: 100 }],
  };
  assert.throws(() => checkMutations(scene, false), (err) => {
    assert.match(err.message, /scene x--send has 2 step\(s\) marked "mutates"/);
    assert.match(err.message, /open \/inbox; click #send/);
    assert.match(err.message, /--allow-mutations/);
    return true;
  });
  assert.doesNotThrow(() => checkMutations(scene, true));
});

test('checkMutations finds mutating steps nested in ifAppears', () => {
  const scene = { id: 'x--nested', steps: [{ op: 'ifAppears', sel: '.modal', then: [{ op: 'click', sel: '.ok', then: [{ op: 'press', key: 'Enter', mutates: true }] }] }] };
  assert.throws(() => checkMutations(scene, false), /1 step\(s\) marked "mutates" \(press /);
});
