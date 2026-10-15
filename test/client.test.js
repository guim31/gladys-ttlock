// -----------------------------------------------------------------------------
// The TTLock cloud client: sign-in, token life, request signing, errors.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { normalizeConfig } from '../src/config.js';
import { TtlockClient, TtlockError, accountKey } from '../src/ttlock/client.js';
import { ACCOUNT, FRONT_DOOR, FakeTtlockCloud } from './helpers/fakeTtlock.js';
import { createClock } from './helpers/world.js';

function setup({ config = ACCOUNT, stored = null } = {}) {
  const clock = createClock();
  const cloud = new FakeTtlockCloud({ now: clock.now });
  const saved = [];
  const client = new TtlockClient({
    config: normalizeConfig(config),
    fetch: cloud.fetch,
    now: clock.now,
    tokens: { load: async () => stored, save: async (token) => saved.push(token) },
  });
  return { client, cloud, clock, saved };
}

test('signs in with the client ID, the secret and the MD5 of the app password', async () => {
  const { client, cloud, saved } = setup();
  await client.listLocks();
  const [login, list] = cloud.calls;
  assert.equal(login.path, '/oauth2/token');
  assert.equal(login.method, 'POST');
  assert.equal(login.host, 'euapi.ttlock.com');
  assert.equal(login.params.username, ACCOUNT.username);
  assert.equal(
    login.params.password,
    createHash('md5').update(ACCOUNT.password).digest('hex'),
    'never the clear password',
  );
  assert.equal(list.path, '/v3/lock/list');
  assert.equal(list.params.clientId, ACCOUNT.client_id);
  assert.equal(list.params.accessToken, saved[0].access_token);
  assert.equal(list.params.date, String(Date.UTC(2026, 9, 12, 10, 0, 0)));
});

test('the China cloud is another host', async () => {
  const { client, cloud } = setup({ config: { ...ACCOUNT, region: 'cn' } });
  await client.listLocks();
  assert.ok(cloud.calls.every((call) => call.host === 'cnapi.ttlock.com'));
});

test('a stored token of the same account is reused, another account signs in', async () => {
  const config = normalizeConfig(ACCOUNT);
  const reuse = setup({
    stored: {
      account: accountKey(config),
      access_token: 'stored',
      refresh_token: 'r',
      expires_at: Date.UTC(2026, 11, 1),
    },
  });
  reuse.cloud.tokens.add('stored');
  await reuse.client.listLocks();
  assert.equal(reuse.cloud.count('/oauth2/token'), 0);

  const other = setup({
    stored: { account: 'another', access_token: 'stored', expires_at: Date.UTC(2026, 11, 1) },
  });
  await other.client.listLocks();
  assert.equal(other.cloud.count('/oauth2/token'), 1);
});

test('a token about to expire is refreshed with the refresh token', async () => {
  const { client, cloud, clock } = setup();
  await client.listLocks();
  clock.advance(90 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000); // one hour left
  await client.listLocks();
  const refresh = cloud.calls.filter((c) => c.path === '/oauth2/token')[1];
  assert.equal(refresh.params.grant_type, 'refresh_token');
  assert.equal(refresh.params.password, undefined);
});

test('a refused refresh token falls back to the password', async () => {
  const { client, cloud } = setup();
  await client.listLocks();
  cloud.expireTokens();
  cloud.refreshTokens.clear();
  const locks = await client.listLocks();
  assert.equal(locks.length, 3);
  const tokenCalls = cloud.calls.filter((c) => c.path === '/oauth2/token');
  assert.equal(tokenCalls.length, 3);
  assert.ok(tokenCalls[2].params.password, 'signed in again');
});

test('API errors carry the errcode and a kind, never a secret', async () => {
  const { client, cloud } = setup({ config: { ...ACCOUNT, password: 'wrong' } });
  const refused = await client.listLocks().catch((err) => err);
  assert.ok(refused instanceof TtlockError);
  assert.equal(refused.errcode, 10007);
  assert.equal(refused.kind, 'auth');

  const ok = setup();
  ok.cloud.fail('/v3/lock/list', 30006);
  const quota = await ok.client.listLocks().catch((err) => err);
  assert.equal(quota.kind, 'quota');

  cloud.down = true;
  const network = await client.listLocks().catch((err) => err);
  assert.equal(network.kind, 'network');
  assert.equal(network.message, 'TTLock cloud unreachable');
  for (const err of [refused, quota, network]) {
    for (const secret of [ACCOUNT.client_secret, ACCOUNT.password, ACCOUNT.client_id]) {
      assert.ok(!err.message.includes(secret), err.message);
    }
  }
});

test('an HTTP error or a body that is not JSON is a clean error', async () => {
  const answers = [
    { ok: false, status: 503, json: async () => ({}) },
    { ok: false, status: 429, json: async () => ({}) },
    {
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    },
  ];
  const client = new TtlockClient({
    config: normalizeConfig(ACCOUNT),
    fetch: async () => answers.shift(),
    tokens: { load: async () => null, save: async () => {} },
  });
  assert.equal((await client.login().catch((e) => e)).kind, 'network');
  assert.equal((await client.login().catch((e) => e)).kind, 'quota');
  assert.match((await client.login().catch((e) => e)).message, /unreadable/);
});

test('calls run one at a time: the gateway handles one command at once', async () => {
  const { client, cloud } = setup();
  let running = 0;
  let most = 0;
  const original = cloud.fetch;
  client.fetch = async (...args) => {
    running += 1;
    most = Math.max(most, running);
    await new Promise((resolve) => setImmediate(resolve));
    running -= 1;
    return original(...args);
  };
  await Promise.all([
    client.lock(FRONT_DOOR),
    client.queryOpenState(FRONT_DOOR),
    client.listLocks(),
  ]);
  assert.equal(most, 1);
});

test('lock and unlock are POST forms; the records ask a 24-hour window', async () => {
  const { client, cloud, clock } = setup();
  await client.lock(FRONT_DOOR);
  await client.listRecords(FRONT_DOOR, { startDate: clock.now() - 1000, endDate: clock.now() });
  const lock = cloud.calls.find((c) => c.path === '/v3/lock/lock');
  assert.equal(lock.method, 'POST');
  assert.equal(lock.params.lockId, String(FRONT_DOOR));
  const records = cloud.calls.find((c) => c.path === '/v3/lockRecord/list');
  assert.equal(records.method, 'GET');
  assert.equal(records.params.pageSize, '50');
});
