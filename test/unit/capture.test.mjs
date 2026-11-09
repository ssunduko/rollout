import '../setup.mjs';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { captureSettings, checkMutations, checkReplace, cursorLook } from '../../pipeline/capture.mjs';

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

test('cursorLook: a plain dark arrow by default; the brand cursor from its block', () => {
  const plain = cursorLook(null);
  assert.match(plain.svg, /fill="#111"/);
  assert.deepEqual(plain.hot, [4, 2]);
  const brand = cursorLook({ from: '#aaccff', to: '#0066ff', shadow: 'rgba(0,102,255,.4)', size: 60 });
  assert.match(brand.svg, /width="60" height="60"/);
  assert.match(brand.svg, /stop-color="#aaccff"/);
  assert.match(brand.svg, /stop-color="#0066ff"/);
  assert.match(brand.svg, /fill="url\(#__rc_g\)"/);
  assert.match(brand.shadow, /rgba\(0,102,255,\.4\)/);
  assert.deepEqual(brand.hot, [10, 8]); // the tip, scaled with the size
  assert.match(cursorLook({}).svg, /width="40"/); // defaults
});

test('checkReplace: each real name has its own invented one', () => {
  const scene = { id: 'x--names', replace: [
    { from: 'Front Desk', to: 'Sales Inbox' }, { from: 'Promo Line', to: 'Marketing Inbox' },
    { from: 'Jo Real', to: 'Maya Brooks' }, { from: 'JO REAL', to: 'Maya Brooks' }, // same name, other case
  ] };
  assert.doesNotThrow(() => checkReplace(scene));
  assert.doesNotThrow(() => checkReplace({ id: 'x--none' }));
});

test('checkReplace refuses two real names shown as the same invented one', () => {
  const scene = { id: 'x--clash', replace: [{ from: 'Promo Line', to: 'Sales Inbox' }] };
  const pairs = [{ from: 'Front Desk', to: 'Sales Inbox' }, ...scene.replace]; // target's replaceText first
  assert.throws(() => checkReplace(scene, pairs), (err) => {
    assert.match(err.message, /scene x--clash/);
    assert.match(err.message, /"Sales Inbox" \(from front desk, promo line\)/);
    return true;
  });
});
