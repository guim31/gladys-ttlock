// -----------------------------------------------------------------------------
// The "TTLock lock" widget: content within the core budget, bound to features
// that exist, localized, and a Lock button — never an unlock one.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { FRONT_DOOR, KEY_BOX } from './helpers/fakeTtlock.js';
import { addDevices, createWorld, deviceId, discovered } from './helpers/world.js';

async function world(t) {
  const w = await createWorld();
  t.after(() => w.app.stop());
  await addDevices(w);
  return w;
}

const content = async (w, lockId, language = 'en') =>
  (
    await w.fake.widgetGet(WIDGET_KEY, {
      settings: lockId ? { device: deviceId(w.gladys, lockId) } : {},
      language,
    })
  ).data.content;

test('the widget fits the core budget and binds features the device has', async (t) => {
  const w = await world(t);
  for (const lockId of [FRONT_DOOR, KEY_BOX]) {
    const widget = await content(w, lockId);
    assert.deepEqual(validateWidgetContent(widget), []);
    const features = new Set(discovered(w, lockId).features.map((f) => f.external_id));
    for (const component of widget.components.filter((c) => c.device_feature)) {
      assert.ok(features.has(component.device_feature), component.device_feature);
    }
  }
});

test('state, gateway and last access, in the language of the dashboard', async (t) => {
  const w = await world(t);
  w.cloud.addRecord(FRONT_DOOR, { recordType: 8, username: 'Alex' });
  w.clock.advance(5 * 60_000);
  await w.hub.cycle();
  const fr = await content(w, FRONT_DOOR, 'fr');
  const status = fr.components.find((c) => c.type === 'status');
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value]),
    [
      ['État', 'Verrouillée'],
      ['Passerelle', 'En ligne'],
      ['Dernier accès', status.items[2].value],
    ],
  );
  assert.match(status.items[2].value, /^Empreinte · Alex · \d\d:\d\d$/);
  const de = await content(w, FRONT_DOOR, 'de');
  assert.equal(de.components.find((c) => c.type === 'button').label, 'Abschließen');
});

test('the button locks, and only locks', async (t) => {
  const w = await world(t);
  w.cloud.states.set(FRONT_DOOR, 1);
  const widget = await content(w, FRONT_DOOR);
  const buttons = widget.components.filter((c) => c.type === 'button');
  assert.deepEqual(
    buttons.map((b) => b.action.key),
    ['lock'],
  );
  const ack = await w.fake.widgetAction(
    WIDGET_KEY,
    'lock',
    {},
    {
      settings: { device: deviceId(w.gladys, FRONT_DOOR) },
    },
  );
  assert.equal(ack.success, true);
  assert.equal(ack.data.message.en, 'Lock command sent.');
  assert.equal(w.cloud.count('/v3/lock/lock'), 1);
  assert.equal(w.cloud.count('/v3/lock/unlock'), 0);
});

test('a lock without gateway shows why there is no button', async (t) => {
  const w = await world(t);
  const widget = await content(w, KEY_BOX);
  assert.equal(widget.components.filter((c) => c.type === 'button').length, 0);
  assert.match(widget.components.find((c) => c.type === 'text').text, /gateway/);
});

test('no lock chosen, or a lock gone from the account: a sentence, not an error', async (t) => {
  const w = await world(t);
  assert.match((await content(w, null)).components[0].text, /Choose a lock/);
  const gone = await w.fake.widgetGet(WIDGET_KEY, {
    settings: { device: deviceId(w.gladys, 999) },
  });
  assert.match(gone.data.content.components[0].text, /no longer/);
});
