// Text replacement in captures (capture.mjs textReplacer), run in the real
// Chrome: real names are drawn as invented ones in every text node, including
// text the app adds or changes after load, and nothing else changes. Needs
// Chrome (skipped without it, except in CI).

import '../setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withBrowser } from '../../pipeline/chrome.mjs';
import { textReplacer } from '../../pipeline/capture.mjs';
import { haveChrome, required } from '../helpers.mjs';

const CHROME = await haveChrome();

const PAIRS = [
  { from: 'Front Desk', to: 'Sales Inbox' },
  { from: 'Jordan', to: 'WRONG' }, // shorter: must not win over "Jordan Pike"
  { from: 'Jordan Pike', to: 'Maya Brooks' },
  { from: 'JP', to: 'MB', whole: true },
];

test('textReplacer: names replaced on load and as the app redraws; whole-only pairs and scripts left alone', { skip: required(CHROME, 'Chrome') }, async () => {
  await withBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(textReplacer, PAIRS);
    // a real navigation, as captures load the app (setContent reuses the blank document)
    const html = `<!doctype html><body>
      <h1 id="inbox">Front Desk · (555) 010-0142</h1>
      <span id="name" aria-label="TypographyCallPopUpName">Jordan Pike</span>
      <span id="avatar">JP</span>
      <p id="word">JPEG and JP-1 stay</p>
      <script id="s">window.keep = "Jordan Pike";</script>
      <ul id="list"></ul>
    </body>`;
    await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const text = (sel) => page.$eval(sel, (el) => el.textContent);
    assert.equal(await text('#inbox'), 'Sales Inbox · (555) 010-0142'); // number kept
    assert.equal(await text('#name'), 'Maya Brooks'); // longer "from" first
    assert.equal(await text('#avatar'), 'MB'); // whole: exact text only
    assert.equal(await text('#word'), 'JPEG and JP-1 stay');
    assert.equal(await page.evaluate(() => window.keep), 'Jordan Pike'); // scripts untouched
    assert.equal(await page.$eval('#name', (el) => el.getAttribute('aria-label')), 'TypographyCallPopUpName'); // attributes untouched

    // the app redraws: new rows and changed text are replaced too
    await page.evaluate(() => {
      const li = document.createElement('li');
      li.innerHTML = '<b>Jordan Pike</b> called Front Desk';
      document.getElementById('list').append(li);
      document.getElementById('avatar').firstChild.nodeValue = 'JP';
    });
    await page.waitForFunction(() => document.getElementById('list').textContent === 'Maya Brooks called Sales Inbox');
    await page.waitForFunction(() => document.getElementById('avatar').textContent === 'MB');

    // selectors that match on text see the replaced text
    assert.ok(await page.$('::-p-text(Sales Inbox)'));
    assert.equal(await page.$('::-p-text(Front Desk)'), null);
  });
});
