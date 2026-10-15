// -----------------------------------------------------------------------------
// The records of a lock ("lockRecord/list"): who did what, and how.
//
// `recordType` is the cloud's record type (euopen.ttlock.com, "Record type
// from cloud"); the table below gives, for each one, what it did to the lock
// (unlock / lock) and the way it was done. Types read from the TTLock
// documentation and from the RecordType enum of the Home Assistant
// integration (jbergler/hass-ttlock, MIT). A type missing here is neither an
// access nor a state change: it is ignored.
//
// The method keys are the options of the "Lock unlocked" trigger filter:
// published keys, never renamed.
// -----------------------------------------------------------------------------

export const ACTION = { UNLOCK: 'unlock', LOCK: 'lock' };

/** The ways a lock is operated, as offered by the trigger filter. */
export const METHODS = [
  'app',
  'remote',
  'passcode',
  'card',
  'fingerprint',
  'face',
  'palm_vein',
  'key',
  'fob',
  'qr_code',
  'button',
  'auto',
];

// recordType → [action, method]
const RECORD_TYPES = {
  1: [ACTION.UNLOCK, 'app'], // unlock by app (Bluetooth)
  4: [ACTION.UNLOCK, 'passcode'],
  7: [ACTION.UNLOCK, 'card'],
  8: [ACTION.UNLOCK, 'fingerprint'],
  9: [ACTION.UNLOCK, 'fob'], // wrist strap
  10: [ACTION.UNLOCK, 'key'], // mechanical key
  11: [ACTION.LOCK, 'app'],
  12: [ACTION.UNLOCK, 'remote'], // through the gateway: the app from afar, or the API
  32: [ACTION.UNLOCK, 'button'], // opened from inside
  33: [ACTION.LOCK, 'fingerprint'],
  34: [ACTION.LOCK, 'passcode'],
  35: [ACTION.LOCK, 'card'],
  36: [ACTION.LOCK, 'key'],
  45: [ACTION.LOCK, 'auto'], // auto lock
  46: [ACTION.UNLOCK, 'button'], // unlock key of the lock
  47: [ACTION.LOCK, 'button'], // lock key of the lock
  49: [ACTION.UNLOCK, 'card'], // hotel card
  50: [ACTION.UNLOCK, 'auto'], // unlocked by a high temperature
  52: [ACTION.LOCK, 'app'], // dead lock with the app
  53: [ACTION.LOCK, 'passcode'], // dead lock with a passcode
  55: [ACTION.UNLOCK, 'fob'], // key fob
  57: [ACTION.UNLOCK, 'qr_code'],
  61: [ACTION.LOCK, 'qr_code'],
  63: [ACTION.UNLOCK, 'auto'], // auto unlock when passage mode starts
  67: [ACTION.UNLOCK, 'face'],
  69: [ACTION.LOCK, 'face'],
  75: [ACTION.UNLOCK, 'app'], // app authorization button
  76: [ACTION.UNLOCK, 'remote'], // gateway authorization key
  77: [ACTION.UNLOCK, 'app'], // dual authentication, Bluetooth
  78: [ACTION.UNLOCK, 'passcode'], // dual authentication
  79: [ACTION.UNLOCK, 'fingerprint'], // dual authentication
  80: [ACTION.UNLOCK, 'card'], // dual authentication
  81: [ACTION.UNLOCK, 'face'], // dual authentication
  82: [ACTION.UNLOCK, 'fob'], // dual authentication, remote control
  83: [ACTION.UNLOCK, 'palm_vein'], // dual authentication
  84: [ACTION.UNLOCK, 'palm_vein'],
  92: [ACTION.UNLOCK, 'passcode'], // administrator passcode
};

/**
 * A record of the API, reduced to what the integration uses. Never keeps
 * `keyboardPwd`: it holds the passcode itself, or a card or fingerprint number.
 * @param {object} raw
 * @returns {{ id: string, lockId: number, action: string, method: string, success: boolean,
 *   user: string, lockDate: number, serverDate: number } | null} null for a record that is no access
 */
export function parseRecord(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const meaning = RECORD_TYPES[Number(raw.recordType)];
  const lockDate = Number(raw.lockDate);
  if (!meaning || !Number.isFinite(lockDate)) {
    return null;
  }
  const [action, method] = meaning;
  const serverDate = Number(raw.serverDate);
  return {
    id: String(raw.recordId ?? `${raw.lockId}:${lockDate}:${raw.recordType}`),
    lockId: Number(raw.lockId),
    action,
    method,
    success: Number(raw.success) === 1,
    // App account, or the name given to the passcode, card or fingerprint.
    user: typeof raw.username === 'string' ? raw.username.trim().slice(0, 60) : '',
    lockDate,
    serverDate: Number.isFinite(serverDate) ? serverDate : lockDate,
  };
}

/** Newest first; the record id settles a tie. */
export function byNewest(a, b) {
  return b.lockDate - a.lockDate || (b.id > a.id ? 1 : b.id < a.id ? -1 : 0);
}

// Feature bits of `featureValue` (hex string), per the TTLock documentation
// ("featureValue"): a lock without the remote unlock feature cannot be
// opened through the gateway, one with WiFi needs no gateway.
const FEATURE_BITS = {
  lockCommand: 8n,
  remoteUnlock: 10n,
  passageMode: 22n,
  wifi: 56n,
};

/** @param {string|undefined} featureValue */
export function lockFeatures(featureValue) {
  let bits = 0n;
  try {
    bits = featureValue ? BigInt(`0x${featureValue}`) : 0n;
  } catch {
    bits = 0n;
  }
  const has = (bit) => (bits >> bit) % 2n === 1n;
  return {
    // Unknown (no featureValue): assumed, the cloud says no when it is not.
    lockCommand: !featureValue || has(FEATURE_BITS.lockCommand),
    remoteUnlock: has(FEATURE_BITS.remoteUnlock),
    passageMode: has(FEATURE_BITS.passageMode),
    wifi: has(FEATURE_BITS.wifi),
  };
}
