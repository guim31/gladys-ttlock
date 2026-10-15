// -----------------------------------------------------------------------------
// The hub against the fake TTLock cloud: what reaches Gladys, when the cloud
// is asked, the triggers, the commands and their safety switches.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIMINGS, TRIGGER } from '../src/hub.js';
import { Store } from '../src/store.js';
import { FRONT_DOOR, GARAGE, KEY_BOX, FakeTtlockCloud } from './helpers/fakeTtlock.js';
import {
  BASE_CONFIG,
  addDevices,
  createClock,
  createWorld,
  deviceId,
  discovered,
  featureId,
} from './helpers/world.js';

const MINUTE = 60_000;

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

/** A started world with every lock added in Gladys, then a quiet minute. */
async function added(t, options) {
  const w = await world(t, options);
  await addDevices(w);
  w.clock.advance(MINUTE);
  return w;
}

const last = (w, lockId, key) => w.fake.lastState(featureId(w.gladys, lockId, key));
const refresh = async (w, minutes = 5) => {
  w.clock.advance(minutes * MINUTE);
  await w.hub.cycle();
};

test('the locks of the account become devices, the connection is reported', async (t) => {
  const w = await world(t);
  assert.deepEqual(
    w.fake.discoveredDevices.map((device) => device.name),
    ['Front door', 'Garage', 'Key box'],
  );
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  // Nothing added in Gladys yet: no record, no state asked to a lock.
  assert.equal(w.cloud.count('/v3/lockRecord/list'), 0);
  assert.equal(w.cloud.count('/v3/lock/queryOpenState'), 0);
});

test('adding a lock sends its states at once', async (t) => {
  const w = await world(t);
  w.cloud.states.set(FRONT_DOOR, 1);
  await addDevices(w, [FRONT_DOOR]);
  assert.equal(last(w, FRONT_DOOR, 'state'), 0, 'unlocked');
  assert.equal(last(w, FRONT_DOOR, 'battery'), 90);
  assert.equal(last(w, FRONT_DOOR, 'gateway'), 1);
  assert.equal(last(w, FRONT_DOOR, 'last_access'), 'None');
  assert.ok(w.fake.widgetRefreshes.length > 0, 'the widget is asked to refresh');
  // Only this lock was read.
  assert.equal(last(w, GARAGE, 'battery'), undefined);
});

test('TTLock state 0 is "locked" (Gladys 1), 1 is "unlocked" (Gladys 0), 2 changes nothing', async (t) => {
  const w = await added(t);
  assert.equal(last(w, FRONT_DOOR, 'state'), 1);
  w.cloud.states.set(FRONT_DOOR, 1);
  w.cloud.addRecord(FRONT_DOOR, { recordType: 4 });
  await refresh(w);
  assert.equal(last(w, FRONT_DOOR, 'state'), 0);
  w.cloud.states.set(FRONT_DOOR, 2);
  w.cloud.addRecord(FRONT_DOOR, { recordType: 47 });
  await refresh(w);
  assert.equal(last(w, FRONT_DOOR, 'state'), 0, 'unknown keeps the last known state');
});

test('the state is asked to the lock only when it is due, not at every refresh', async (t) => {
  const w = await added(t);
  const asked = () => w.cloud.calls.filter((c) => c.path === '/v3/lock/queryOpenState').length;
  const before = asked();
  await refresh(w);
  await refresh(w);
  assert.equal(asked(), before, 'no state read without a new record');

  w.cloud.addRecord(FRONT_DOOR, { recordType: 7 });
  await refresh(w);
  assert.equal(asked(), before + 1, 'a new record asks the state of that lock only');

  await refresh(w, TIMINGS.stateEvery / MINUTE);
  assert.equal(asked(), before + 3, 'every 30 minutes, both connectable locks');
});

test('the Bluetooth-only lock has no state and is never asked through a gateway', async (t) => {
  const w = await added(t);
  const device = discovered(w, KEY_BOX);
  assert.deepEqual(
    device.features.map((f) => f.external_id.split(':').pop()),
    ['battery', 'last_access'],
  );
  await refresh(w, 60);
  assert.ok(
    !w.cloud.calls.some(
      (c) => c.path === '/v3/lock/queryOpenState' && Number(c.params.lockId) === KEY_BOX,
    ),
  );
});

test('a new access becomes the last access, without the passcode itself', async (t) => {
  const w = await added(t);
  w.cloud.addRecord(FRONT_DOOR, { recordType: 4, username: 'Cleaner', keyboardPwd: '383834' });
  await refresh(w);
  const text = last(w, FRONT_DOOR, 'last_access');
  assert.match(text, /^Passcode · Cleaner · \d\d:\d\d/);
  const everything = JSON.stringify([w.fake.requests, w.fake.sceneEvents]);
  assert.ok(!everything.includes('383834'), 'the passcode never reaches Gladys');
});

test('"Lock unlocked" fires once per new access, with how and who', async (t) => {
  const w = await added(t);
  w.cloud.addRecord(FRONT_DOOR, { recordType: 8, username: 'Alex' });
  w.cloud.addRecord(FRONT_DOOR, { recordType: 47 }); // locked again: no trigger
  await refresh(w);
  await refresh(w);
  const events = w.fake.sceneEvents.filter((e) => e.key === TRIGGER.UNLOCKED);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data, {
    device: deviceId(w.gladys, FRONT_DOOR),
    method: 'fingerprint',
    method_name: 'Fingerprint',
    user: 'Alex',
    lock_name: 'Front door',
  });
});

test('a failed attempt is no access and fires nothing', async (t) => {
  const w = await added(t);
  w.cloud.addRecord(FRONT_DOOR, { recordType: 4, success: 0 });
  await refresh(w);
  assert.equal(w.fake.sceneEvents.length, 0);
  assert.equal(last(w, FRONT_DOOR, 'last_access'), 'None');
});

test('history is not news: no trigger for the records found at start or uploaded late', async (t) => {
  const clock = createClock();
  const cloud = new FakeTtlockCloud({ now: clock.now });
  cloud.addRecord(FRONT_DOOR, { recordType: 1, username: 'Alex', ago: 2 * 60 * MINUTE });
  const w = await world(t, { clock, cloud });
  await addDevices(w);
  assert.equal(w.fake.sceneEvents.length, 0, 'the record of 2 hours ago is history');
  assert.match(last(w, FRONT_DOOR, 'last_access'), /^App · Alex/, 'but it is the last access');

  // Done on the lock 40 minutes ago, uploaded now (the gateway was offline).
  cloud.addRecord(FRONT_DOOR, { recordType: 7, ago: 40 * MINUTE, late: 40 * MINUTE });
  await refresh(w);
  assert.equal(w.fake.sceneEvents.length, 0);
  assert.match(last(w, FRONT_DOOR, 'last_access'), /^Card/);
});

test('a restart neither replays the accesses nor forgets the last one', async (t) => {
  const clock = createClock();
  const cloud = new FakeTtlockCloud({ now: clock.now });
  const first = await world(t, { clock, cloud });
  await addDevices(first);
  clock.advance(MINUTE);
  cloud.addRecord(FRONT_DOOR, { recordType: 8, username: 'Alex' });
  await refresh(first);
  assert.equal(first.fake.sceneEvents.length, 1);
  await first.app.stop();

  const second = await world(t, {
    clock,
    cloud,
    dataDir: first.dataDir,
    devices: first.fake.devices,
  });
  clock.advance(MINUTE);
  await second.hub.cycle();
  assert.equal(second.fake.sceneEvents.length, 0, 'not fired again');
  assert.match(last(second, FRONT_DOOR, 'last_access'), /^Fingerprint · Alex/);
  assert.equal(cloud.count('/oauth2/token'), 1, 'the stored token is reused');
});

test('"Low battery" fires once under the threshold, again only after new batteries', async (t) => {
  const w = await added(t);
  const fired = () => w.fake.sceneEvents.filter((e) => e.key === TRIGGER.BATTERY_LOW);
  w.cloud.setBattery(GARAGE, 19);
  await refresh(w, 60);
  await refresh(w, 60);
  assert.equal(fired().length, 1);
  assert.deepEqual(fired()[0].data, {
    device: deviceId(w.gladys, GARAGE),
    battery: 19,
    lock_name: 'Garage',
  });

  w.cloud.setBattery(GARAGE, 22); // above the threshold, within the hysteresis
  await refresh(w, 60);
  w.cloud.setBattery(GARAGE, 18);
  await refresh(w, 60);
  assert.equal(fired().length, 1);

  w.cloud.setBattery(GARAGE, 100);
  await refresh(w, 60);
  w.cloud.setBattery(GARAGE, 15);
  await refresh(w, 60);
  assert.equal(fired().length, 2);
});

test('a gateway that goes offline is shown, and the lock state is kept', async (t) => {
  const w = await added(t);
  w.cloud.setGatewayOnline(false);
  w.cloud.addRecord(FRONT_DOOR, { recordType: 1 });
  await refresh(w);
  assert.equal(last(w, FRONT_DOOR, 'gateway'), 0);
  assert.equal(last(w, FRONT_DOOR, 'state'), 1);
  w.cloud.setGatewayOnline(true);
  await refresh(w);
  assert.equal(last(w, FRONT_DOOR, 'gateway'), 1);
});

test('only the changes are sent, and a heartbeat keeps stable values fresh', async (t) => {
  // The SDK dates what it sent with the real clock: mock it.
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 12, 10, 0, 0) });
  const w = await added(t);
  const sent = () => w.fake.states.length;
  const before = sent();
  await refresh(w);
  assert.equal(sent(), before, 'nothing changed, nothing sent');
  t.mock.timers.tick(TIMINGS.heartbeat);
  w.clock.advance(TIMINGS.heartbeat);
  await w.hub.cycle();
  assert.ok(sent() > before, 'the heartbeat sends the unchanged values again');
});

test('the core poll is a fallback: skipped while the timer keeps up', async (t) => {
  const w = await added(t);
  const calls = w.cloud.calls.length;
  const device = discovered(w, FRONT_DOOR);
  assert.deepEqual(await w.fake.poll(device), { success: true });
  assert.equal(w.cloud.calls.length, calls);
  w.clock.advance(10 * MINUTE);
  await w.fake.poll(device);
  assert.ok(w.cloud.calls.length > calls, 'the timer stalled: the core poll refreshes');
});

test('the states refresh on the container timer, without any core poll', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = await world(t, { timers: true });
  await addDevices(w, [FRONT_DOOR]);
  const records = w.cloud.count('/v3/lockRecord/list');
  w.cloud.addRecord(FRONT_DOOR, { recordType: 7, username: 'Sam' });
  w.cloud.states.set(FRONT_DOOR, 1);
  w.clock.advance(5 * MINUTE);
  t.mock.timers.tick(5 * MINUTE);
  for (let i = 0; i < 20 && w.cloud.count('/v3/lockRecord/list') === records; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  await w.hub.cycleInFlight;
  assert.equal(w.cloud.count('/v3/lockRecord/list'), records + 1);
  assert.equal(last(w, FRONT_DOOR, 'state'), 0);
  assert.match(last(w, FRONT_DOOR, 'last_access'), /^Card · Sam/);
});

test('the lock button locks, then reads the state back', async (t) => {
  const w = await added(t);
  w.cloud.states.set(FRONT_DOOR, 1);
  const device = discovered(w, FRONT_DOOR);
  const button = device.features.find((f) => f.external_id.endsWith(':lock'));
  assert.deepEqual(await w.fake.setValue(device, button, 1), { success: true });
  assert.equal(w.cloud.count('/v3/lock/lock'), 1);
  assert.equal(last(w, FRONT_DOOR, 'state'), 1);
});

test('no other feature takes a command', async (t) => {
  const w = await added(t);
  const device = discovered(w, FRONT_DOOR);
  const state = device.features.find((f) => f.external_id.endsWith(':state'));
  const ack = await w.fake.setValue(device, state, 0);
  assert.equal(ack.success, false);
  assert.equal(w.cloud.count('/v3/lock/unlock'), 0);
});

test('unlocking is refused while the configuration does not allow it', async (t) => {
  const w = await added(t);
  const ack = await w.fake.sceneAction('unlock', { device: deviceId(w.gladys, FRONT_DOOR) });
  assert.equal(ack.success, false);
  assert.match(ack.error, /Unlocking is disabled/);
  assert.match(ack.error, /Le déverrouillage est désactivé/);
  assert.equal(w.cloud.count('/v3/lock/unlock'), 0);

  const passage = await w.fake.sceneAction('set_passage_mode', {
    device: deviceId(w.gladys, FRONT_DOOR),
    enabled: true,
  });
  assert.equal(passage.success, false);
  assert.equal(w.cloud.count('/v3/lock/configPassageMode'), 0);
});

test('once allowed, the scene unlocks and says what the lock reports', async (t) => {
  const w = await added(t, { config: { ...BASE_CONFIG, allow_unlock: true } });
  const ack = await w.fake.sceneAction('unlock', { device: deviceId(w.gladys, FRONT_DOOR) });
  assert.deepEqual(ack, { success: true, data: { outputs: { unlocked: true } } });
  assert.equal(last(w, FRONT_DOOR, 'state'), 0);
});

test('passage mode, once allowed: all day every day, without unlocking by itself', async (t) => {
  const w = await added(t, { config: { ...BASE_CONFIG, allow_passage_mode: true } });
  const device = deviceId(w.gladys, FRONT_DOOR);
  await w.fake.sceneAction('set_passage_mode', { device, enabled: true });
  const on = w.cloud.passage.get(FRONT_DOOR);
  assert.equal(on.passageMode, '1');
  assert.equal(on.autoUnlock, '2');
  assert.equal(on.type, '2');
  assert.deepEqual(JSON.parse(on.cyclicConfig), [
    { isAllDay: 1, startTime: 0, endTime: 0, weekDays: [1, 2, 3, 4, 5, 6, 7] },
  ]);
  const ack = await w.fake.sceneAction('set_passage_mode', { device, enabled: false });
  assert.deepEqual(ack.data.outputs, { passage_mode: false });
  assert.equal(w.cloud.passage.get(FRONT_DOOR).passageMode, '2');
});

test('a lock without gateway nor WiFi cannot be commanded', async (t) => {
  const w = await added(t, { config: { ...BASE_CONFIG, allow_unlock: true } });
  const ack = await w.fake.sceneAction('lock', { device: deviceId(w.gladys, KEY_BOX) });
  assert.equal(ack.success, false);
  assert.match(ack.error, /no gateway nor WiFi/);
});

test('a refused sign-in is shown in the Configuration screen', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, password: 'wrong' } });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /refuses the sign-in/);
  assert.deepEqual(w.fake.discoveredDevices, []);
});

test('the API call limit is shown, then cleared once the cloud answers again', async (t) => {
  const w = await added(t);
  w.cloud.fail('/v3/gateway/list', 30006);
  await refresh(w);
  assert.match(w.fake.connectionStatus.message.en, /call limit/);
  await refresh(w);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('a token the cloud revoked is renewed without the user', async (t) => {
  const w = await added(t);
  w.cloud.expireTokens();
  w.cloud.addRecord(FRONT_DOOR, { recordType: 1, username: 'Alex' });
  await refresh(w);
  assert.match(last(w, FRONT_DOOR, 'last_access'), /^App · Alex/);
  assert.equal(w.cloud.count('/oauth2/token'), 2, 'refreshed once');
});

test('a new configuration signs in again and follows the new language', async (t) => {
  const w = await added(t);
  await w.fake.configUpdated({ ...BASE_CONFIG, language: 'fr', poll_minutes: '15' });
  assert.equal(w.hub.config.poll_minutes, '15');
  assert.equal(last(w, FRONT_DOOR, 'last_access'), 'Aucun');
});

test('without credentials, the integration waits and says what to fill in', async (t) => {
  const w = await world(t, { config: {} });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.fr, /client ID/);
  assert.equal(w.cloud.calls.length, 0);
});

test('the API budget of one lock with a gateway, refreshed every 5 minutes, for a day', async (t) => {
  const clock = createClock();
  const cloud = new FakeTtlockCloud({ now: clock.now });
  cloud.locks = cloud.locks.filter((lock) => lock.lockId === FRONT_DOOR);
  const w = await world(t, { clock, cloud });
  await addDevices(w);
  const start = cloud.calls.length;
  for (let i = 0; i < 288; i += 1) {
    await refresh(w, 5);
  }
  const perDay = cloud.calls.length - start;
  // gateway/list + lockRecord/list every 5 min, the state every 30 min,
  // lock/list + gateway/listByLock every hour.
  assert.equal(perDay, 288 * 2 + 48 + 24 * 2);
  assert.equal(w.hub.callsPerDay([...w.hub.locks.values()]), perDay);
});

test('the store keeps the token out of reach of other users', async (t) => {
  const w = await added(t);
  await w.hub.store.flush();
  const { stat } = await import('node:fs/promises');
  const info = await stat(w.hub.store.path);
  assert.equal(info.mode & 0o077, 0, 'owner-only file');
  const data = await new Store(w.dataDir).load();
  assert.ok(data.token.access_token, 'the token is stored');
  assert.equal(JSON.stringify(data).includes(BASE_CONFIG.password), false);
  assert.equal(JSON.stringify(data).includes(BASE_CONFIG.client_secret), false);
});
