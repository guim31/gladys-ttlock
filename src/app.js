// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake Gladys)
// and returns the hub, so index.js stays a few lines and the tests drive the
// very same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { FEATURE, lockIdOf, lockIds } from './devices.js';
import { Hub } from './hub.js';
import { SCENE_ACTIONS } from './scenes.js';
import { Store } from './store.js';
import { TEXT } from './texts.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'ttlock-app' });

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: store, fetch, timers, timings, now
 */
export function registerHandlers(gladys, options = {}) {
  const hub = new Hub({
    gladys,
    store: options.store ?? new Store(),
    fetch: options.fetch,
    timers: options.timers ?? true,
    timings: options.timings,
    now: options.now,
  });

  // Resolved once the hub has started; every handler waits for it, so a
  // command arriving during the first refresh is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = normalizeConfig(await gladys.getConfig());
      if (started) {
        // A reconnection (Gladys restarted): send again what Gladys may have lost.
        await hub.resync();
        return;
      }
      started = true;
      await hub.start(config);
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, TEXT.initFailed).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.on('disconnected', () => hub.stopTimer());

  gladys.onScanRequest(whenReady(() => hub.rediscover()));

  // The only command a device offers: the "Lock" button.
  gladys.onSetValue(
    whenReady(async (device, feature) => {
      const lockId = lockIdOf(gladys, device.external_id);
      if (!lockId || feature.external_id !== lockIds(gladys, lockId).feature(FEATURE.LOCK)) {
        throw new Error(`No command on ${feature.external_id}`);
      }
      await hub.lock(device.external_id, 'button');
    }),
  );

  // Fallback: the hub refreshes on its own timer (src/hub.js).
  gladys.onPoll(whenReady((device) => hub.pollFromCore(device)));

  gladys.onDeviceCreated(whenReady((device) => hub.onDeviceCreated(device)));
  gladys.onDeviceUpdated(whenReady((device) => hub.onDeviceCreated(device)));

  gladys.onConfigUpdated(
    whenReady(async (newConfig) => {
      logger.info('Configuration updated');
      await hub.reconfigure(normalizeConfig(newConfig));
    }),
  );

  gladys.onAction(
    'test_connection',
    whenReady(() => hub.testConnection()),
  );

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady((fields) => handler(hub, fields)),
    );
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(hub, request)),
    );
    gladys.onWidgetAction(
      key,
      whenReady((actionKey, params, { settings } = {}) =>
        widget.action(hub, { actionKey, params, settings }),
      ),
    );
  }

  return {
    hub,
    ready,
    stop: () => hub.stop(),
  };
}
