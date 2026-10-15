// -----------------------------------------------------------------------------
// A fake TTLock cloud, served through a `fetch` replacement: the answers of
// test/fixtures/ttlock, a token scheme like the real one (MD5 password,
// errcode 10004 on an unknown token, 80000 on a date 5 minutes off), and
// locks whose state, battery, records and gateway the tests change.
// Counts the calls by path, so the tests can hold the integration to its
// API budget. Never touches the network.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/ttlock/${name}.json`, import.meta.url), 'utf8'));

export const FIXTURES = {
  token: fixture('oauth-token'),
  locks: fixture('lock-list').list,
  gateways: fixture('gateway-list').list,
  gatewayLinks: fixture('gateway-listByLock').list,
  locked: fixture('lock-queryOpenState-locked'),
  unlocked: fixture('lock-queryOpenState-unlocked'),
  records: fixture('lockRecord-list').list,
  errors: fixture('errors'),
};

export const ACCOUNT = {
  client_id: 'c0ffee00c0ffee00c0ffee00c0ffee00',
  client_secret: 'secret-of-the-application-0042',
  username: 'owner@example.com',
  password: 'Passw0rd of the app',
};

export const FRONT_DOOR = 1001001;
export const GARAGE = 1001002; // WiFi, no gateway
export const KEY_BOX = 1001003; // Bluetooth only
export const PASSCODE = '383834';

const md5 = (text) => createHash('md5').update(text, 'utf8').digest('hex');

export class FakeTtlockCloud {
  constructor({ now = () => Date.now(), account = ACCOUNT } = {}) {
    this.now = now;
    this.account = account;
    this.locks = structuredClone(FIXTURES.locks);
    this.gateways = structuredClone(FIXTURES.gateways);
    /** lockId -> open state answered by queryOpenState (0 locked, 1 unlocked, 2 unknown). */
    this.states = new Map(this.locks.map((lock) => [lock.lockId, 0]));
    /** lockId -> records. */
    this.records = new Map(this.locks.map((lock) => [lock.lockId, []]));
    this.passage = new Map();
    this.tokens = new Set();
    this.refreshTokens = new Set();
    this.tokenCount = 0;
    this.calls = [];
    /** path -> { errcode, times } failures to answer. */
    this.failures = new Map();
    this.down = false;
    this.fetch = this.fetch.bind(this);
  }

  // --- test controls --------------------------------------------------------

  /** Answer `errcode` on `path`, `times` times (Infinity: until cleared). */
  fail(path, errcode, times = 1) {
    this.failures.set(path, { errcode, times });
  }

  clearFailures() {
    this.failures.clear();
  }

  /** A record, as the gateway uploads it (operation time `ago` ms before now). */
  addRecord(
    lockId,
    { recordType, success = 1, username = 'Alex', keyboardPwd, ago = 0, late = 0 },
  ) {
    const list = this.records.get(lockId);
    const lockDate = this.now() - ago;
    list.push({
      recordId: 1_700_000_000 + this.calls.length * 100 + list.length,
      lockId,
      recordTypeFromLock: recordType,
      recordType,
      success,
      username,
      ...(keyboardPwd ? { keyboardPwd } : {}),
      lockDate,
      serverDate: lockDate + late,
    });
  }

  setBattery(lockId, level) {
    this.locks.find((lock) => lock.lockId === lockId).electricQuantity = level;
  }

  setGatewayOnline(online) {
    for (const gateway of this.gateways) {
      gateway.isOnline = online ? 1 : 0;
    }
  }

  /** Revoke every access token (as after 90 days). */
  expireTokens() {
    this.tokens.clear();
  }

  count(path) {
    return this.calls.filter((call) => call.path === path).length;
  }

  // --- the API --------------------------------------------------------------

  async fetch(url, init = {}) {
    if (this.down) {
      throw new TypeError(`fetch failed for ${url}`);
    }
    const parsed = new URL(url);
    const params = Object.fromEntries(
      init.method === 'POST' ? new URLSearchParams(init.body ?? '') : parsed.searchParams,
    );
    const path = parsed.pathname;
    this.calls.push({ path, method: init.method, params, host: parsed.host });
    return jsonResponse(this.answer(path, params));
  }

  answer(path, params) {
    const failure = this.failures.get(path);
    if (failure && failure.times > 0) {
      failure.times -= 1;
      return { errcode: failure.errcode, errmsg: 'injected failure' };
    }
    if (path === '/oauth2/token') {
      return this.token(params);
    }
    if (params.clientId !== this.account.client_id) {
      return FIXTURES.errors.invalidClient;
    }
    if (!this.tokens.has(params.accessToken)) {
      return FIXTURES.errors.tokenInvalid;
    }
    if (Math.abs(Number(params.date) - this.now()) > 5 * 60 * 1000) {
      return { errcode: 80000, errmsg: 'date must be current time, in 5 minutes' };
    }
    const lockId = Number(params.lockId);
    const lock = this.locks.find((entry) => entry.lockId === lockId);
    const connectable = (entry) =>
      entry && (entry.hasGateway === 1 || (BigInt(`0x${entry.featureValue}`) >> 56n) % 2n === 1n);
    const gatewayOnline = this.gateways.some((gateway) => gateway.isOnline === 1);
    const reach = () => {
      if (!lock) return { errcode: -1003, errmsg: 'Lock does not exist' };
      if (!connectable(lock)) return { errcode: -2012, errmsg: 'not connected to any gateway' };
      if (lock.hasGateway === 1 && !gatewayOnline) return FIXTURES.errors.gatewayOffline;
      return null;
    };
    switch (path) {
      case '/v3/lock/list':
        return { list: structuredClone(this.locks), pageNo: 1, pages: 1, total: this.locks.length };
      case '/v3/gateway/list':
        return {
          list: structuredClone(this.gateways),
          pageNo: 1,
          pages: 1,
          total: this.gateways.length,
        };
      case '/v3/gateway/listByLock':
        return { list: lock?.hasGateway === 1 ? structuredClone(FIXTURES.gatewayLinks) : [] };
      case '/v3/lock/queryOpenState':
        return (
          reach() ?? {
            state: this.states.get(lockId),
            electricQuantity: lock.electricQuantity,
            lockTime: this.now(),
          }
        );
      case '/v3/lock/lock':
        return reach() ?? (this.states.set(lockId, 0), FIXTURES.errors.success);
      case '/v3/lock/unlock':
        return reach() ?? (this.states.set(lockId, 1), FIXTURES.errors.success);
      case '/v3/lock/configPassageMode':
        return reach() ?? (this.passage.set(lockId, { ...params }), FIXTURES.errors.success);
      case '/v3/lockRecord/list': {
        const start = Number(params.startDate ?? 0);
        const end = Number(params.endDate ?? Infinity);
        const list = (this.records.get(lockId) ?? [])
          .filter((record) => record.lockDate >= start && record.lockDate <= end)
          // Newest first, like the documentation's example ids.
          .sort((a, b) => b.recordId - a.recordId)
          .slice(0, Number(params.pageSize ?? 20));
        return { list: structuredClone(list), pageNo: 1, pages: 1, total: list.length };
      }
      default:
        return { errcode: -3, errmsg: 'Invalid Parameter' };
    }
  }

  token(params) {
    if (
      params.clientId !== this.account.client_id ||
      params.clientSecret !== this.account.client_secret
    ) {
      return FIXTURES.errors.invalidClient;
    }
    if (params.grant_type === 'refresh_token') {
      if (!this.refreshTokens.has(params.refresh_token)) {
        return { errcode: 10011, errmsg: 'invalid refresh_token' };
      }
    } else if (
      params.username !== this.account.username ||
      params.password !== md5(this.account.password)
    ) {
      return FIXTURES.errors.invalidAccount;
    }
    this.tokenCount += 1;
    const suffix = String(this.tokenCount).padStart(4, '0');
    const token = {
      ...FIXTURES.token,
      access_token: `${FIXTURES.token.access_token.slice(0, 28)}${suffix}`,
      refresh_token: `${FIXTURES.token.refresh_token.slice(0, 28)}${suffix}`,
    };
    this.tokens.add(token.access_token);
    this.refreshTokens.add(token.refresh_token);
    return token;
  }
}

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => structuredClone(body),
  };
}
