// -----------------------------------------------------------------------------
// The hub: everything between Gladys and the TTLock cloud.
//
// Refreshing. The core cannot be trusted to poll external devices (Gladys
// #3198: a device keeps the polling fields it was created with, and 5.2.1
// still skips some), so the hub refreshes by itself on a timer, at the pace
// of the configuration; the core's onPoll is a fallback that does nothing
// while the timer keeps up. TTLock cannot push to a local Gladys (its
// callback URL must be public), so polling is the only way in.
//
// One refresh, for the locks the user added to Gladys (the core drops the
// states of a device it does not know: reading the others would spend API
// calls for nothing):
//   - every hour (and at start): `lock/list` (names, battery, gateway flag)
//     and, per lock with a gateway, `gateway/listByLock`;
//   - every refresh: `gateway/list` (one call for the account: which
//     gateways are online) and, per lock, `lockRecord/list` over the last
//     24 hours — the accesses (who, how), the "Lock unlocked" trigger;
//   - the state (`lock/queryOpenState`, asked to the lock through its
//     gateway, which wakes the lock up): at start, when a new record shows
//     the lock was operated, after a command, and every 30 minutes
//     otherwise — not on every refresh, to spare the lock's battery and the
//     API quota.
// Only the values that changed are sent to Gladys (SDK deduplication), with
// a heartbeat every 6 hours so a stable value never looks stale.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { batteryThreshold, isConfigured, pollPeriodMs } from './config.js';
import {
  FEATURE,
  GLADYS_LOCK_STATE,
  buildDevice,
  canLock,
  lockIdOf,
  lockIds,
  parseLock,
} from './devices.js';
import { createIssueLog } from './issues.js';
import { MESSAGES, METHOD_NAMES, TEXT, formatAccess, thrown } from './texts.js';
import { ERRCODE, TtlockClient, accountKey } from './ttlock/client.js';
import { ACTION, byNewest, parseRecord } from './ttlock/records.js';

const logger = createLogger({ name: 'ttlock' });

export const TRIGGER = { UNLOCKED: 'lock_unlocked', BATTERY_LOW: 'battery_low' };
export const WIDGET_KEY = 'lock';

const HOUR = 60 * 60 * 1000;
export const TIMINGS = {
  locksEvery: HOUR,
  stateEvery: 30 * 60 * 1000,
  heartbeat: 6 * HOUR,
  // Records looked at on each refresh (operation time on the lock).
  recordsWindow: 24 * HOUR,
  // Seen record ids are kept this long, then forgotten.
  seenKept: 48 * HOUR,
  // An access uploaded this long after it happened, or seen this long after
  // the refresh that should have seen it, fires no trigger (see isNews).
  triggerFreshness: 15 * 60 * 1000,
  // Above the threshold by this much before the low battery can fire again.
  batteryHysteresis: 5,
};

export class Hub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration or the SDK's fake Gladys
   * @param {import('./store.js').Store} options.store
   * @param {typeof fetch} [options.fetch]
   * @param {boolean} [options.timers] run the refresh timer
   * @param {() => number} [options.now]
   * @param {Partial<typeof TIMINGS>} [options.timings]
   */
  constructor({ gladys, store, fetch, timers = true, now = () => Date.now(), timings = {} }) {
    this.gladys = gladys;
    this.store = store;
    this.fetch = fetch;
    this.timers = timers;
    this.now = now;
    this.timings = { ...TIMINGS, ...timings };
    this.issues = createIssueLog(logger);
    this.config = null;
    this.client = null;
    /** @type {Map<number, ReturnType<typeof parseLock>>} */
    this.locks = new Map();
    /** Per lock: what was read (state, battery, gateway online, last access...). */
    this.live = new Map();
    this.gatewayLinks = new Map(); // lockId -> { ids: gatewayIds in range, readAt }
    this.gatewaysOnline = new Map(); // gatewayId -> boolean
    this.locksReadAt = null;
    this.lastCycleAt = null;
    this.cycleInFlight = null;
    this.timer = null;
    this.stopped = false;
    this.status = null;
    this.data = { token: null, locks: {} };
  }

  // --- lifecycle --------------------------------------------------------------

  async start(config) {
    this.data = { token: null, locks: {}, ...(await this.store.load()) };
    this.data.locks ??= {};
    await this.reconfigure(config);
  }

  /** A new configuration (or the first one): new account, new pace. */
  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    this.stopTimer();
    this.issues.clear();
    if (!previous || accountKey(previous) !== accountKey(config)) {
      // Another account: what was read belongs to the previous one.
      this.locks.clear();
      this.live.clear();
      this.gatewayLinks.clear();
      this.gatewaysOnline.clear();
      this.locksReadAt = null;
    }
    this.client = new TtlockClient({
      config,
      fetch: this.fetch,
      now: this.now,
      tokens: {
        load: async () => this.data.token,
        save: async (token) => {
          this.data.token = token;
          await this.store.save(this.data);
        },
      },
    });
    if (!isConfigured(config)) {
      logger.info('Not configured yet: waiting for the TTLock credentials');
      await this.setStatus(false, TEXT.notConfigured);
      return;
    }
    this.stopped = false;
    // Names are fixed at device creation; a new language is for new devices:
    // publish them again in any case.
    this.locksReadAt = null;
    this.publishPending = true;
    await this.cycle({ forceState: true });
    this.schedule();
  }

  /** Gladys reconnected (it may have restarted): send everything again. */
  async resync() {
    this.gladys.forgetPublishedStates?.();
    if (this.locks.size > 0) {
      await this.publishDevices();
    }
    await this.cycle({ forceState: false });
    this.schedule();
  }

  stop() {
    this.stopped = true;
    this.stopTimer();
    return this.store.flush();
  }

  stopTimer() {
    clearTimeout(this.timer);
    this.timer = null;
  }

  schedule() {
    this.stopTimer();
    if (!this.timers || this.stopped || !isConfigured(this.config)) {
      return;
    }
    this.timer = setTimeout(async () => {
      this.timer = null;
      try {
        await this.cycle();
      } catch (err) {
        logger.error(`Refresh failed (${err.message})`);
      } finally {
        this.schedule();
      }
    }, pollPeriodMs(this.config));
    this.timer.unref?.();
  }

  // --- status -----------------------------------------------------------------

  /** Connection status of the Configuration screen, sent when it changes. */
  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (this.status === key) {
      return;
    }
    this.status = key;
    await this.gladys.setConnectionStatus(connected, message).catch((err) => {
      logger.debug(`setConnectionStatus failed: ${err.message}`);
    });
  }

  /** Report an API failure: logged once, status on the Configuration screen. */
  async reportFailure(key, what, err) {
    if (['auth', 'quota', 'network'].includes(err.kind)) {
      // The whole account is concerned: one line, whatever step hit it first.
      this.cycleFailed = true;
      this.issues.fail('cloud', `${what}: ${err.message}`);
    } else {
      this.issues.fail(key, `${what}: ${err.message}`);
    }
    if (err.kind === 'auth') {
      await this.setStatus(false, TEXT.authFailed);
    } else if (err.kind === 'quota') {
      await this.setStatus(false, TEXT.quotaExceeded);
    } else if (err.kind === 'network') {
      await this.setStatus(false, MESSAGES.unreachable(err.message));
    }
  }

  // --- refresh ------------------------------------------------------------------

  /** The locks whose device the user added to Gladys. */
  addedLocks() {
    const added = new Set(
      (this.gladys.devices ?? [])
        .map((device) => lockIdOf(this.gladys, device.external_id))
        .filter(Boolean),
    );
    return [...this.locks.values()].filter((lock) => added.has(lock.id));
  }

  /**
   * One refresh; a refresh in progress is joined rather than doubled.
   * @param {{ forceState?: boolean, onlyLock?: number }} [options]
   */
  cycle(options = {}) {
    if (!this.cycleInFlight) {
      this.cycleInFlight = this.runCycle(options).finally(() => {
        this.cycleInFlight = null;
      });
      return this.cycleInFlight;
    }
    // Joined: a forced refresh runs again once the current one is over.
    if (!options.forceState && !options.onlyLock) {
      return this.cycleInFlight;
    }
    return this.cycleInFlight.then(() => this.cycle(options));
  }

  async runCycle({ forceState = false, onlyLock } = {}) {
    if (!isConfigured(this.config)) {
      return;
    }
    if (this.gladys.connected === false) {
      logger.debug('Gladys unreachable: refresh skipped');
      return;
    }
    const started = this.now();
    this.lastCycleAt = started;
    this.cycleFailed = false;

    if (this.locksReadAt === null || started - this.locksReadAt >= this.timings.locksEvery) {
      if (!(await this.readLocks())) {
        return;
      }
    }

    const locks = this.addedLocks().filter((lock) => !onlyLock || lock.id === onlyLock);
    if (locks.length === 0) {
      logger.debug('No TTLock device added in Gladys yet: nothing to refresh');
      return;
    }

    if (locks.some((lock) => lock.hasGateway)) {
      await this.readGateways();
    }

    const states = [];
    let widgetChanged = false;
    for (const lock of locks) {
      const result = await this.refreshLock(lock, { forceState });
      states.push(...result.states);
      widgetChanged ||= result.widgetChanged;
    }
    await this.publish(states);
    await this.store.save(this.data);
    if (!this.cycleFailed) {
      // The cloud answered everything: clear a status a past failure left.
      this.issues.ok('cloud', 'TTLock answers again');
      await this.setStatus(true);
    }
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh?.(WIDGET_KEY);
    }
    logger.debug(`Refresh done in ${this.now() - started} ms (${locks.length} lock(s))`);
  }

  /** `lock/list`: the locks of the account. Resolves false when it failed. */
  async readLocks() {
    let list;
    try {
      list = await this.client.listLocks();
    } catch (err) {
      await this.reportFailure('locks', 'Reading the TTLock locks failed', err);
      return false;
    }
    const firstRead = this.locksReadAt === null && this.locks.size === 0;
    this.locksReadAt = this.now();
    const before = JSON.stringify([...this.locks.values()].map((lock) => structureOf(lock)));
    const locks = list.map(parseLock).filter((lock) => Number.isInteger(lock.id) && lock.id > 0);
    this.locks = new Map(locks.map((lock) => [lock.id, lock]));
    for (const lock of locks) {
      const live = this.liveOf(lock.id);
      if (lock.battery !== null) {
        live.battery = lock.battery;
      }
    }
    if (firstRead) {
      logger.info(`Connected to TTLock: ${locks.length} lock(s)`);
    }
    this.issues.ok('locks', 'Reading the TTLock locks works again');
    await this.setStatus(true);

    const after = JSON.stringify(locks.map((lock) => structureOf(lock)));
    if (firstRead || this.publishPending || before !== after) {
      this.publishPending = false;
      await this.publishDevices();
    }

    return true;
  }

  async readGateways() {
    try {
      const gateways = await this.client.listGateways();
      this.gatewaysOnline = new Map(
        gateways.map((gateway) => [Number(gateway.gatewayId), Number(gateway.isOnline) === 1]),
      );
      this.issues.ok('gateways', 'Reading the TTLock gateways works again');
    } catch (err) {
      await this.reportFailure('gateways', 'Reading the TTLock gateways failed', err);
    }
  }

  /** The gateways in range of a lock (`gateway/listByLock`), hourly. */
  async readGatewayLinks(lock) {
    const known = this.gatewayLinks.get(lock.id);
    if (known && this.now() - known.readAt < this.timings.locksEvery) {
      return;
    }
    try {
      const links = await this.client.gatewaysOfLock(lock.id);
      this.gatewayLinks.set(lock.id, {
        ids: links.map((link) => Number(link.gatewayId)),
        readAt: this.now(),
      });
    } catch (err) {
      logger.debug(`${lock.name}: reading its gateways failed: ${err.message}`);
    }
  }

  liveOf(lockId) {
    if (!this.live.has(lockId)) {
      this.live.set(lockId, {
        state: null, // Gladys LOCK.STATE, null while unknown
        stateReadAt: null,
        battery: null,
        gateway: null,
        lastAccess: null,
      });
    }
    return this.live.get(lockId);
  }

  persistedOf(lockId) {
    this.data.locks[lockId] ??= { seen: {}, lastAccess: null, lowBattery: false };
    return this.data.locks[lockId];
  }

  /** Records, state, battery and gateway of one lock; resolves its states. */
  async refreshLock(lock, { forceState }) {
    const live = this.liveOf(lock.id);
    const before = widgetView(live);

    const operated = await this.readRecords(lock);

    const stateDue =
      forceState ||
      operated ||
      live.stateReadAt === null ||
      this.now() - live.stateReadAt >= this.timings.stateEvery;
    if (lock.connectable && stateDue) {
      await this.readState(lock);
    }

    if (lock.hasGateway) {
      await this.readGatewayLinks(lock);
      const links = this.gatewayLinks.get(lock.id)?.ids;
      if (links && links.length > 0) {
        live.gateway = links.some((id) => this.gatewaysOnline.get(id) === true);
      } else if (this.gatewaysOnline.size > 0) {
        // Links unknown: one online gateway of the account is the best guess.
        live.gateway = [...this.gatewaysOnline.values()].some(Boolean);
      }
    }

    await this.checkBattery(lock);
    return { states: this.statesOf(lock), widgetChanged: before !== widgetView(live) };
  }

  /**
   * New records of a lock: last access, "Lock unlocked" triggers.
   * @returns {Promise<boolean>} the lock was operated since the last refresh
   */
  async readRecords(lock) {
    const now = this.now();
    const persisted = this.persistedOf(lock.id);
    // The API does not document the order of a page: keep the window small
    // enough for one page. After the first look, it starts an hour before
    // the newest record seen (a gateway uploads within minutes).
    const newest = Math.max(0, ...Object.values(persisted.seen));
    const startDate = Math.max(now - this.timings.recordsWindow, newest - HOUR);
    let list;
    try {
      ({ list } = await this.client.listRecords(lock.id, { startDate, endDate: now }));
      this.issues.ok(`records:${lock.id}`, `${lock.name}: records read again`);
    } catch (err) {
      await this.reportFailure(
        `records:${lock.id}`,
        `${lock.name}: reading the records failed`,
        err,
      );
      return false;
    }

    const baseline = persisted.baselined !== true;
    const records = list.map(parseRecord).filter(Boolean).sort(byNewest);
    const fresh = records.filter((record) => !(record.id in persisted.seen)).reverse();
    for (const record of fresh) {
      persisted.seen[record.id] = record.lockDate;
    }
    // Forget what is out of the window for good.
    for (const [id, lockDate] of Object.entries(persisted.seen)) {
      if (now - lockDate > this.timings.seenKept) {
        delete persisted.seen[id];
      }
    }
    persisted.baselined = true;

    let operated = false;
    for (const record of fresh.filter((entry) => entry.success)) {
      operated = true;
      if (record.action !== ACTION.UNLOCK) {
        continue;
      }
      if (!persisted.lastAccess || record.lockDate >= persisted.lastAccess.lockDate) {
        persisted.lastAccess = {
          method: record.method,
          user: record.user,
          lockDate: record.lockDate,
        };
      }
      if (!baseline && this.isNews(record, now)) {
        await this.fireUnlocked(lock, record);
      }
    }
    const live = this.liveOf(lock.id);
    live.lastAccess = persisted.lastAccess;
    // The first look at a lock is history: the state is read anyway.
    return operated && !baseline;
  }

  /**
   * An access worth a trigger: it reached the cloud since about the last
   * refresh, and it reached it promptly — a record the gateway uploads
   * 40 minutes late, or one found after a restart, is history.
   */
  isNews(record, now) {
    return (
      now - record.serverDate <= pollPeriodMs(this.config) + this.timings.triggerFreshness &&
      record.serverDate - record.lockDate <= this.timings.triggerFreshness
    );
  }

  async fireUnlocked(lock, record) {
    const language = this.config.language;
    logger.debug(`${lock.name}: unlocked (${record.method})`);
    try {
      await this.gladys.publishSceneEvent(TRIGGER.UNLOCKED, {
        device: lockIds(this.gladys, lock.id).device,
        method: record.method,
        method_name: METHOD_NAMES[language][record.method],
        user: record.user,
        lock_name: lock.name,
      });
    } catch (err) {
      logger.warn(`Firing "${TRIGGER.UNLOCKED}" failed: ${err.message}`);
    }
  }

  /** `lock/queryOpenState`, through the gateway. */
  async readState(lock) {
    const live = this.liveOf(lock.id);
    try {
      const answer = await this.client.queryOpenState(lock.id);
      live.stateReadAt = this.now();
      const state = Number(answer.state);
      if (state === 0) {
        live.state = GLADYS_LOCK_STATE.LOCKED;
      } else if (state === 1) {
        live.state = GLADYS_LOCK_STATE.UNLOCKED;
      }
      // 2 = unknown: the previous value stays, nothing is published.
      const battery = Number(answer.electricQuantity);
      if (Number.isFinite(battery) && battery >= 0) {
        live.battery = Math.min(100, battery);
      }
      this.issues.ok(`state:${lock.id}`, `${lock.name}: state read again`);
    } catch (err) {
      // Retried at the next refresh, not 30 minutes later.
      live.stateReadAt = null;
      if (err.errcode === ERRCODE.GATEWAY_OFFLINE) {
        live.gateway = false;
      }
      await this.reportFailure(`state:${lock.id}`, `${lock.name}: reading the state failed`, err);
    }
  }

  /** The "Low battery" trigger: once when the level falls under the threshold. */
  async checkBattery(lock) {
    const live = this.liveOf(lock.id);
    if (live.battery === null) {
      return;
    }
    const persisted = this.persistedOf(lock.id);
    const threshold = batteryThreshold(this.config);
    if (live.battery < threshold && !persisted.lowBattery) {
      persisted.lowBattery = true;
      logger.info(`${lock.name}: battery low (${live.battery} %)`);
      try {
        await this.gladys.publishSceneEvent(TRIGGER.BATTERY_LOW, {
          device: lockIds(this.gladys, lock.id).device,
          battery: live.battery,
          lock_name: lock.name,
        });
      } catch (err) {
        persisted.lowBattery = false; // fired again at the next refresh
        logger.warn(`Firing "${TRIGGER.BATTERY_LOW}" failed: ${err.message}`);
      }
    } else if (live.battery >= threshold + this.timings.batteryHysteresis) {
      // New batteries: the next fall is announced again.
      persisted.lowBattery = false;
    }
  }

  /** The states of a lock, as known now. */
  statesOf(lock) {
    const ids = lockIds(this.gladys, lock.id);
    const live = this.liveOf(lock.id);
    const states = [];
    if (lock.connectable && live.state !== null) {
      states.push({ device_feature_external_id: ids.feature(FEATURE.STATE), state: live.state });
    }
    if (live.battery !== null) {
      states.push({
        device_feature_external_id: ids.feature(FEATURE.BATTERY),
        state: live.battery,
      });
    }
    if (lock.hasGateway && live.gateway !== null) {
      states.push({
        device_feature_external_id: ids.feature(FEATURE.GATEWAY),
        state: live.gateway ? 1 : 0,
      });
    }
    // A text state is never empty: "None" until a first access is seen.
    const text = live.lastAccess
      ? formatAccess(live.lastAccess, this.config.language, this.now())
      : TEXT.none[this.config.language];
    states.push({ device_feature_external_id: ids.feature(FEATURE.LAST_ACCESS), text });
    return states;
  }

  async publish(states) {
    if (states.length === 0) {
      return;
    }
    try {
      const { count } = await this.gladys.publishChangedStates(states, {
        heartbeat: this.timings.heartbeat,
      });
      if (count > 0) {
        logger.debug(`${count} state(s) sent to Gladys`);
      }
      this.issues.ok('publish', 'Gladys accepts the states again');
    } catch (err) {
      // Not remembered by the SDK: sent again at the next refresh.
      this.issues.fail('publish', `Sending the states to Gladys failed: ${err.message}`);
    }
  }

  async publishDevices() {
    const devices = [...this.locks.values()].map((lock) =>
      buildDevice(this.gladys, lock, this.config),
    );
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      logger.debug(`${devices.length} device(s) published to the Discovery tab`);
      this.issues.ok('discovery', 'Gladys accepts the devices again');
    } catch (err) {
      // Published again at the next change, or at the next scan.
      this.issues.fail('discovery', `Publishing the devices failed: ${err.message}`);
    }
  }

  // --- Gladys events ----------------------------------------------------------------

  /** "Scan" in the Discovery tab: read the locks again now. */
  async rediscover() {
    if (!isConfigured(this.config)) {
      return;
    }
    this.locksReadAt = null;
    if (await this.readLocks()) {
      // readLocks publishes only on a change: the user asked, publish anyway.
      await this.publishDevices();
    }
  }

  /** The core's poll (fallback): nothing while the timer keeps up. */
  async pollFromCore(device) {
    const lockId = lockIdOf(this.gladys, device.external_id);
    if (!lockId || !isConfigured(this.config)) {
      return;
    }
    if (
      this.lastCycleAt !== null &&
      this.now() - this.lastCycleAt < pollPeriodMs(this.config) * 0.9
    ) {
      logger.debug(
        `onPoll skipped for lock ${lockId}: refreshed ${this.now() - this.lastCycleAt} ms ago`,
      );
      return;
    }
    await this.cycle();
  }

  /**
   * A device was added (or updated) in Gladys: the SDK forgot what it had
   * sent for it, and the core dropped the states sent before it existed.
   * Send everything now, read first if the lock was never read.
   */
  async onDeviceCreated(device) {
    const lockId = lockIdOf(this.gladys, device.external_id);
    const lock = this.locks.get(lockId);
    if (!lock) {
      return;
    }
    const live = this.liveOf(lockId);
    if (live.stateReadAt === null && this.data.locks[lockId]?.baselined !== true) {
      await this.cycle({ onlyLock: lockId, forceState: true });
    } else {
      await this.publish(this.statesOf(lock));
    }
    this.gladys.requestWidgetRefresh?.(WIDGET_KEY);
  }

  // --- commands -------------------------------------------------------------------

  /** The lock of a device external_id, or a thrown four-language error. */
  lockOf(externalId) {
    const lock = this.locks.get(lockIdOf(this.gladys, externalId));
    if (!this.client || !isConfigured(this.config)) {
      throw new Error(thrown(TEXT.notReady));
    }
    if (!lock) {
      throw new Error(thrown(TEXT.unknownLock));
    }
    if (!lock.connectable) {
      throw new Error(thrown(TEXT.notConnectable));
    }
    return lock;
  }

  /** Read the state right after a command, and send it. */
  async confirm(lock) {
    await this.readState(lock);
    await this.publish(this.statesOf(lock));
    this.gladys.requestWidgetRefresh?.(WIDGET_KEY);
    return this.liveOf(lock.id).state;
  }

  /**
   * Lock (button, widget, scene). Resolves true when the lock reports locked.
   * @param {string} externalId device external_id
   * @param {string} source who asked, for the log line
   */
  async lock(externalId, source) {
    const lock = this.lockOf(externalId);
    if (!canLock(lock)) {
      throw new Error(thrown(TEXT.notSupported));
    }
    logger.info(`${lock.name}: lock requested (${source})`);
    try {
      await this.client.lock(lock.id);
    } catch (err) {
      logger.warn(`${lock.name}: locking failed: ${err.message}`);
      throw new Error(thrown(TEXT.lockFailed, err.message), { cause: err });
    }
    return (await this.confirm(lock)) === GLADYS_LOCK_STATE.LOCKED;
  }

  /** Unlock (scene action only, and only when enabled in the configuration). */
  async unlock(externalId) {
    if (!this.config?.allow_unlock) {
      throw new Error(thrown(TEXT.unlockDisabled));
    }
    const lock = this.lockOf(externalId);
    if (!lock.features.remoteUnlock) {
      throw new Error(thrown(TEXT.notSupported));
    }
    logger.info(`${lock.name}: unlock requested (scene)`);
    try {
      await this.client.unlock(lock.id);
    } catch (err) {
      logger.warn(`${lock.name}: unlocking failed: ${err.message}`);
      throw new Error(thrown(TEXT.unlockFailed, err.message), { cause: err });
    }
    return (await this.confirm(lock)) === GLADYS_LOCK_STATE.UNLOCKED;
  }

  /** Passage mode on or off (scene action only, when enabled). */
  async setPassageMode(externalId, enabled) {
    if (!this.config?.allow_passage_mode) {
      throw new Error(thrown(TEXT.passageDisabled));
    }
    const lock = this.lockOf(externalId);
    if (!lock.features.passageMode) {
      throw new Error(thrown(TEXT.notSupported));
    }
    logger.info(`${lock.name}: passage mode ${enabled ? 'on' : 'off'} requested (scene)`);
    try {
      await this.client.setPassageMode(lock.id, enabled);
    } catch (err) {
      logger.warn(`${lock.name}: passage mode failed: ${err.message}`);
      throw new Error(thrown(TEXT.passageFailed, err.message), { cause: err });
    }
    return enabled;
  }

  // --- configuration action -----------------------------------------------------------

  /** "Test the connection": sign in, count the locks and gateways. */
  async testConnection() {
    if (!isConfigured(this.config)) {
      return TEXT.notConfigured;
    }
    logger.info('Connection test requested');
    try {
      await this.client.checkLogin();
      const locks = (await this.client.listLocks()).map(parseLock);
      const gateways = await this.client.listGateways();
      const online = gateways.filter((gateway) => Number(gateway.isOnline) === 1).length;
      await this.setStatus(true);
      return MESSAGES.connected(locks.length, gateways.length, online, this.callsPerDay(locks));
    } catch (err) {
      if (err.kind === 'auth') {
        await this.setStatus(false, TEXT.authFailed);
        return TEXT.authFailed;
      }
      if (err.kind === 'quota') {
        return TEXT.quotaExceeded;
      }
      return MESSAGES.unreachable(err.message);
    }
  }

  /**
   * API calls a day for these locks, at the configured pace, without the
   * extra state reads an operated lock causes: told to the user, so the
   * quota of the developer account is never a surprise.
   */
  callsPerDay(locks) {
    const day = 24 * HOUR;
    const refreshes = day / pollPeriodMs(this.config);
    const withGateway = locks.filter((lock) => lock.hasGateway).length;
    const connectable = locks.filter((lock) => lock.connectable).length;
    const perRefresh = (withGateway > 0 ? 1 : 0) + locks.length;
    const states =
      connectable * (day / Math.max(this.timings.stateEvery, pollPeriodMs(this.config)));
    const hourly = (day / this.timings.locksEvery) * (1 + withGateway);
    return Math.round(refreshes * perRefresh + states + hourly);
  }

  // --- widget -----------------------------------------------------------------------

  /** What the widget shows for a device external_id, null for an unknown lock. */
  snapshot(externalId) {
    const lock = this.locks.get(lockIdOf(this.gladys, externalId));
    if (!lock) {
      return null;
    }
    return { lock, live: this.liveOf(lock.id), canLock: canLock(lock) };
  }
}

// What makes "Update" appear in the Discovery tab (the features and the name).
const structureOf = (lock) => [
  lock.id,
  lock.name,
  lock.connectable,
  lock.hasGateway,
  canLock(lock),
];

// What the widget shows of a lock: a change asks the core to pull it again.
const widgetView = (live) =>
  JSON.stringify([live.state, live.battery, live.gateway, live.lastAccess?.lockDate ?? null]);
