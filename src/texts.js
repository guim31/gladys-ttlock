// -----------------------------------------------------------------------------
// Every text the integration shows to the user, in the four languages of the
// Gladys interface (en, fr, de, es). German says "du", Spanish says "usted",
// like the rest of guim31's integrations. Vocabulary of the Gladys interface:
// Serrure / Schloss / Cerradura, Batterie / Batería.
//
//   - NAMES   : the feature names, fixed at device creation, in the language
//               of the configuration (a device integration does not receive
//               the user's language);
//   - METHODS : how a lock was operated (last access, trigger, widget);
//   - TEXT    : fixed four-language texts (statuses, messages, widget);
//   - MESSAGES: texts built from a value;
//   - thrown(): a THROWN message reaches the screen as a plain string, the
//               core cannot localize it: the languages are joined.
//
// test/i18n.test.js checks every entry carries the four languages.
// -----------------------------------------------------------------------------

import { LANGUAGES } from './config.js';

export const NAMES = {
  en: {
    state: 'Lock state',
    lock: 'Lock',
    battery: 'Battery',
    gateway: 'Gateway online',
    last_access: 'Last access',
  },
  fr: {
    state: 'État de la serrure',
    lock: 'Verrouiller',
    battery: 'Batterie',
    gateway: 'Passerelle en ligne',
    last_access: 'Dernier accès',
  },
  de: {
    state: 'Schlossstatus',
    lock: 'Abschließen',
    battery: 'Batterie',
    gateway: 'Gateway online',
    last_access: 'Letzter Zugang',
  },
  es: {
    state: 'Estado de la cerradura',
    lock: 'Bloquear',
    battery: 'Batería',
    gateway: 'Pasarela en línea',
    last_access: 'Último acceso',
  },
};

export const METHOD_NAMES = {
  en: {
    app: 'App',
    remote: 'Remote (gateway)',
    passcode: 'Passcode',
    card: 'Card',
    fingerprint: 'Fingerprint',
    face: 'Face',
    palm_vein: 'Palm vein',
    key: 'Mechanical key',
    fob: 'Remote control',
    qr_code: 'QR code',
    button: 'Button on the lock',
    auto: 'Automatic',
  },
  fr: {
    app: 'Application',
    remote: 'À distance (passerelle)',
    passcode: 'Code',
    card: 'Carte',
    fingerprint: 'Empreinte',
    face: 'Visage',
    palm_vein: 'Paume',
    key: 'Clé mécanique',
    fob: 'Télécommande',
    qr_code: 'QR code',
    button: 'Bouton de la serrure',
    auto: 'Automatique',
  },
  de: {
    app: 'App',
    remote: 'Aus der Ferne (Gateway)',
    passcode: 'Code',
    card: 'Karte',
    fingerprint: 'Fingerabdruck',
    face: 'Gesicht',
    palm_vein: 'Handvenen',
    key: 'Mechanischer Schlüssel',
    fob: 'Fernbedienung',
    qr_code: 'QR-Code',
    button: 'Taste am Schloss',
    auto: 'Automatisch',
  },
  es: {
    app: 'Aplicación',
    remote: 'A distancia (pasarela)',
    passcode: 'Código',
    card: 'Tarjeta',
    fingerprint: 'Huella',
    face: 'Rostro',
    palm_vein: 'Palma',
    key: 'Llave mecánica',
    fob: 'Mando a distancia',
    qr_code: 'Código QR',
    button: 'Botón de la cerradura',
    auto: 'Automático',
  },
};

export const TEXT = {
  // Configuration screen (connection status)
  notConfigured: {
    en: 'Fill in the client ID and secret, and the account of the TTLock app.',
    fr: "Renseignez le client ID et le secret, et le compte de l'application TTLock.",
    de: 'Gib die Client-ID und das Secret sowie das Konto der TTLock-App ein.',
    es: 'Introduzca el client ID y el secreto, y la cuenta de la aplicación TTLock.',
  },
  authFailed: {
    en: 'TTLock refuses the sign-in: check the client ID, the secret, the account and its password.',
    fr: 'TTLock refuse la connexion : vérifiez le client ID, le secret, le compte et son mot de passe.',
    de: 'TTLock lehnt die Anmeldung ab: Prüfe Client-ID, Secret, Konto und Passwort.',
    es: 'TTLock rechaza la conexión: compruebe el client ID, el secreto, la cuenta y su contraseña.',
  },
  quotaExceeded: {
    en: 'TTLock API call limit reached: refresh less often.',
    fr: "Limite d'appels de l'API TTLock atteinte : espacez les relevés.",
    de: 'Aufruflimit der TTLock-API erreicht: Aktualisiere seltener.',
    es: 'Límite de llamadas de la API de TTLock alcanzado: actualice con menos frecuencia.',
  },
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
    de: 'Die Initialisierung ist fehlgeschlagen, sieh dir die Logs der Integration an.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },

  // Lock states (widget)
  locked: { en: 'Locked', fr: 'Verrouillée', de: 'Abgeschlossen', es: 'Bloqueada' },
  unlocked: { en: 'Unlocked', fr: 'Déverrouillée', de: 'Aufgeschlossen', es: 'Desbloqueada' },
  unknown: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
  online: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
  offline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
  none: { en: 'None', fr: 'Aucun', de: 'Keiner', es: 'Ninguno' },

  // Widget labels
  state: { en: 'State', fr: 'État', de: 'Status', es: 'Estado' },
  battery: { en: 'Battery', fr: 'Batterie', de: 'Batterie', es: 'Batería' },
  gateway: { en: 'Gateway', fr: 'Passerelle', de: 'Gateway', es: 'Pasarela' },
  lastAccess: { en: 'Last access', fr: 'Dernier accès', de: 'Letzter Zugang', es: 'Último acceso' },
  lockButton: { en: 'Lock', fr: 'Verrouiller', de: 'Abschließen', es: 'Bloquear' },
  pickLock: {
    en: 'Choose a lock in the settings of this widget.',
    fr: 'Choisissez une serrure dans les réglages de ce widget.',
    de: 'Wähle in den Einstellungen dieses Widgets ein Schloss aus.',
    es: 'Elija una cerradura en los ajustes de este widget.',
  },
  lockGone: {
    en: 'This lock is no longer in the TTLock account.',
    fr: "Cette serrure n'est plus dans le compte TTLock.",
    de: 'Dieses Schloss ist nicht mehr im TTLock-Konto.',
    es: 'Esta cerradura ya no está en la cuenta TTLock.',
  },
  noLockCommand: {
    en: 'Not connected to a gateway: locking from Gladys is not possible.',
    fr: 'Pas de passerelle : impossible de verrouiller depuis Gladys.',
    de: 'Kein Gateway: Abschließen aus Gladys ist nicht möglich.',
    es: 'Sin pasarela: no es posible bloquear desde Gladys.',
  },

  // Action results (toasts, Configuration screen); thrown ones kept short.
  lockSent: {
    en: 'Lock command sent.',
    fr: 'Ordre de verrouillage envoyé.',
    de: 'Befehl zum Abschließen gesendet.',
    es: 'Orden de bloqueo enviada.',
  },
  lockFailed: {
    en: 'Locking failed',
    fr: 'Échec du verrouillage',
    de: 'Abschließen fehlgeschlagen',
    es: 'El bloqueo ha fallado',
  },
  unlockFailed: {
    en: 'Unlocking failed',
    fr: 'Échec du déverrouillage',
    de: 'Aufschließen fehlgeschlagen',
    es: 'El desbloqueo ha fallado',
  },
  passageFailed: {
    en: 'Passage mode failed',
    fr: 'Échec du mode passage',
    de: 'Durchgangsmodus fehlgeschlagen',
    es: 'El modo de paso ha fallado',
  },
  unlockDisabled: {
    en: 'Unlocking is disabled in the configuration.',
    fr: 'Le déverrouillage est désactivé dans la configuration.',
    de: 'Das Aufschließen ist in der Konfiguration deaktiviert.',
    es: 'El desbloqueo está desactivado en la configuración.',
  },
  passageDisabled: {
    en: 'Passage mode is disabled in the configuration.',
    fr: 'Le mode passage est désactivé dans la configuration.',
    de: 'Der Durchgangsmodus ist in der Konfiguration deaktiviert.',
    es: 'El modo de paso está desactivado en la configuración.',
  },
  unknownLock: {
    en: 'Unknown lock.',
    fr: 'Serrure inconnue.',
    de: 'Unbekanntes Schloss.',
    es: 'Cerradura desconocida.',
  },
  notConnectable: {
    en: 'This lock has no gateway nor WiFi.',
    fr: "Cette serrure n'a ni passerelle ni WiFi.",
    de: 'Dieses Schloss hat weder Gateway noch WLAN.',
    es: 'Esta cerradura no tiene pasarela ni WiFi.',
  },
  notSupported: {
    en: 'This lock does not support it.',
    fr: 'Cette serrure ne le permet pas.',
    de: 'Dieses Schloss unterstützt das nicht.',
    es: 'Esta cerradura no lo permite.',
  },
  notReady: {
    en: 'Not connected to TTLock yet.',
    fr: 'Pas encore connecté à TTLock.',
    de: 'Noch nicht mit TTLock verbunden.',
    es: 'Todavía no conectado a TTLock.',
  },
};

/** Texts built from a value. Each one returns the four languages. */
export const MESSAGES = {
  connected: (locks, gateways, online, callsPerDay) => ({
    en: `Connected: ${locks} lock(s), ${gateways} gateway(s), ${online} online. About ${callsPerDay} API calls a day.`,
    fr: `Connecté : ${locks} serrure(s), ${gateways} passerelle(s) dont ${online} en ligne. Environ ${callsPerDay} appels d'API par jour.`,
    de: `Verbunden: ${locks} Schloss/Schlösser, ${gateways} Gateway(s), ${online} online. Etwa ${callsPerDay} API-Aufrufe pro Tag.`,
    es: `Conectado: ${locks} cerradura(s), ${gateways} pasarela(s), ${online} en línea. Unas ${callsPerDay} llamadas a la API al día.`,
  }),
  unreachable: (message) => ({
    en: `TTLock cloud unreachable: ${message}`,
    fr: `Cloud TTLock injoignable : ${message}`,
    de: `TTLock-Cloud nicht erreichbar: ${message}`,
    es: `No se puede acceder a la nube de TTLock: ${message}`,
  }),
  locked: (name) => ({
    en: `${name}: locked.`,
    fr: `${name} : verrouillée.`,
    de: `${name}: abgeschlossen.`,
    es: `${name}: bloqueada.`,
  }),
  passage: (name, enabled) => ({
    en: `${name}: passage mode ${enabled ? 'on' : 'off'}.`,
    fr: `${name} : mode passage ${enabled ? 'activé' : 'désactivé'}.`,
    de: `${name}: Durchgangsmodus ${enabled ? 'an' : 'aus'}.`,
    es: `${name}: modo de paso ${enabled ? 'activado' : 'desactivado'}.`,
  }),
};

/**
 * A message to THROW: the core shows it as a plain string, so the four
 * languages are joined, then an optional detail (an API error) once.
 * @param {{ en: string, fr: string, de: string, es: string }} text
 * @param {string} [detail]
 */
export function thrown(text, detail) {
  const joined = LANGUAGES.map((lang) => text[lang]).join(' / ');
  return detail ? `${joined} (${detail})` : joined;
}

/** One language of a four-language text, English when the language is unknown. */
export const pick = (text, language) => text[language] ?? text.en;

/**
 * "Fingerprint · Alice · 14:32": how, who and when, in the configured
 * language and the time zone of Gladys (the supervisor injects TZ).
 * @param {{ method: string, user: string, lockDate: number }} access
 * @param {string} language
 * @param {number} [now] to show the date when the access is not from today
 */
export function formatAccess(access, language, now = Date.now()) {
  const method = METHOD_NAMES[language]?.[access.method] ?? METHOD_NAMES.en[access.method];
  const date = new Date(access.lockDate);
  const sameDay =
    new Intl.DateTimeFormat('en-CA', { dateStyle: 'short' }).format(date) ===
    new Intl.DateTimeFormat('en-CA', { dateStyle: 'short' }).format(new Date(now));
  const when = new Intl.DateTimeFormat(language, {
    ...(sameDay ? {} : { day: '2-digit', month: '2-digit' }),
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
  return [method, access.user, when].filter(Boolean).join(' · ');
}
