// -----------------------------------------------------------------------------
// Records and lock features, from the documented answers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLock } from '../src/devices.js';
import { ACTION, METHODS, byNewest, lockFeatures, parseRecord } from '../src/ttlock/records.js';
import { FIXTURES, FRONT_DOOR, GARAGE, KEY_BOX } from './helpers/fakeTtlock.js';

test('the documented records: unlocked by app, then by passcode', () => {
  const [app, passcode] = FIXTURES.records.map(parseRecord);
  assert.deepEqual(app, {
    id: '1635556821',
    lockId: 1001001,
    action: ACTION.UNLOCK,
    method: 'app',
    success: true,
    user: 'alex@example.com',
    lockDate: 1616674054000,
    serverDate: 1616674056000,
  });
  assert.equal(passcode.method, 'passcode');
  assert.equal(passcode.user, 'Alex');
  assert.ok(!JSON.stringify(passcode).includes('383834'), 'keyboardPwd is never kept');
  assert.deepEqual([app, passcode].sort(byNewest), [passcode, app]);
});

test('locking records, failed attempts and unknown types', () => {
  const base = { recordId: 1, lockId: 1, lockDate: 1, serverDate: 2, success: 1 };
  assert.deepEqual(
    [45, 47, 11, 36].map((recordType) => parseRecord({ ...base, recordType }).action),
    ['lock', 'lock', 'lock', 'lock'],
  );
  assert.equal(parseRecord({ ...base, recordType: 45 }).method, 'auto');
  assert.equal(parseRecord({ ...base, recordType: 8, success: 0 }).success, false);
  // Door sensor, tamper alert, system locked: not an access.
  for (const recordType of [30, 31, 44, 48, 999]) {
    assert.equal(parseRecord({ ...base, recordType }), null, String(recordType));
  }
  assert.equal(parseRecord(null), null);
  assert.equal(parseRecord({ ...base, recordType: 1, lockDate: undefined }), null);
});

test('every method a record maps to is offered by the trigger, and back', () => {
  const seen = new Set();
  for (let recordType = 0; recordType < 200; recordType += 1) {
    const record = parseRecord({ recordId: 1, lockId: 1, lockDate: 1, recordType, success: 1 });
    if (record) seen.add(record.method);
  }
  assert.deepEqual([...seen].sort(), [...METHODS].sort());
});

test('feature bits: gateway unlock, passage mode, WiFi', () => {
  // From the Home Assistant fixture: lock command, gateway unlock and passage mode.
  assert.deepEqual(lockFeatures('F44354CD5F3'), {
    lockCommand: true,
    remoteUnlock: true,
    passageMode: true,
    wifi: false,
  });
  assert.equal(lockFeatures('1000F44354CD5F3').wifi, true);
  assert.equal(lockFeatures('0').lockCommand, false);
  assert.equal(lockFeatures(undefined).lockCommand, true, 'unknown: assumed');
  assert.equal(lockFeatures('not hex').wifi, false);
});

test('the fixture locks: gateway, WiFi, Bluetooth only', () => {
  const locks = Object.fromEntries(FIXTURES.locks.map((raw) => [raw.lockId, parseLock(raw)]));
  assert.equal(locks[FRONT_DOOR].connectable, true);
  assert.equal(locks[FRONT_DOOR].hasGateway, true);
  assert.equal(locks[GARAGE].connectable, true);
  assert.equal(locks[GARAGE].hasGateway, false);
  assert.equal(locks[KEY_BOX].connectable, false);
  assert.equal(locks[FRONT_DOOR].name, 'Front door');
  assert.equal(parseLock({ lockId: 5, lockName: 'S31_x' }).name, 'S31_x');
  assert.equal(parseLock({ lockId: 5, electricQuantity: -1 }).battery, null);
});
