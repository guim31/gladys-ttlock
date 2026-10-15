import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, isConfigured, normalizeConfig, pollPeriodMs } from '../src/config.js';

test('an empty configuration gets the defaults and is not configured', () => {
  const config = normalizeConfig();
  assert.deepEqual(config, DEFAULT_CONFIG);
  assert.equal(isConfigured(config), false);
  assert.equal(pollPeriodMs(config), 5 * 60_000);
});

test('values are trimmed, choices outside the lists fall back to the defaults', () => {
  const config = normalizeConfig({
    region: 'us',
    client_id: '  abc ',
    client_secret: ' s ',
    username: ' me@example.com ',
    password: ' spaced ',
    poll_minutes: '1',
    battery_threshold: 25,
    language: 'it',
  });
  assert.equal(config.region, 'eu');
  assert.equal(config.client_id, 'abc');
  assert.equal(config.username, 'me@example.com');
  assert.equal(config.password, ' spaced ', 'a password is kept as typed');
  assert.equal(config.poll_minutes, '5');
  assert.equal(config.battery_threshold, '25');
  assert.equal(config.language, 'fr');
  assert.equal(isConfigured(config), true);
});

test('opening the door needs an explicit true', () => {
  for (const value of ['true', 1, 'yes', undefined, null]) {
    assert.equal(normalizeConfig({ allow_unlock: value }).allow_unlock, false, String(value));
    assert.equal(normalizeConfig({ allow_passage_mode: value }).allow_passage_mode, false);
  }
  assert.equal(normalizeConfig({ allow_unlock: true }).allow_unlock, true);
});
