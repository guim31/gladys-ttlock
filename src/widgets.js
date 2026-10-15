// -----------------------------------------------------------------------------
// The "TTLock lock" dashboard widget: state, battery, gateway, last access and
// a "Lock" button, for the lock chosen in its settings. Never an unlock
// button: opening the door from the dashboard is not offered.
//
// Content budget of the core: 8 components, 2 texts at most. Here: one
// battery tile (bound to the feature: live), one status list, one button —
// or one text when there is nothing to show.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { FEATURE, GLADYS_LOCK_STATE, lockIds } from './devices.js';
import { TEXT, formatAccess, pick } from './texts.js';
import { WIDGET_KEY } from './hub.js';

export const LOCK_ACTION = 'lock';

const message = (text, language) => ({
  ttl_seconds: 60,
  components: [{ type: 'text', text: pick(text, language) }],
});

/**
 * @param {{ lock: object, live: object, canLock: boolean } | null} snapshot
 * @param {{ language: string, externalId?: string, gladys: object, now?: number }} context
 */
export function buildLockContent(snapshot, { language, externalId, gladys, now = Date.now() }) {
  if (!externalId) {
    return message(TEXT.pickLock, language);
  }
  if (!snapshot) {
    return message(TEXT.lockGone, language);
  }
  const { lock, live } = snapshot;
  const ids = lockIds(gladys, lock.id);
  const items = [];
  if (lock.connectable) {
    const state =
      live.state === GLADYS_LOCK_STATE.LOCKED
        ? { value: TEXT.locked, color: WIDGET_COLORS.SUCCESS, icon: 'lock' }
        : live.state === GLADYS_LOCK_STATE.UNLOCKED
          ? { value: TEXT.unlocked, color: WIDGET_COLORS.WARNING, icon: 'unlock' }
          : { value: TEXT.unknown, color: WIDGET_COLORS.NEUTRAL, icon: 'help-circle' };
    items.push({
      label: pick(TEXT.state, language),
      value: pick(state.value, language),
      color: state.color,
      icon: state.icon,
    });
  }
  if (lock.hasGateway) {
    items.push({
      label: pick(TEXT.gateway, language),
      value: pick(
        live.gateway === null ? TEXT.unknown : live.gateway ? TEXT.online : TEXT.offline,
        language,
      ),
      color:
        live.gateway === null
          ? WIDGET_COLORS.NEUTRAL
          : live.gateway
            ? WIDGET_COLORS.SUCCESS
            : WIDGET_COLORS.DANGER,
      icon: 'wifi',
    });
  }
  items.push({
    label: pick(TEXT.lastAccess, language),
    value: live.lastAccess
      ? formatAccess(live.lastAccess, language, now).slice(0, 40)
      : pick(TEXT.none, language),
    icon: 'key',
  });

  const components = [
    {
      type: 'value',
      label: pick(TEXT.battery, language),
      icon: 'battery',
      device_feature: ids.feature(FEATURE.BATTERY),
    },
    { type: 'status', items },
  ];
  if (snapshot.canLock) {
    components.push({
      type: 'button',
      label: pick(TEXT.lockButton, language),
      icon: 'lock',
      action: { key: LOCK_ACTION },
    });
  } else {
    components.push({ type: 'text', variant: 'caption', text: pick(TEXT.noLockCommand, language) });
  }
  return { ttl_seconds: 60, components };
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    /** @param {import('./hub.js').Hub} hub */
    get: async (hub, { settings = {}, language = 'en' }) =>
      buildLockContent(settings.device ? hub.snapshot(settings.device) : null, {
        language,
        externalId: settings.device,
        gladys: hub.gladys,
        now: hub.now(),
      }),

    action: async (hub, { actionKey, settings = {} }) => {
      if (actionKey !== LOCK_ACTION || !settings.device) {
        throw new Error(`Unknown widget action ${actionKey}`);
      }
      await hub.lock(settings.device, 'widget');
      return TEXT.lockSent;
    },
  },
};
