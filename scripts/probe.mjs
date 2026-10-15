#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe of the real TTLock cloud, read-only, with the integration's own client.
//
//   node scripts/probe.mjs              fake application: runs the real sign-in
//                                       until TTLock refuses it (needs nothing)
//   TTLOCK_CLIENT_ID=... TTLOCK_CLIENT_SECRET=... \
//   TTLOCK_USERNAME=... TTLOCK_PASSWORD=... [TTLOCK_REGION=eu|cn] \
//   node scripts/probe.mjs              real account: signs in, lists the locks
//                                       and gateways, reads the state and the
//                                       records of the first connectable lock
//
// Never locks, unlocks or changes anything. Prints the shape of the answers
// (counts, field names, errcodes), never a token, a secret, a name, a MAC
// address or a passcode. The token is kept in memory only.
// -----------------------------------------------------------------------------

import { normalizeConfig } from '../src/config.js';
import { parseLock } from '../src/devices.js';
import { TtlockClient } from '../src/ttlock/client.js';
import { parseRecord } from '../src/ttlock/records.js';

const env = process.env;
const real = Boolean(env.TTLOCK_CLIENT_ID);
const config = normalizeConfig({
  region: env.TTLOCK_REGION ?? 'eu',
  client_id: env.TTLOCK_CLIENT_ID ?? '0123456789abcdef0123456789abcdef',
  client_secret: env.TTLOCK_CLIENT_SECRET ?? 'fedcba9876543210fedcba9876543210',
  username: env.TTLOCK_USERNAME ?? 'probe@example.com',
  password: env.TTLOCK_PASSWORD ?? 'not-a-real-password',
});

let token = null;
const client = new TtlockClient({
  config,
  tokens: { load: async () => token, save: async (value) => void (token = value) },
});

const say = (...parts) => console.log(...parts);
const keys = (object) =>
  Object.keys(object ?? {})
    .sort()
    .join(', ');

async function step(label, run) {
  const started = Date.now();
  try {
    const result = await run();
    say(`✔ ${label} (${Date.now() - started} ms)`);
    return result;
  } catch (err) {
    say(`✘ ${label} (${Date.now() - started} ms): ${err.message} [kind ${err.kind ?? '?'}]`);
    return undefined;
  }
}

say(`TTLock probe — ${real ? 'real account' : 'fake application'}, region ${config.region}`);

if (!real) {
  // The refusal is the expected answer: it proves the host, the form encoding
  // and the error parsing against the real cloud.
  const refusal = await client.checkLogin().then(
    () => null,
    (err) => err,
  );
  if (refusal?.kind === 'auth') {
    say(`✔ TTLock refused the fake application as expected: ${refusal.message}`);
    process.exit(0);
  }
  say(
    refusal
      ? `✘ unexpected answer: ${refusal.message} [kind ${refusal.kind}]`
      : '✘ the fake application was accepted?!',
  );
  process.exit(1);
}

if (!(await step('sign-in', () => client.checkLogin()))) {
  process.exit(1);
}
say(`  token expires in ${Math.round((token.expires_at - Date.now()) / 86_400_000)} days`);

const rawLocks = await step('lock/list', () => client.listLocks());
const locks = (rawLocks ?? []).map(parseLock);
say(`  ${locks.length} lock(s); fields of the first: ${keys(rawLocks?.[0])}`);
for (const [index, lock] of locks.entries()) {
  say(
    `  lock #${index + 1}: gateway ${lock.hasGateway}, wifi ${lock.features.wifi}, ` +
      `lock command ${lock.features.lockCommand}, remote unlock ${lock.features.remoteUnlock}, ` +
      `passage mode ${lock.features.passageMode}, battery ${lock.battery}`,
  );
}

const gateways = await step('gateway/list', () => client.listGateways());
say(
  `  ${gateways?.length ?? 0} gateway(s), ${gateways?.filter((g) => Number(g.isOnline) === 1).length ?? 0} online; fields: ${keys(gateways?.[0])}`,
);

const lock = locks.find((entry) => entry.connectable);
if (!lock) {
  say('No lock with a gateway or WiFi: state not probed.');
} else {
  const links = await step('gateway/listByLock (first connectable lock)', () =>
    client.gatewaysOfLock(lock.id),
  );
  say(`  ${links?.length ?? 0} gateway(s) in range; fields: ${keys(links?.[0])}`);
  const state = await step('lock/queryOpenState (through the gateway)', () =>
    client.queryOpenState(lock.id),
  );
  say(`  state ${state?.state} (0 locked, 1 unlocked, 2 unknown); fields: ${keys(state)}`);
}

const first = locks[0];
if (first) {
  const now = Date.now();
  const records = await step('lockRecord/list (first lock, last 24 hours)', () =>
    client.listRecords(first.id, { startDate: now - 86_400_000, endDate: now }),
  );
  const list = records?.list ?? [];
  const ids = list.map((record) => Number(record.recordId));
  say(
    `  ${list.length} record(s) of ${records?.total ?? 0}; order of the ids: ${
      ids.every((id, i) => i === 0 || ids[i - 1] >= id) ? 'newest first' : 'not newest first'
    }; fields: ${keys(list[0])}`,
  );
  const types = new Map();
  for (const raw of list) {
    const parsed = parseRecord(raw);
    const key = `${raw.recordType}→${parsed ? `${parsed.action}/${parsed.method}` : 'ignored'}`;
    types.set(key, (types.get(key) ?? 0) + 1);
  }
  say(
    `  record types: ${[...types].map(([type, count]) => `${type} ×${count}`).join(', ') || 'none'}`,
  );
}

say(`API calls made: ${[...client.calls].map(([path, count]) => `${path} ×${count}`).join(', ')}`);
