// -----------------------------------------------------------------------------
// Client of the TTLock Open Platform cloud API (v3).
//
// The locks never talk to Gladys: a gateway (G2, G3...) or the lock's own
// WiFi relays every command from TTLock's cloud. Authentication is the OAuth2
// "password" grant: the client ID and secret of a developer application
// (euopen.ttlock.com), plus the account of the TTLock app, whose password is
// sent MD5-hashed. Then every request carries clientId, accessToken and the
// current date (ms; refused when 5 minutes off, errcode 80000).
//
// TTLock answers HTTP 200 with `errcode`/`errmsg` even on failure: an HTTP
// success does not mean the call succeeded.
//
// The calls are serialized: the gateway cannot handle concurrent commands
// (lesson of the Home Assistant integration), and one call at a time is
// also the gentlest way to spend the account's API quota.
//
// Never log or throw a token, the client secret or the password: the errors
// carry the API errcode and message only.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { REGIONS } from '../config.js';

const REQUEST_TIMEOUT_MS = 20_000;

// Refresh the token this long before it expires (it lives 90 days).
const REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000;

// errcodes meaning the credentials themselves are wrong: retrying is useless.
export const AUTH_ERRCODES = new Set([10000, 10001, 10007, 30005]);
// The token is no longer valid: get a new one, then retry once.
const TOKEN_ERRCODES = new Set([10003, 10004, 10011]);

export const ERRCODE = {
  INVALID_CLIENT: 10001,
  CLIENT_NOT_FOUND: 10000,
  BAD_ACCOUNT: 10007,
  TOKEN_INVALID: 10004,
  QUOTA: 30006,
  NOT_ADMIN: 20002,
  PERMISSION: -2018,
  NO_GATEWAY: -2012,
  GATEWAY_OFFLINE: -3002,
  GATEWAY_BUSY: -3003,
  LOCK_OFFLINE: -3036,
  LOCK_BUSY: -3037,
  NOT_SUPPORTED: -4043,
  FROZEN: -2025,
};

export class TtlockError extends Error {
  /**
   * @param {string} message never contains a secret
   * @param {{ errcode?: number, status?: number, kind?: string }} [details]
   */
  constructor(message, { errcode, status, kind } = {}) {
    super(message);
    this.name = 'TtlockError';
    this.errcode = errcode;
    this.status = status;
    // 'auth' | 'quota' | 'network' | 'api'
    this.kind = kind ?? classify(errcode);
  }
}

function classify(errcode) {
  if (AUTH_ERRCODES.has(errcode)) {
    return 'auth';
  }
  if (errcode === ERRCODE.QUOTA) {
    return 'quota';
  }
  return 'api';
}

export const md5 = (text) => createHash('md5').update(text, 'utf8').digest('hex');

/** Identity of an account, to know whether a stored token belongs to it. */
export function accountKey(config) {
  return createHash('sha256')
    .update([config.region, config.client_id, config.username].join('\n'))
    .digest('hex')
    .slice(0, 32);
}

// The API message is shown to the user and logged: short, and never a value
// we sent (the API does not echo them, but better safe).
function cleanMessage(message) {
  return String(message ?? '')
    .replace(/[0-9a-f]{32}/gi, '…')
    .slice(0, 120);
}

export class TtlockClient {
  /**
   * @param {object} options
   * @param {object} options.config normalized config
   * @param {{ load: () => Promise<object|null>, save: (token: object|null) => Promise<void> }} options.tokens
   * @param {typeof fetch} [options.fetch]
   * @param {() => number} [options.now]
   */
  constructor({ config, tokens, fetch = globalThis.fetch, now = () => Date.now() }) {
    this.config = config;
    this.tokens = tokens;
    this.fetch = fetch;
    this.now = now;
    this.base = REGIONS[config.region] ?? REGIONS.eu;
    this.account = accountKey(config);
    this.token = null;
    this.tokenLoaded = false;
    this.queue = Promise.resolve();
    /** API calls made, by path (token requests included): shown by the test action. */
    this.calls = new Map();
  }

  // --- transport ------------------------------------------------------------

  /** Run one call after the previous ones. */
  serialize(task) {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  async send(method, path, params) {
    this.calls.set(path, (this.calls.get(path) ?? 0) + 1);
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        body.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
      }
    }
    const url = method === 'GET' ? `${this.base}${path}?${body}` : `${this.base}${path}`;
    let response;
    try {
      response = await this.fetch(url, {
        method,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: method === 'GET' ? undefined : body.toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // The fetch error may embed the URL, hence the query and its token: never reuse its text.
      const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      throw new TtlockError(
        timeout ? 'TTLock cloud did not answer in time' : 'TTLock cloud unreachable',
        {
          kind: 'network',
        },
      );
    }
    if (response.status === 429) {
      throw new TtlockError('TTLock cloud: too many requests (HTTP 429)', {
        status: 429,
        kind: 'quota',
      });
    }
    if (!response.ok) {
      throw new TtlockError(`TTLock cloud answered HTTP ${response.status}`, {
        status: response.status,
        kind: response.status >= 500 ? 'network' : 'api',
      });
    }
    let json;
    try {
      json = await response.json();
    } catch {
      throw new TtlockError('TTLock cloud sent an unreadable answer', { kind: 'network' });
    }
    if (!json || typeof json !== 'object') {
      throw new TtlockError('TTLock cloud sent an unreadable answer', { kind: 'network' });
    }
    const errcode = Number(json.errcode ?? 0);
    if (errcode !== 0) {
      throw new TtlockError(`TTLock error ${errcode}: ${cleanMessage(json.errmsg)}`, { errcode });
    }
    return json;
  }

  // --- authentication -------------------------------------------------------

  async tokenRequest(params) {
    const json = await this.send('POST', '/oauth2/token', {
      clientId: this.config.client_id,
      clientSecret: this.config.client_secret,
      ...params,
    });
    if (typeof json.access_token !== 'string' || !json.access_token) {
      // An OAuth-style refusal ({ error, error_description }) without errcode.
      throw new TtlockError(`TTLock refused the sign-in: ${cleanMessage(json.error ?? '')}`, {
        kind: 'auth',
      });
    }
    const token = {
      account: this.account,
      access_token: json.access_token,
      refresh_token: json.refresh_token ?? null,
      uid: json.uid ?? null,
      expires_at: this.now() + Number(json.expires_in ?? 7_776_000) * 1000,
    };
    this.token = token;
    await this.tokens.save(token);
    return token;
  }

  /** Sign in with the account of the TTLock app. */
  login() {
    return this.tokenRequest({
      username: this.config.username,
      password: md5(this.config.password),
    });
  }

  async refresh() {
    if (!this.token?.refresh_token) {
      return this.login();
    }
    try {
      return await this.tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: this.token.refresh_token,
      });
    } catch (err) {
      if (err.kind === 'network' || err.kind === 'quota') {
        throw err;
      }
      // Refresh token refused: sign in again with the password.
      return this.login();
    }
  }

  /** A valid access token: stored, refreshed or new. */
  async accessToken() {
    if (!this.tokenLoaded) {
      this.tokenLoaded = true;
      const stored = await this.tokens.load();
      // A token of another account (the configuration changed) is ignored.
      this.token = stored?.account === this.account ? stored : null;
    }
    if (!this.token) {
      await this.login();
    } else if (this.token.expires_at - this.now() < REFRESH_MARGIN_MS) {
      await this.refresh();
    }
    return this.token.access_token;
  }

  /** An authenticated API call; a token the cloud no longer accepts is renewed once. */
  call(method, path, params = {}) {
    return this.serialize(async () => {
      const signed = async () =>
        this.send(method, path, {
          clientId: this.config.client_id,
          accessToken: await this.accessToken(),
          ...params,
          date: this.now(),
        });
      try {
        return await signed();
      } catch (err) {
        if (!TOKEN_ERRCODES.has(err.errcode)) {
          throw err;
        }
        await this.refresh();
        return signed();
      }
    });
  }

  /** Sign in now (test action): proves the four account fields. */
  checkLogin() {
    return this.serialize(() => this.accessToken());
  }

  // --- API ------------------------------------------------------------------

  /** Locks of which the account is the administrator. */
  async listLocks() {
    const json = await this.call('GET', '/v3/lock/list', { pageNo: 1, pageSize: 1000 });
    return Array.isArray(json.list) ? json.list : [];
  }

  async listGateways() {
    const json = await this.call('GET', '/v3/gateway/list', {
      pageNo: 1,
      pageSize: 200,
      orderBy: 0,
    });
    return Array.isArray(json.list) ? json.list : [];
  }

  /** Gateways in range of a lock. */
  async gatewaysOfLock(lockId) {
    const json = await this.call('GET', '/v3/gateway/listByLock', { lockId });
    return Array.isArray(json.list) ? json.list : [];
  }

  /**
   * Open state, asked to the lock through its gateway or WiFi.
   * @returns {Promise<{ state: number, electricQuantity?: number }>} 0 locked, 1 unlocked, 2 unknown
   */
  queryOpenState(lockId) {
    return this.call('GET', '/v3/lock/queryOpenState', { lockId });
  }

  lock(lockId) {
    return this.call('POST', '/v3/lock/lock', { lockId });
  }

  unlock(lockId) {
    return this.call('POST', '/v3/lock/unlock', { lockId });
  }

  getPassageMode(lockId) {
    return this.call('GET', '/v3/lock/getPassageModeConfig', { lockId });
  }

  /**
   * Passage mode on (all day, every day, without unlocking by itself) or off.
   * @param {number} lockId
   * @param {boolean} enabled
   */
  setPassageMode(lockId, enabled) {
    return this.call('POST', '/v3/lock/configPassageMode', {
      lockId,
      passageMode: enabled ? 1 : 2,
      cyclicConfig: enabled
        ? [{ isAllDay: 1, startTime: 0, endTime: 0, weekDays: [1, 2, 3, 4, 5, 6, 7] }]
        : undefined,
      autoUnlock: enabled ? 2 : undefined,
      type: 2, // through the gateway or the lock's WiFi
    });
  }

  /**
   * The records of a lock between two dates (operation time on the lock).
   * @returns {Promise<{ list: object[], total: number }>}
   */
  async listRecords(lockId, { startDate, endDate, pageSize = 50 }) {
    const json = await this.call('GET', '/v3/lockRecord/list', {
      lockId,
      startDate,
      endDate,
      pageNo: 1,
      pageSize,
    });
    return { list: Array.isArray(json.list) ? json.list : [], total: Number(json.total ?? 0) };
  }
}
