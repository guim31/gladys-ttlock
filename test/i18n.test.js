// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the texts of the code and
// the documentation. German says "du", never the polite "Sie".
// (Adapted from guim31/gladys-wled and guim31/gladys-ping-wol.)
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import { METHOD_NAMES, MESSAGES, NAMES, TEXT, formatAccess } from '../src/texts.js';
import { METHODS } from '../src/ttlock/records.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres|Ihnen)(?!\p{L})/u;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 60,
  description: 400,
  message: 200,
  short: 24,
  featureName: 40,
};

const sorted = (keys) => [...keys].sort();

/** Checks one multi-language object; returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      const max =
        path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)
          ? MAX.catalog
          : /^manifest\.widgets\[\d+\]\.label$/.test(path)
            ? MAX.widgetLabel
            : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child);
    }
  };
  walk(root, 'manifest', null);
  return texts;
}

test('the configuration offers the four languages', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  const field = manifest.config_schema.find((entry) => entry.key === 'language');
  assert.deepEqual(
    field.options.map((option) => option.value),
    LANGS,
  );
  assert.equal(field.default, 'fr');
});

test('the name is the brand, the same in every language', () => {
  assert.equal(typeof manifest.name, 'string');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 75, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('every text of the code has the four languages', () => {
  const found = [
    ...Object.entries(TEXT).flatMap(([key, value]) => problems(value, `TEXT.${key}`, MAX.message)),
    ...Object.entries(MESSAGES).flatMap(([key, build]) =>
      problems(build('Front door', 2, 1, 672), `MESSAGES.${key}`, MAX.message),
    ),
  ];
  assert.deepEqual(found, []);
});

// Tables written one language at a time: same keys everywhere, no empty text.
function tableProblems(table, name, max) {
  const found = [];
  if (JSON.stringify(sorted(Object.keys(table))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${name} has [${Object.keys(table)}], expected exactly [${LANGS}]`);
  }
  for (const lang of LANGS) {
    const entries = table[lang] ?? {};
    if (
      JSON.stringify(sorted(Object.keys(entries))) !== JSON.stringify(sorted(Object.keys(table.en)))
    ) {
      found.push(`${name}.${lang} does not have the keys of ${name}.en`);
    }
    for (const [key, value] of Object.entries(entries)) {
      found.push(...textProblems(value, `${name}.${lang}.${key}`, lang, max));
    }
  }
  return found;
}

test('the feature names and the methods exist in every language', () => {
  assert.deepEqual(tableProblems(NAMES, 'NAMES', MAX.featureName), []);
  assert.deepEqual(tableProblems(METHOD_NAMES, 'METHOD_NAMES', MAX.short), []);
  assert.deepEqual(sorted(Object.keys(METHOD_NAMES.en)), sorted(METHODS));
});

test('the method names match the options of the trigger filter', () => {
  const trigger = manifest.scene_triggers.find((entry) => entry.key === 'lock_unlocked');
  const options = trigger.fields.find((field) => field.key === 'method').options;
  for (const option of options) {
    for (const lang of LANGS) {
      assert.equal(option.label[lang], METHOD_NAMES[lang][option.value], `${option.value}.${lang}`);
    }
  }
});

test('the last access reads naturally in every language', () => {
  const access = { method: 'fingerprint', user: 'Alex', lockDate: Date.UTC(2026, 9, 12, 8, 5) };
  const now = Date.UTC(2026, 9, 12, 9, 0);
  for (const lang of LANGS) {
    const text = formatAccess(access, lang, now);
    assert.ok(text.startsWith(`${METHOD_NAMES[lang].fingerprint} · Alex · `), text);
    assert.ok(text.length <= 40, text);
  }
  const older = formatAccess({ ...access, user: '' }, 'fr', now + 3 * 86_400_000);
  assert.match(older, /^Empreinte · \d\d\/\d\d/, 'another day shows the date');
});

test('the guard catches a missing language, an empty text and the polite German form', () => {
  assert.equal(problems({ en: 'Lock', fr: 'Serrure', de: 'Schloss' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'Lock', fr: 'Serrure', de: '', es: 'Cerradura' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'a', it: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of ['Wählen Sie', 'Ihr Schloss', 'Ihre Tür', 'mit Ihrem', 'Ihnen']) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'a' }, 'x', 60),
    [],
  );
  const forgotten = structuredClone(manifest);
  delete forgotten.config_schema[4].placeholder.de;
  const found = manifestTexts(forgotten).flatMap(({ path, value, max }) =>
    problems(value, path, max),
  );
  assert.deepEqual(found, [
    'manifest.config_schema[4].placeholder has [en,fr,es], expected exactly [en,fr,de,es]',
  ]);
});

// --- Documentation -------------------------------------------------------------

const docs = Object.fromEntries(
  await Promise.all(
    LANGS.map(async (lang) => [
      lang,
      await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8'),
    ]),
  ),
);
const headingLevels = (text) =>
  text
    .split('\n')
    .filter((line) => /^#{1,4} /.test(line))
    .map((line) => line.match(/^#+/)[0].length);

test('the documentation exists in the four languages, with the same sections', () => {
  const reference = headingLevels(docs.en);
  assert.ok(reference.filter((level) => level === 2).length >= 10, 'the expected sections');
  for (const lang of LANGS) {
    assert.ok(docs[lang].length >= 3000, `docs/${lang}.md is too short`);
    assert.deepEqual(headingLevels(docs[lang]), reference, `docs/${lang}.md sections`);
  }
});

test('the documentation says the hardware was not used, the brand is not ours, and German says "du"', () => {
  assert.match(docs.en, /Developed without the hardware/);
  assert.match(docs.fr, /Développée sans le matériel/);
  assert.match(docs.de, /Ohne die Hardware entwickelt/);
  assert.match(docs.es, /Desarrollada sin el hardware/);
  for (const lang of LANGS) {
    assert.match(docs[lang], /TTLock, (Sciener|ni à Sciener)/, `docs/${lang}.md: not affiliated`);
  }
  const politeLines = docs.de.split('\n').filter((line) => POLITE_GERMAN.test(line));
  assert.deepEqual(politeLines, []);
});

test('the documentation links to sections that exist', () => {
  const slug = (heading) =>
    heading
      .toLowerCase()
      .replace(/[^\p{L}\p{N} -]/gu, '')
      .replace(/ /g, '-');
  for (const lang of LANGS) {
    const anchors = new Set(
      docs[lang]
        .split('\n')
        .filter((line) => /^#{1,4} /.test(line))
        .map((line) => slug(line.replace(/^#+ /, ''))),
    );
    for (const [, anchor] of docs[lang].matchAll(/\]\(#([^)]+)\)/g)) {
      assert.ok(anchors.has(anchor), `docs/${lang}.md: #${anchor}`);
    }
  }
});
