// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG } from '../src/config.js';
import { TRIGGER, WIDGET_KEY } from '../src/hub.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { METHODS } from '../src/ttlock/records.js';
import { WIDGETS } from '../src/widgets.js';
import { FRONT_DOOR } from './helpers/fakeTtlock.js';
import { BASE_CONFIG, addDevices, createWorld, deviceId } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

// The handlers the integration actually registers on the SDK.
const registered = await createWorld({ connect: false });
const handlerKeys = (prefix) =>
  Object.keys(registered.gladys.handlers)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));

const CAPABILITY_FIELDS = ['scene_triggers', 'scene_actions', 'widgets'];
const CAPABILITY_MIN_GLADYS_VERSION = [5, 1, 0];
const CATEGORIES_MIN_GLADYS_VERSION = [4, 86, 0];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('identity: name, image, cloud transport, security category', () => {
  assert.equal(manifest.name, 'TTLock');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-ttlock:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-ttlock/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.deepEqual(manifest.categories, ['security']);
});

test('every manifest action has a registered handler, and vice versa', () => {
  assert.deepEqual(handlerKeys('action:').sort(), keysOf(manifest.actions).sort());
});

test('declaring catalog categories requires Gladys >= 4.86.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(isAtLeast(minGladysVersion(), CATEGORIES_MIN_GLADYS_VERSION));
});

test('declaring scene triggers, scene actions or widgets requires Gladys >= 5.1.0', () => {
  const declared = CAPABILITY_FIELDS.filter((field) => manifest[field] !== undefined);
  assert.deepEqual(declared, CAPABILITY_FIELDS);
  assert.ok(
    isAtLeast(minGladysVersion(), CAPABILITY_MIN_GLADYS_VERSION),
    `${declared.join(', ')} requires gladys_version >= 5.1.0, got "${manifest.gladys_version}"`,
  );
});

test('no widget button opens a form: Gladys 5.1 is enough', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await addDevices(world);
  const ack = await world.fake.widgetGet(WIDGET_KEY, {
    settings: { device: deviceId(world.gladys, FRONT_DOOR) },
  });
  const buttons = ack.data.content.components.filter((c) => c.type === 'button');
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].action.fields, undefined);
});

test('every scene_actions key has a handler, and vice versa', () => {
  const declared = keysOf(manifest.scene_actions);
  assert.deepEqual(declared.sort(), Object.keys(SCENE_ACTIONS).sort());
  assert.deepEqual(handlerKeys('sceneAction:').sort(), declared.sort());
});

test('scene action outputs are the declared ones', async (t) => {
  const world = await createWorld({
    config: { ...BASE_CONFIG, allow_unlock: true, allow_passage_mode: true },
  });
  t.after(() => world.app.stop());
  await addDevices(world);
  const device = deviceId(world.gladys, FRONT_DOOR);
  const fields = {
    lock: { device },
    unlock: { device },
    set_passage_mode: { device, enabled: true },
  };
  for (const action of manifest.scene_actions) {
    const ack = await world.fake.sceneAction(action.key, fields[action.key]);
    assert.equal(ack.success, true, `${action.key}: ${ack.error}`);
    assert.deepEqual(
      Object.keys(ack.data.outputs).sort(),
      keysOf(action.outputs).sort(),
      `${action.key} outputs`,
    );
  }
});

test('every widgets key has handlers, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets), Object.keys(WIDGETS));
  assert.deepEqual(handlerKeys('widget:'), keysOf(manifest.widgets));
  assert.deepEqual(handlerKeys('widgetAction:'), keysOf(manifest.widgets));
});

test('the triggers the code fires are the declared ones, with their filters and variables', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGER).sort());
  const world = await createWorld();
  t.after(() => world.app.stop());
  await addDevices(world);
  world.clock.advance(5 * 60_000);
  world.cloud.addRecord(FRONT_DOOR, { recordType: 8, username: 'Alex' });
  world.cloud.setBattery(FRONT_DOOR, 12);
  await world.hub.cycle();
  for (const trigger of manifest.scene_triggers) {
    const event = world.fake.sceneEvents.find((entry) => entry.key === trigger.key);
    assert.ok(event, `${trigger.key} fired`);
    for (const key of [...keysOf(trigger.fields), ...keysOf(trigger.variables)]) {
      assert.ok(key in event.data, `${trigger.key}: "${key}" is in the event data`);
    }
  }
});

test('the method filter offers exactly the methods the records map to', () => {
  const trigger = manifest.scene_triggers.find((entry) => entry.key === TRIGGER.UNLOCKED);
  const method = trigger.fields.find((field) => field.key === 'method');
  assert.deepEqual(
    method.options.map((option) => option.value),
    METHODS,
  );
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG, and back', () => {
  const stored = manifest.config_schema.filter((field) => field.type !== 'section');
  assert.deepEqual(keysOf(stored).sort(), Object.keys(DEFAULT_CONFIG).sort());
  for (const field of stored) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `DEFAULT_CONFIG.${field.key}`);
    }
  }
});

test('opening the door is off by default', () => {
  for (const key of ['allow_unlock', 'allow_passage_mode']) {
    const field = manifest.config_schema.find((entry) => entry.key === key);
    assert.equal(field.type, 'boolean');
    assert.equal(field.default, false);
    assert.equal(DEFAULT_CONFIG[key], false);
  }
});

test('secrets are secret fields, and no action asks for one', () => {
  const types = Object.fromEntries(manifest.config_schema.map((field) => [field.key, field.type]));
  assert.equal(types.client_secret, 'secret');
  assert.equal(types.password, 'secret');
  for (const action of manifest.actions) {
    for (const field of action.fields ?? []) {
      assert.notEqual(field.type, 'secret', `action ${action.key}`);
    }
  }
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  const dynamicSelects = allFields.filter((f) => f.source !== undefined);
  assert.ok(dynamicSelects.length > 0);
  for (const field of dynamicSelects) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, `field "${field.key}"`);
  }
});

test('scene trigger filters are never booleans', () => {
  for (const trigger of manifest.scene_triggers) {
    for (const field of trigger.fields ?? []) {
      assert.notEqual(field.type, 'boolean', `${trigger.key}.${field.key}`);
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    `docker_image must be tagged :${manifest.version}, got "${manifest.docker_image}"`,
  );
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${lang} has ${text.length} characters (10 to 100 allowed)`,
    );
  }
});

test('field placeholders are multi-language objects', () => {
  const withPlaceholder = allFields.filter((f) => f.placeholder !== undefined);
  for (const field of withPlaceholder) {
    assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder`);
    assert.ok(field.placeholder.en, `field "${field.key}": placeholder needs an English text`);
  }
});
