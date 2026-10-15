// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake TTLock cloud, a
// temporary /data and a manual clock, with the integration wired on top
// through registerHandlers. No timer runs unless `timers: true` (with
// node:test mock timers): the tests refresh with `world.hub.cycle()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { lockIds } from '../../src/devices.js';
import { Store } from '../../src/store.js';
import { ACCOUNT, FakeTtlockCloud } from './fakeTtlock.js';

// The integration logs its lifecycle; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

/** A manual clock, shared by the hub and the fake cloud. */
export function createClock(start = Date.UTC(2026, 9, 12, 10, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export const BASE_CONFIG = { ...ACCOUNT, language: 'en' };

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 */
export async function createWorld({
  clock = createClock(),
  cloud,
  config = BASE_CONFIG,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-ttlock-')),
  timings = {},
  timers = false,
  store,
} = {}) {
  const ttlock = cloud ?? new FakeTtlockCloud({ now: clock.now });
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: store ?? new Store(dataDir),
    fetch: ttlock.fetch,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, cloud: ttlock, app, hub: app.hub, clock, dataDir };
}

export const deviceId = (gladys, lockId) => lockIds(gladys, lockId).device;
export const featureId = (gladys, lockId, key) => lockIds(gladys, lockId).feature(key);

/** The discovered device of a lock. */
export const discovered = (world, lockId) =>
  world.fake.discoveredDevices.find(
    (device) => device.external_id === deviceId(world.gladys, lockId),
  );

/** Add discovered devices in Gladys, as the user would (all by default). */
export async function addDevices(world, lockIdList) {
  const wanted = lockIdList
    ? world.fake.discoveredDevices.filter((device) =>
        lockIdList.some((id) => device.external_id === deviceId(world.gladys, id)),
      )
    : world.fake.discoveredDevices;
  for (const device of wanted) {
    await world.fake.deviceCreated(device);
  }
}
