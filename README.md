# TTLock for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that
brings **TTLock smart locks** — door locks, padlocks and key boxes of the many
brands built on TTLock — into Gladys, through the official
[TTLock Open Platform](https://euopen.ttlock.com) cloud API.

> **Developed without the hardware: feedback welcome.** The integration is
> built and tested against the answers documented by TTLock and published by
> the Home Assistant integration, not against a real lock or account. Please
> report what works and what does not in the
> [issues](https://github.com/guim31/gladys-ttlock/issues).

## Features

- **One device per lock** of the TTLock account: lock **state** (locked /
  unlocked, asked to the lock through its gateway), **battery**, **gateway
  online**, and **last access** (how — passcode, card, fingerprint, app, key… —
  who, and when) as a text sensor.
- A **Lock** push button: locking is always safe, it is the only command a
  device offers.
- **Unlocking is disabled by default** and never exposed as a switch, a widget
  button or a voice command. Allowed explicitly in the configuration, it exists
  only as a **scene action**, with a warning in the documentation. Same for the
  **passage mode**.
- Scene triggers: **Lock unlocked** (filter by lock and by method; who and how
  passed on to the scene) and **Low battery** (once per battery).
- Scene actions: **Lock** (always), **Unlock** and **Passage mode** (opt-in).
- A dashboard widget: state, battery, gateway, last access and a **Lock** button.
- Texts in English, French, German and Spanish.

## Requirements

- Gladys Assistant 5.1.0 or later.
- Locks set up in the TTLock app, and the account that administers them.
- A TTLock **gateway** (G2, G3, G4…) or a **WiFi lock** to read the state and
  to lock from Gladys (a Bluetooth-only lock shows its battery and accesses
  only).
- A free developer application on the TTLock Open Platform
  ([euopen.ttlock.com](https://euopen.ttlock.com/manager), or cnopen for
  China): its client ID and secret.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-ttlock`
   (or install **TTLock** from the catalog once it is listed).
2. In **Configuration**, enter the client ID and secret of your developer
   application, and the e-mail (or phone) and password of the **TTLock app**
   account. Save, then click **Test the connection**.
3. Open the **Discover** tab and add the locks.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

TTLock locks never talk to Gladys: a gateway or the lock's WiFi relays them to
TTLock's cloud, and the integration polls that cloud. TTLock can push records
to a callback URL, but it must be reachable from the Internet, which a local
Gladys is not: **there are no real-time events**, the delay is the refresh
interval (5 minutes by default).

- **Every refresh**: `gateway/list` (one call for the account) and, per lock
  added in Gladys, `lockRecord/list` over a short window — the new accesses,
  the last access, the "Lock unlocked" trigger.
- **The state** (`lock/queryOpenState`, which wakes the lock up through its
  gateway): at start, after a command, as soon as a new record shows the lock
  was operated, and every 30 minutes otherwise.
- **Every hour**: `lock/list` (names, battery, gateway flag) and
  `gateway/listByLock` per lock with a gateway.

One lock with a gateway, every 5 minutes: about 670 API calls a day. TTLock
limits the calls of a developer application (errcode 30006) without
publishing the limit; **Test the connection** gives the estimate for the
account, and the Configuration screen says when the limit is reached.

The integration refreshes on its own timer: the core's poll
([Gladys#3198](https://github.com/GladysAssistant/Gladys/issues/3198)) is only
a fallback. Only the values that changed are sent, with a heartbeat every
6 hours.

What is stored: the access token TTLock returns (90 days, renewed
automatically) and, per lock, the records already seen and whether the low
battery was announced — in `/data/ttlock-state.json`, readable by the
container user only. The app password stays in the Gladys configuration and is
sent to TTLock as an MD5 hash, as the TTLock app does. Tokens, passwords and
passcodes are never logged; the passcode of a record (`keyboardPwd`) is
dropped as soon as it is read.

## Checked without hardware, and what was not

Checked here, by the test suite (`npm test`), against an in-memory TTLock
cloud built from the documented answers: the sign-in (MD5 password, token
refresh, re-login), the request signing, the errcodes, the device payloads
against the core's feature table, the state mapping, the triggers, the widget
content, the safety switches, the quiet logs and the API budget.

Not checked, for lack of a lock and an account (the session's network also
refuses the TTLock hosts):

- the real answers of the cloud: `scripts/probe.mjs` runs the real client,
  read-only, against a fake application (expects a refusal) or against a real
  account given in environment variables;
- the order of `lockRecord/list` pages and how fast a gateway uploads records;
- the record types a real lock sends for each method;
- the real API call limit of a developer application;
- the passage mode configuration format (`cyclicConfig`), taken from the
  current documentation.

```bash
node scripts/probe.mjs                     # fake application: real sign-in until refused
TTLOCK_CLIENT_ID=… TTLOCK_CLIENT_SECRET=… TTLOCK_USERNAME=… TTLOCK_PASSWORD=… \
  node scripts/probe.mjs                   # real account, read-only
```

## Limitations

- No real-time events (see above).
- One TTLock account per Gladys; only the locks the account administers (not
  the eKeys shared with it).
- No management of passcodes, cards, fingerprints or door sensors: use the
  TTLock app.
- The feature names are fixed when a device is added (a Gladys rule).

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and an in-memory TTLock cloud (`test/helpers/fakeTtlock.js`) built from
anonymized fixtures (`test/fixtures/ttlock/`). See [`CLAUDE.md`](CLAUDE.md) for
the project rules.

Versions, tags and releases belong to the Release workflow (Actions →
Release); see the [template](https://github.com/GladysAssistant/integration-template-js)
for the publishing steps.

## Credits

- [hass-ttlock](https://github.com/jbergler/hass-ttlock) by Jonas Bergler and
  contributors (MIT): the Home Assistant integration, whose mirror of the
  TTLock cloud API documentation, record types, feature bits and test
  fixtures shaped this integration (the fixtures are adapted and anonymized
  in `test/fixtures/ttlock/`).
- The [TTLock Open Platform documentation](https://euopen.ttlock.com/document).
- The architecture and the conformity tests follow
  [gladys-wled](https://github.com/guim31/gladys-wled),
  [gladys-pihole](https://github.com/guim31/gladys-pihole) and
  [gladys-subsonic](https://github.com/guim31/gladys-subsonic).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by TTLock, Sciener
or any lock brand. "TTLock" is a trademark of its owner.

## License

Apache-2.0
