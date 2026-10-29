#!/usr/bin/env node
// rollout: the deterministic core the agents drive.
//
//   node pipeline/rollout.mjs init <slug> [--name "Feature name"]   new input/<slug>/ from the template
//   node pipeline/rollout.mjs status <slug>                         what exists for a feature, and what is next
//   node pipeline/rollout.mjs validate <slug>                       check brief.json against the layout limits
//   node pipeline/rollout.mjs targets                               the applications captures can log into
//   node pipeline/rollout.mjs login <target>                        sign in by hand once (SSO) in the target's profile
//   node pipeline/rollout.mjs probe <target> [--open <url>] [--setup <steps.json>] [--out <dir>]
//                                                                    signed-in screenshot + element list, for choosing selectors
//   node pipeline/rollout.mjs scene <id> [--force] [--allow-mutations]   render or capture one scene, print its files
//   node pipeline/rollout.mjs scenes <slug> [--force]               render every scene the brief uses
//   node pipeline/rollout.mjs build <slug> [--force] [--allow-mutations]   scenes -> PDF -> web page -> social pack -> copy pack
//   node pipeline/rollout.mjs social <slug> [--force]               the social pack only (needs library/features/<slug>/social.json)
//   node pipeline/rollout.mjs copy <slug>                           the copy pack only: email, posts, podcast brief (needs library/features/<slug>/copy.json)
//   node pipeline/rollout.mjs tracker                               where the scope agent reads tickets (TRACKER_* in .env)
//   node pipeline/rollout.mjs qa <slug>                             measure outputs, write screenshots + qa.json
//   node pipeline/rollout.mjs serve <slug> [--open]                 serve the web page on WEB_PORT until stopped; --open shows it in the browser
//   node pipeline/rollout.mjs library [list|search <words>|show <id>|fork <from> <to>|index]
//   node pipeline/rollout.mjs brand [<slug>]                        the resolved brand (the feature's, else BRAND_DIR)
//
// Agents write sidecars (brief.json, scene.json + scene.html); this renders
// them. It never writes copy or invents visuals.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, INPUT_DIR, LIBRARY_DIR, featurePaths, assertSlug, readJson, writeJson, env, envNumber } from './env.mjs';
import { loadBrand, brandForFeature } from './brand.mjs';
import { loadFeature, loadBrief, validateBrief } from './brief.mjs';
import { renderScenes } from './scenes.mjs';
import { buildOnepager } from './onepager.mjs';
import { buildWebpage } from './webpage.mjs';
import { runQa } from './qa.mjs';
import { buildSocial, loadSocial, socialSceneIds, validateSocial } from './social.mjs';
import { buildCopy, validateCopy, copyFile } from './copy.mjs';
import { serveDir, openInBrowser } from './serve.mjs';
import { readIndex, rebuildIndex, searchScenes, loadScene, forkScene, sceneDir } from './library.mjs';
import { loadTarget, listTargets } from './target.mjs';
import { probe, manualLogin } from './capture.mjs';
import { targetNameFor } from './scenes.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const VALUED = new Set(['--name', '--open', '--setup', '--out']);
const args = rest.filter((a, i) => !a.startsWith('--') && !VALUED.has(rest[i - 1]));
const renderOpts = () => ({ force: flags.has('--force'), allowMutations: flags.has('--allow-mutations') });
const option = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');

const sceneIds = (brief) => [brief.hero.scene, ...brief.sections.map((s) => s.scene), ...(brief.web?.poster ? [brief.web.poster] : [])];
// the brief's scenes plus the ones its social pack shows
const allSceneIds = (slug, brief, brand) => {
  const social = loadSocial(slug, brief, brand);
  return [...sceneIds(brief), ...(social ? socialSceneIds(social) : [])];
};

function printSocialValidation(slug, brief, brand) {
  const { errors, warnings } = validateSocial(slug, brief, brand);
  errors.forEach((m) => console.log(`  error  social: ${m}`));
  warnings.forEach((m) => console.log(`  warn   social: ${m}`));
  return errors.length === 0;
}

function printCopyValidation(slug, brief, brand) {
  const { errors, warnings } = validateCopy(slug, brief, brand);
  errors.forEach((m) => console.log(`  error  copy: ${m}`));
  warnings.forEach((m) => console.log(`  warn   copy: ${m}`));
  return errors.length === 0;
}

function printValidation(slug) {
  const { errors, warnings } = validateBrief(slug, brandForFeature(slug));
  errors.forEach((m) => console.log(`  error  ${m}`));
  warnings.forEach((m) => console.log(`  warn   ${m}`));
  if (!errors.length && !warnings.length) console.log('  brief OK');
  return errors.length === 0;
}

const commands = {
  init() {
    const slug = assertSlug(args[0]);
    const p = featurePaths(slug);
    if (fs.existsSync(p.input)) throw new Error(`${rel(p.input)} already exists`);
    fs.cpSync(path.join(INPUT_DIR, '_template'), p.input, { recursive: true });
    const sidecar = readJson(p.sidecar);
    sidecar.slug = slug;
    sidecar.name = option('--name') ?? slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    writeJson(p.sidecar, sidecar);
    console.log(`created ${rel(p.input)}/ — describe the feature in feature.md, then ask Claude: "roll out ${slug}"`);
  },

  status() {
    const slug = assertSlug(args[0]);
    const p = featurePaths(slug);
    const has = (f) => fs.existsSync(f);
    const line = (ok, label, detail = '') => console.log(`  ${ok ? '✓' : '·'} ${label}${detail ? `  ${detail}` : ''}`);
    line(has(p.description), 'input', rel(p.description));
    const sources = has(p.sidecar) ? readJson(p.sidecar).sources ?? [] : [];
    if (sources.length) line(true, 'sources', sources.map((x) => x.ref).join(', '));
    const assets = has(p.inputAssets) ? fs.readdirSync(p.inputAssets).filter((f) => !f.startsWith('.') && f !== 'README.md') : [];
    line(true, 'input assets', assets.length ? assets.join(', ') : 'none (agents create every visual)');
    line(has(p.brief), 'brief', has(p.brief) ? rel(p.brief) : 'next: copywriter agent');
    if (!has(p.brief)) return;
    const { errors } = validateBrief(slug, brandForFeature(slug));
    const brief = readJson(p.brief);
    const ids = [brief.hero?.scene, ...(brief.sections ?? []).map((s) => s.scene)].filter(Boolean);
    const missing = ids.filter((id) => !has(path.join(sceneDir(id), 'scene.json')));
    const captures = ids.filter((id) => !missing.includes(id)).map((id) => loadScene(id)).filter((sc) => sc.source === 'capture');
    if (captures.length) line(true, 'captures', `${captures.length} from target ${[...new Set(captures.map(targetNameFor))].join(', ')}`);
    line(!missing.length, 'scenes', missing.length ? `missing: ${missing.join(', ')} — next: visual-designer agent` : `${ids.length} authored`);
    line(!errors.length, 'brief valid', errors.length ? `${errors.length} error(s) — run validate` : '');
    line(has(copyFile(slug)), 'copy', has(copyFile(slug)) ? rel(copyFile(slug)) : 'next: copywriter agent (email, posts, podcast brief)');
    const build = path.join(p.output, 'build.json');
    line(has(build), 'built', has(build) ? readJson(build).builtAt : 'next: rollout.mjs build');
    const qa = path.join(p.qa, 'qa.json');
    line(has(qa) && readJson(qa).verdict === 'PASS', 'qa', has(qa) ? `${readJson(qa).verdict} (${readJson(qa).checkedAt})` : 'next: rollout.mjs qa, then the layout-qa agent');
  },

  targets() {
    const names = listTargets().filter((n) => !n.startsWith('_'));
    if (!names.length) return console.log('  no targets — copy targets/_template.json to targets/<name>.json');
    for (const n of names) {
      try {
        const t = loadTarget(n);
        const signedIn = fs.existsSync(t.profile) && fs.readdirSync(t.profile).length > 0;
        console.log(`  ${n}  ${t.app}  auth: ${t.auth.mode}  profile: ${signedIn ? 'present' : 'empty'}${t.missingEnv.length ? `  unset: ${t.missingEnv.map((m) => m.variable).join(', ')}` : ''}`);
      } catch (e) {
        console.log(`  ${n}  error: ${e.message}`);
      }
    }
  },

  async login() {
    await manualLogin(loadTarget(args[0])); // reports whether the session landed
  },

  async probe() {
    const t = loadTarget(args[0]);
    const setupFile = option('--setup');
    const out = path.resolve(option('--out') ?? path.join(ROOT, 'output', '_probe', t.name));
    const r = await probe(t, { open: option('--open'), setup: setupFile ? readJson(setupFile) : [], out });
    console.log(`  ${r.url}: ${r.count} elements`);
    console.log(`  screenshot  ${rel(r.screenshot)}`);
    console.log(`  elements    ${rel(r.json)}`);
  },

  validate() {
    const slug = assertSlug(args[0]);
    loadFeature(slug);
    if (!printValidation(slug)) process.exitCode = 1;
    // the social pack and the copy pack need only a readable brief, not a finished one
    const brand = brandForFeature(slug);
    let brief;
    try {
      brief = loadBrief(slug, brand);
    } catch {
      return;
    }
    if (!Array.isArray(brief.sections) || !brief.hero) return;
    if (!printSocialValidation(slug, brief, brand)) process.exitCode = 1;
    if (!printCopyValidation(slug, brief, brand)) process.exitCode = 1;
  },

  async scene() {
    const id = args[0];
    const brand = brandForFeature(loadScene(id).feature ?? id.split('--')[0]);
    const r = await renderScenes([id], brand, renderOpts());
    console.log(`  still  ${rel(r[id].still)}`);
    if (r[id].gif) console.log(`  gif    ${rel(r[id].gif)}`);
    console.log(`  page   ${rel(path.join(r[id].dir, 'scene.page.html'))}`);
  },

  async scenes() {
    const slug = assertSlug(args[0]);
    const brand = brandForFeature(slug);
    const brief = loadBrief(slug, brand);
    const r = await renderScenes(allSceneIds(slug, brief, brand), brand, renderOpts());
    for (const [id, x] of Object.entries(r)) console.log(`  ${id}: ${rel(x.still)}${x.gif ? ` + ${path.basename(x.gif)}` : ''}`);
  },

  async build() {
    const slug = assertSlug(args[0]);
    loadFeature(slug);
    console.log(`validate ${slug}`);
    if (!printValidation(slug)) throw new Error('brief has errors — fix them before building');
    const brand = brandForFeature(slug);
    const brief = loadBrief(slug, brand);
    const p = featurePaths(slug);
    fs.mkdirSync(p.output, { recursive: true });

    if (!printSocialValidation(slug, brief, brand)) throw new Error('social.json has errors — fix them before building');
    if (!printCopyValidation(slug, brief, brand)) throw new Error('copy.json has errors — fix them before building');
    console.log(`scenes (brand ${brand.id})`);
    const renders = await renderScenes(allSceneIds(slug, brief, brand), brand, renderOpts());

    console.log('one-pager');
    const pdf = await buildOnepager({ brief, brand, renders, outDir: p.output });
    console.log(`  ${rel(pdf.pdfFile)}  (${pdf.pages} pages)`);

    console.log('web page');
    const web = await buildWebpage({ brief, brand, renders, outDir: p.web });
    console.log(`  ${rel(web.htmlFile)}`);
    web.fitted.forEach((id) => console.log(`  note    ${id}: no web cut of its own (kit scene or an older capture) — fitted into the web frame; re-capture for a sharp, zoomed one`));

    // after the one-pager: it rebuilds output/<slug>/assets/, where the pack lives
    const social = await buildSocial({ slug, brief, brand, renders, log: () => {} });
    console.log(social ? `social pack
  ${rel(social.dir)}/  (${social.files.length} files)` : 'social pack  skipped — no social.json');

    // after the social pack: the posts name the images to attach
    const copy = buildCopy({ slug, brief, brand });
    console.log(copy ? `copy pack
  ${rel(copy.dir)}/  (${copy.files.length} files)` : 'copy pack  skipped — no copy.json');

    writeJson(path.join(p.output, 'build.json'), {
      $comment: 'Sidecar of this build: what it was made from. Generated by pipeline/rollout.mjs.',
      slug, brand: brand.id, brandHash: brand.hash,
      pdf: path.basename(pdf.pdfFile), pages: pdf.pages, web: 'web/index.html', webFitted: web.fitted,
      social: social ? social.files.map((f) => `assets/social/${f}`) : [],
      copy: copy ? copy.files.map((f) => `copy/${f}`) : [],
      scenes: Object.fromEntries(Object.entries(renders).map(([id, r]) => [id, r.hash])),
      builtAt: new Date().toISOString(),
    });
    console.log(`done — next: node pipeline/rollout.mjs qa ${slug}`);
  },

  async social() {
    const slug = assertSlug(args[0]);
    const brand = brandForFeature(slug);
    const brief = loadBrief(slug, brand);
    if (!loadSocial(slug, brief, brand)) throw new Error(`no library/features/${slug}/social.json — the visual designer writes it (docs/social.md)`);
    if (!printSocialValidation(slug, brief, brand)) throw new Error('social.json has errors');
    const renders = await renderScenes(allSceneIds(slug, brief, brand), brand, renderOpts());
    console.log('social pack');
    const r = await buildSocial({ slug, brief, brand, renders });
    console.log(`  -> ${rel(r.dir)}/`);
  },

  copy() {
    const slug = assertSlug(args[0]);
    const brand = brandForFeature(slug);
    const brief = loadBrief(slug, brand);
    if (!fs.existsSync(copyFile(slug))) throw new Error(`no library/features/${slug}/copy.json — the copywriter writes it (docs/copy.md)`);
    if (!printCopyValidation(slug, brief, brand)) throw new Error('copy.json has errors');
    const r = buildCopy({ slug, brief, brand });
    console.log('copy pack');
    r.files.forEach((f) => console.log(`  ${f}`));
    console.log(`  -> ${rel(r.dir)}/`);
  },

  tracker() {
    const list = (key) => env(key, '').split(',').map((x) => x.trim()).filter(Boolean);
    console.log(JSON.stringify({
      site: env('TRACKER_SITE_ID', null),
      rolloutProject: env('TRACKER_ROLLOUT_PROJECT', null),
      engineeringProjects: list('TRACKER_ENGINEERING_PROJECTS'),
      shippedStatuses: list('TRACKER_SHIPPED_STATUSES'),
    }, null, 2));
  },

  async qa() {
    const slug = assertSlug(args[0]);
    const brand = brandForFeature(slug);
    const brief = loadBrief(slug, brand);
    const r = await runQa({ slug, brief, brand, paths: featurePaths(slug) });
    console.log(`VERDICT (measured): ${r.verdict}  ${r.fails} fail, ${r.warns} warn`);
    r.findings.forEach((f) => console.log(`  ${f.level.padEnd(4)} [${f.check}] ${f.message}`));
    console.log('screenshots for the layout-qa agent:');
    r.screenshots.forEach((s) => console.log(`  ${rel(path.join(featurePaths(slug).output, s))}`));
    if (r.verdict === 'FAIL') process.exitCode = 1;
  },

  async serve() {
    const slug = assertSlug(args[0]);
    const p = featurePaths(slug);
    if (!fs.existsSync(path.join(p.web, 'index.html'))) throw new Error(`${rel(p.web)}/index.html is not built — run: node pipeline/rollout.mjs build ${slug}`);
    const { url } = await serveDir(p.web, envNumber('WEB_PORT', 4400));
    console.log(`serving ${rel(p.web)}/ on ${url} — Ctrl+C to stop`);
    if (flags.has('--open')) openInBrowser(url);
  },

  library() {
    const [sub = 'list', ...more] = args;
    if (sub === 'index') return console.log(`rebuilt ${rel(path.join(LIBRARY_DIR, 'index.json'))}`, rebuildIndex() && '');
    if (sub === 'search') {
      const hits = searchScenes(more.join(' '));
      if (!hits.length) return console.log('  no matching scenes');
      for (const h of hits.slice(0, 15)) console.log(`  ${h.id}  [${h.tags.join(', ')}]  ${h.title}${h.animated ? '  (animated)' : ''}`);
      return;
    }
    if (sub === 'show') {
      const s = loadScene(more[0]);
      const idx = readIndex().scenes[more[0]] ?? {};
      console.log(JSON.stringify({ ...Object.fromEntries(Object.entries(s).filter(([k]) => !['markup', 'dir', 'htmlFile'].includes(k))), renders: idx.renders, usedBy: idx.usedBy }, null, 2));
      return;
    }
    if (sub === 'fork') {
      forkScene(more[0], more[1]);
      return console.log(`  forked ${more[0]} -> ${more[1]} (edit library/scenes/${more[1]}/)`);
    }
    const { scenes, features } = rebuildIndex();
    console.log(`features (${Object.keys(features).length})`);
    for (const [slug, f] of Object.entries(features)) console.log(`  ${slug}  ${f.feature}  — ${f.scenes.length} scenes`);
    console.log(`scenes (${Object.keys(scenes).length})`);
    for (const [id, s] of Object.entries(scenes)) console.log(`  ${id}  [${s.tags.join(', ')}]  ${s.animated ? 'animated' : 'still'}  renders: ${Object.keys(s.renders).join(', ') || 'none'}`);
  },

  brand() {
    const b = args[0] ? brandForFeature(assertSlug(args[0])) : loadBrand();
    console.log(JSON.stringify({ dir: rel(b.dir), id: b.id, name: b.name, website: b.website, websiteLabel: b.websiteLabel, phone: b.phone, email: b.email, colors: b.colors, fonts: { body: b.fonts.body.family, display: b.fonts.display.family }, hash: b.hash, voice: b.voice, rules: b.rules }, null, 2));
  },
};

if (!commands[cmd]) {
  // usage: the header comment's command list (the lines naming a command, and their continuations)
  const header = fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n');
  const first = header.findIndex((l) => l.includes('node pipeline/rollout.mjs'));
  const end = header.findIndex((l, i) => i > first && l.trim() === '//');
  console.log(header.slice(first, end).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(cmd ? 1 : 0);
}
try {
  await commands[cmd]();
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exit(1);
}
