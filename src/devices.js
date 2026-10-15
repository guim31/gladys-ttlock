// -----------------------------------------------------------------------------
// One Gladys device per TTLock lock.
//
// Identity: `gladys.externalIds('lock', lockId)`, the lockId the TTLock cloud
// gives the lock when it is added in the app. Feature keys are published
// forever: never rename them.
//
// Choices, after the Gladys front (5.2.1):
//   - the state is a READ-ONLY `lock/state` (1 locked, 0 unlocked, the core's
//     LOCK.STATE): a writable `lock/binary` would be a switch, and a switch
//     unlocks the door with one tap, from a scene "turn everything off" or a
//     voice assistant. Unlocking only exists as an opt-in scene action;
//   - locking is a `button/push` ("Lock"): pushing it can only lock;
//   - the battery is `battery/integer`: `lock/integer` would draw a lock or
//     unlock icon for 0 and 1 percent (the front maps the lock category to
//     icons);
//   - the gateway is `input/binary` (yes/no badge);
//   - the last access is a `text/text`, min/max 0/0 (NOT NULL in the core).
// -----------------------------------------------------------------------------

import { DEVICE_POLL_FREQUENCIES } from '@gladysassistant/integration-sdk';
import { lockFeatures } from './ttlock/records.js';
import { NAMES } from './texts.js';

export const DEVICE_TYPE = 'lock';

export const FEATURE = {
  STATE: 'state',
  LOCK: 'lock',
  BATTERY: 'battery',
  GATEWAY: 'gateway',
  LAST_ACCESS: 'last_access',
};

// Gladys LOCK.STATE values (server/utils/constants.js).
export const GLADYS_LOCK_STATE = { UNLOCKED: 0, LOCKED: 1 };

/**
 * The lock as the integration keeps it, from an entry of `lock/list`.
 * @param {object} raw
 */
export function parseLock(raw) {
  const features = lockFeatures(raw.featureValue);
  const hasGateway = Number(raw.hasGateway) === 1;
  const battery = Number(raw.electricQuantity);
  return {
    id: Number(raw.lockId),
    name: String(raw.lockAlias || raw.lockName || `TTLock ${raw.lockId}`).slice(0, 80),
    model: typeof raw.lockName === 'string' ? raw.lockName : '',
    hasGateway,
    features,
    // Reachable from the cloud: through a gateway, or the lock's own WiFi.
    connectable: hasGateway || features.wifi,
    battery: Number.isFinite(battery) && battery >= 0 ? Math.min(100, battery) : null,
  };
}

/** The ids of a lock's device and features. */
export const lockIds = (gladys, lockId) => gladys.externalIds(DEVICE_TYPE, String(lockId));

/** lockId of a device external_id, null when it is not one of ours. */
export function lockIdOf(gladys, externalId) {
  const prefix = lockIds(gladys, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const id = Number(externalId.slice(prefix.length).split(':')[0]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** The locking button exists: the lock is reachable and knows the command. */
export const canLock = (lock) => lock.connectable && lock.features.lockCommand;

/**
 * The discovery payload of one lock.
 * @param {object} gladys
 * @param {ReturnType<typeof parseLock>} lock
 * @param {{ language: string }} config
 */
export function buildDevice(gladys, lock, config) {
  const ids = lockIds(gladys, lock.id);
  const names = NAMES[config.language] ?? NAMES.fr;
  const feature = (key, fields) => ({
    name: names[key],
    external_id: ids.feature(key),
    read_only: true,
    has_feedback: false,
    keep_history: true,
    ...fields,
  });
  const features = [];
  if (lock.connectable) {
    features.push(feature(FEATURE.STATE, { category: 'lock', type: 'state', min: 0, max: 1 }));
  }
  if (canLock(lock)) {
    features.push(
      feature(FEATURE.LOCK, {
        category: 'button',
        type: 'push',
        read_only: false,
        keep_history: false,
        min: 0,
        max: 1,
      }),
    );
  }
  features.push(
    feature(FEATURE.BATTERY, {
      category: 'battery',
      type: 'integer',
      unit: 'percent',
      min: 0,
      max: 100,
    }),
  );
  if (lock.hasGateway) {
    features.push(feature(FEATURE.GATEWAY, { category: 'input', type: 'binary', min: 0, max: 1 }));
  }
  features.push(feature(FEATURE.LAST_ACCESS, { category: 'text', type: 'text', min: 0, max: 0 }));

  return {
    name: lock.name,
    external_id: ids.device,
    model: lock.model || 'TTLock',
    // The container refreshes by itself (src/hub.js): the core's poll is a
    // fallback, skipped when the container has just refreshed.
    should_poll: true,
    poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
    features,
  };
}
