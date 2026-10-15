// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// TTLock runs one cloud per region, with the same API on another host: an
// account, its application and its locks live in one of them only.
export const REGIONS = {
  eu: 'https://euapi.ttlock.com',
  cn: 'https://cnapi.ttlock.com',
};

// Refresh intervals offered in the configuration, in minutes. Each refresh
// costs API calls (see docs): nothing faster than 5 minutes.
export const POLL_MINUTES = ['5', '10', '15', '30'];

// Battery levels (percent) under which the "Low battery" trigger fires.
export const BATTERY_THRESHOLDS = ['10', '15', '20', '25', '30'];

export const DEFAULT_CONFIG = {
  region: 'eu',
  client_id: '',
  client_secret: '',
  username: '',
  password: '',
  poll_minutes: '5',
  battery_threshold: '20',
  language: 'fr',
  allow_unlock: false,
  allow_passage_mode: false,
};

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const oneOf = (value, allowed, fallback) =>
  allowed.includes(String(value)) ? String(value) : fallback;

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} [raw] config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  return {
    region: oneOf(raw.region, Object.keys(REGIONS), DEFAULT_CONFIG.region),
    client_id: text(raw.client_id),
    client_secret: text(raw.client_secret),
    // The TTLock app accepts an e-mail address or a phone number.
    username: text(raw.username),
    // A password may begin or end with a space: kept as typed.
    password: typeof raw.password === 'string' ? raw.password : '',
    poll_minutes: oneOf(raw.poll_minutes, POLL_MINUTES, DEFAULT_CONFIG.poll_minutes),
    battery_threshold: oneOf(
      raw.battery_threshold,
      BATTERY_THRESHOLDS,
      DEFAULT_CONFIG.battery_threshold,
    ),
    language: oneOf(raw.language, LANGUAGES, DEFAULT_CONFIG.language),
    // Opening the door from Gladys needs an explicit yes: anything but true is no.
    allow_unlock: raw.allow_unlock === true,
    allow_passage_mode: raw.allow_passage_mode === true,
  };
}

/** All four account fields are filled in. */
export function isConfigured(config) {
  return Boolean(config.client_id && config.client_secret && config.username && config.password);
}

/** Refresh period, in milliseconds. */
export const pollPeriodMs = (config) => Number(config.poll_minutes) * 60 * 1000;

/** Battery threshold, in percent. */
export const batteryThreshold = (config) => Number(config.battery_threshold);
