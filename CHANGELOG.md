# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- TTLock smart locks in Gladys, through the TTLock Open Platform cloud API (Europe and China
  clouds): one device per lock of the account, with its state (locked / unlocked, read through
  the gateway or the lock's WiFi), battery, gateway online, and last access (how, who, when).
- A "Lock" button on every lock reachable through a gateway or WiFi.
- Unlocking and passage mode, disabled by default, never offered as a switch: once allowed in
  the configuration, they exist only as scene actions.
- Scene triggers "Lock unlocked" (filter by lock and method; who and how passed on to the
  scene) and "Low battery" (once per battery, threshold in the configuration).
- Scene actions "Lock a TTLock lock", "Unlock a TTLock lock" and "TTLock passage mode".
- A "TTLock lock" dashboard widget: state, battery, gateway, last access and a "Lock" button.
- A "Test the connection" action, with an estimate of the API calls a day.
- Refresh every 5, 10, 15 or 30 minutes, by the integration itself; the state is read at most
  every 30 minutes, and as soon as an access shows up.
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-ttlock/commits/main
