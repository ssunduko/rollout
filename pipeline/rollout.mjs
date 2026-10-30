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
//   node pipeline/rollout.mjs build <slug> [--force] [--allow-mutations]   scenes -> PDF -> web page -> social pack
//   node pipeline/rollout.mjs social <slug> [--force]               the social pack only (needs library/features/<slug>/social.json)
//   node pipeline/rollout.mjs help <slug> [--force]                 the help article only (needs library/features/<slug>/help.json)
//   node pipeline/rollout.mjs help-center                           check the help-center connection; list authors and collections
//   node pipeline/rollout.mjs help-find <slug> [<words>]            help articles that may already cover the feature, with their collections
//   node pipeline/rollout.mjs help-get <slug> <id>                  read a live article into output/<slug>/help-live/<id>.json
//   node pipeline/rollout.mjs help-publish <slug> --yes [--state draft|published] [--live]
//                                                                    build, then create or update the article (only on the user's approval)
//   node pipeline/rollout.mjs qa <slug>                             measure outputs, write screenshots + qa.json
//   node pipeline/rollout.mjs serve <slug> [--open]                 serve the web page on WEB_PORT until stopped; --open shows it in the browser
//   node pipeline/rollout.mjs library [list|search <words>|show <id>|fork <from> <to>|index]
//   node pipeline/rollout.mjs brand [<slug>]                        the resolved brand (the feature's, else BRAND_DIR)
//
// Agents write sidecars (brief.json, social.json, help.json, scene.json +
// scene.html); this renders them. It never writes copy, invents visuals or
// publishes.

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
import { buildHelp, loadHelp, helpSceneIds, validateHelp, helpFile } from './help.mjs';
import { helpCenter, publishHelp } from './helpcenter.mjs';
import { uploadImages } from './imagestore.mjs';
import { serveDir, openInBrowser } from './serve.mjs';
import { readIndex, rebuildIndex, searchScenes, loadScene, forkScene, sceneDir } from './library.mjs';
import { loadTarget, listTargets } from './target.mjs';
import { probe, manualLogin } from './capture.mjs';
import { targetNameFor } from './scenes.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const VALUED = new Set(['--name', '--open', '--setup', '--out', '--state']);
const args = rest.filter((a, i) => !a.startsWith('--') && !VALUED.has(rest[i - 1]));
const renderOpts = () => ({ force: flags.has('--force'), allowMutations: flags.has('--allow-mutations') });
const option = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');

const sceneIds = (brief) => [brief.hero.scene, ...brief.sections.map((s) => s.scene), ...(brief.web?.poster ? [brief.web.poster] : [])];
// the brief's scenes plus the ones its social pack and help article show
const allSceneIds = (slug, brief, brand) => {
  const social = loadSocial(slug, brief, brand);
  const help = loadHelp(slug, brief, brand);
  return [...new Set([...sceneIds(brief), ...(social ? socialSceneIds(social) : []), ...(help ? helpSceneIds(help) : [])])];
};

function printSocialValidation(slug, brief, brand) {
  const { errors, warnings } = validateSocial(slug, brief, brand);
  errors.forEach((m) => console.log(`  error  social: ${m}`));
  warnings.forEach((m) => console.log(`  warn   social: ${m}`));
  return errors.length === 0;
}

function printHelpValidation(slug, brief, brand) {
  const { errors, warnings } = validateHelp(slug, brief, brand);
  errors.forEach((m) => console.log(`  error  help: ${m}`));
  warnings.forEach((m) => console.log(`  warn   help: ${m}`));
  return errors.length === 0;
}

function printValidation(slug) {
  const { errors, warnings } = validateBrief(slug);
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
    const assets = has(p.inputAssets) ? fs.readdirSync(p.inputAssets).filter((f) => !f.startsWith('.') && f !== 'README.md') : [];
    line(true, 'input assets', assets.length ? assets.join(', ') : 'none (agents create every visual)');
    line(has(p.brief), 'brief', has(p.brief) ? rel(p.brief) : 'next: copywriter agent');
    if (!has(p.brief)) return;
    const { errors } = validateBrief(slug);
    const brief = readJson(p.brief);
    const ids = [brief.hero?.scene, ...(brief.sections ?? []).map((s) => s.scene)].filter(Boolean);
    const missing = ids.filter((id) => !has(path.join(sceneDir(id), 'scene.json')));
    const captures = ids.filter((id) => !missing.includes(id)).map((id) => loadScene(id)).filter((sc) => sc.source === 'capture');
    if (captures.length) line(true, 'captures', `${captures.length} from target ${[...new Set(captures.map(targetNameFor))].join(', ')}`);
    line(!missing.length, 'scenes', missing.length ? `missing: ${missing.join(', ')} — next: visual-designer agent` : `${ids.length} authored`);
    line(!errors.length, 'brief valid', errors.length ? `${errors.length} error(s) — run validate` : '');
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
    else {
      const brand = brandForFeature(slug);
      const brief = loadBrief(slug, brand);
      if (!printSocialValidation(slug, brief, brand)) process.exitCode = 1;
      if (!printHelpValidation(slug, brief, brand)) process.exitCode = 1;
    }
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
    if (!printHelpValidation(slug, brief, brand)) throw new Error('help.json has errors — fix them before building');
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

    const help = await buildHelp({ slug, brief, brand, renders });
    console.log(help ? `help article
  ${rel(help.dir)}/article.html  (${help.action}, ${help.images.length} images)` : 'help article  skipped — no help.json');
    help?.blockers.forEach((b) => console.log(`  note    ${b}`));

    writeJson(path.join(p.output, 'build.json'), {
      $comment: 'Sidecar of this build: what it was made from. Generated by pipeline/rollout.mjs.',
      slug, brand: brand.id, brandHash: brand.hash,
      pdf: path.basename(pdf.pdfFile), pages: pdf.pages, web: 'web/index.html', webFitted: web.fitted,
      social: social ? social.files.map((f) => `assets/social/${f}`) : [],
      help: help ? 'help/article.html' : null,
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

  // uploaded: { file: url } from the image store, when help-publish builds again
  async help(uploaded) {
    const slug = assertSlug(args[0]);
    const brand = brandForFeature(slug);
    const brief = loadBrief(slug, brand);
    if (!loadHelp(slug, brief, brand)) throw new Error(`no ${rel(helpFile(slug))} — the rollout-help-writer agent writes it (docs/help.md)`);
    if (!printHelpValidation(slug, brief, brand)) throw new Error('help.json has errors');
    const renders = await renderScenes(allSceneIds(slug, brief, brand), brand, renderOpts());
    console.log('help article');
    const r = await buildHelp({ slug, brief, brand, renders, uploaded });
    console.log(`  ${rel(r.dir)}/article.html  (${r.action}, ${r.images.length} images)`);
    console.log(`  preview  ${rel(r.dir)}/preview.html`);
    if (r.uploads) console.log(`  note    ${r.uploads} new or changed image(s) go to the image store when help-publish sends the article`);
    r.blockers.forEach((b) => console.log(`  note    ${b}`));
    return r;
  },

  async 'help-center'() {
    const hc = await helpCenter(loadBrand());
    const me = await hc.me();
    const authors = await hc.authors();
    console.log(`help center: ${hc.name}  (connected as ${me.name}, id ${me.id})`);
    console.log(`authors: put one id in .env as HELP_AUTHOR_ID${env('HELP_AUTHOR_ID') ? ` (now ${env('HELP_AUTHOR_ID')})` : ''}`);
    authors.forEach((a) => console.log(`  ${a.id}  ${a.name}${a.id === me.id ? '  (this token)' : ''}`));
    console.log(`collections: optionally put one id in .env as HELP_COLLECTION_ID`);
    (await hc.collections()).forEach((c) => console.log(`  ${c.id}  ${c.name}${c.parentId ? `  (in ${c.parentId})` : ''}`));
  },

  async 'help-find'() {
    const slug = assertSlug(args[0]);
    const brand = brandForFeature(slug);
    const brief = loadBrief(slug, brand);
    const hc = await helpCenter(brand);
    const phrases = args.length > 1 ? [args.slice(1).join(' ')] : [brief.feature];
    const seen = new Map();
    for (const phrase of phrases) for (const a of await hc.find(phrase)) seen.set(a.id, a);
    if (!seen.size) return console.log(`  no articles match ${phrases.map((p) => `"${p}"`).join(', ')}`);
    // each article's collection by name: where related articles live is where a new one belongs
    const names = new Map((await hc.collections()).map((c) => [c.id, c.name]));
    const where = (a) => a.parentIds.map((id) => `${names.get(String(id)) ?? '?'} (${id})`).join(', ') || 'no collection';
    for (const a of seen.values()) console.log(`  ${a.id}  [${a.state}]  ${a.title.replace(/\s+/g, ' ')}  in ${where(a)}  updated ${new Date(a.updatedAt * 1000).toISOString().slice(0, 10)}  ${a.url ?? ''}`);
  },

  async 'help-get'() {
    const slug = assertSlug(args[0]);
    const hc = await helpCenter(brandForFeature(slug));
    const a = await hc.get(args[1]);
    const file = path.join(featurePaths(slug).output, 'help-live', `${a.id}.json`);
    writeJson(file, a);
    console.log(`  ${a.id}  [${a.state}]  ${a.title}`);
    console.log(`  updatedAt  ${a.updatedAt}  (record it as help.json publish.updatedAt)`);
    console.log(`  url        ${a.url ?? '-'}`);
    console.log(`  parents    ${a.parentIds.join(', ') || '-'}`);
    console.log(`  saved      ${rel(file)}`);
  },

  async 'help-publish'() {
    const slug = assertSlug(args[0]);
    if (!flags.has('--yes')) throw new Error('help-publish sends the article to the help center: run it only after the user approved, with --yes');
    const state = option('--state');
    if (state && !['draft', 'published'].includes(state)) throw new Error('--state is draft or published');
    const built = await commands.help();
    if (built.uploads) {
      // put the new images where the help center can fetch them, then build the body that links them
      console.log('image store');
      const uploaded = await uploadImages({ slug, images: built.images, dir: built.dir });
      await commands.help(uploaded);
    }
    const brand = brandForFeature(slug);
    const help = loadHelp(slug, loadBrief(slug, brand), brand);
    console.log('publish');
    const r = await publishHelp({ slug, help, brand, state, live: flags.has('--live') });
    console.log(`  ${r.action}d article ${r.articleId}  [${r.state}]  ${r.url ?? ''}`);
    console.log(`  record  ${rel(path.join(featurePaths(slug).library, 'help.published.json'))}`);
  },

  async qa() {
    const slug = assertSlug(args[0]);
    const brief = loadBrief(slug, brandForFeature(slug));
    const r = await runQa({ slug, brief, paths: featurePaths(slug) });
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
