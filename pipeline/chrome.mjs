// Headless Chrome, shared by every stage that renders: scene stills and GIF
// frames, the PDF, and the QA screenshots. One browser per command; pages are
// cheap, launches are not.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { env } from './env.mjs';

// CHROME_PATH wins, else the usual Windows/macOS/Linux spots. Edge is the last
// resort — same CDP surface.
export function resolveChrome() {
  const candidates = [
    env('CHROME_PATH'),
    ...(process.platform === 'win32'
      ? [
          `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
        : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']),
  ].filter(Boolean);
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new Error(`Chrome not found. Set CHROME_PATH. Looked in:\n  ${candidates.join('\n  ')}`);
  return found;
}

export async function withBrowser(fn) {
  const browser = await puppeteer.launch({
    executablePath: resolveChrome(),
    headless: true,
    // file:// pages load fonts and images from neighbouring folders
    args: ['--allow-file-access-from-files', '--font-render-hinting=none', '--hide-scrollbars'],
  });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

// Fonts load asynchronously even from file://; a screenshot taken before they
// arrive renders the fallback face.
export async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))),
    );
  });
}
