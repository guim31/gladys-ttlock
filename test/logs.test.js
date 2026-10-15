// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal refresh writes nothing, a failure that repeats is logged
// once, and its end once. Never a secret of the configuration, a token or a
// passcode — not even at debug level.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT, FIXTURES, FRONT_DOOR, PASSCODE } from './helpers/fakeTtlock.js';
import { BASE_CONFIG, addDevices, createWorld, discovered } from './helpers/world.js';

/** Capture the lines of the SDK logger at the given LOG_LEVEL. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const refresh = async (w, minutes = 5) => {
  w.clock.advance(minutes * 60_000);
  await w.hub.cycle();
};

test('a normal refresh cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  assert.ok(logs.texts().some((text) => text.includes('Connected to TTLock: 3 lock(s)')));
  await addDevices(w);
  logs.clear();

  for (let i = 0; i < 24; i += 1) {
    // Accesses, state reads, hourly lock lists: all routine.
    w.cloud.addRecord(FRONT_DOOR, { recordType: i % 2 ? 4 : 47, keyboardPwd: PASSCODE });
    await refresh(w);
  }
  assert.deepEqual(logs.texts(), []);
});

test('a cloud that stays down is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await addDevices(w);
  logs.clear();

  w.cloud.down = true;
  for (let i = 0; i < 6; i += 1) {
    await refresh(w);
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.equal(logs.lines[0].stream, 'err');
  assert.match(logs.lines[0].text, /TTLock cloud unreachable/);

  logs.clear();
  w.cloud.down = false;
  await refresh(w);
  await refresh(w);
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /TTLock answers again/);
});

test('a user action writes one line', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await addDevices(w);
  logs.clear();
  const device = discovered(w, FRONT_DOOR);
  await w.fake.setValue(
    device,
    device.features.find((f) => f.external_id.endsWith(':lock')),
    1,
  );
  assert.deepEqual(
    logs.texts().map((text) => text.split('] ').pop()),
    ['Front door: lock requested (button)'],
  );
});

test('no secret, token or passcode in the logs, even at debug level', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t, { config: { ...BASE_CONFIG, allow_unlock: true } });
  await addDevices(w);
  w.cloud.addRecord(FRONT_DOOR, { recordType: 4, keyboardPwd: PASSCODE });
  await refresh(w);
  w.cloud.expireTokens();
  w.cloud.fail('/v3/lock/unlock', -3002);
  await w.fake.sceneAction('unlock', { device: discovered(w, FRONT_DOOR).external_id });
  w.cloud.down = true;
  await refresh(w);
  await w.fake.configUpdated({ ...BASE_CONFIG, password: 'wrong' });

  const all = logs.texts().join('\n');
  assert.ok(all.length > 0);
  const tokens = [...w.cloud.tokens, ...w.cloud.refreshTokens, FIXTURES.token.access_token];
  for (const secret of [ACCOUNT.client_secret, ACCOUNT.password, PASSCODE, ...tokens]) {
    assert.ok(!all.includes(secret), `"${secret}" leaked in the logs`);
  }
});
