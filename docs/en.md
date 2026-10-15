# TTLock

Brings your **TTLock smart locks** into Gladys through the official TTLock Open Platform cloud API: door locks, padlocks and key boxes of the many brands built on TTLock (the lock is set up in the TTLock app), reached through a TTLock gateway (G2, G3...) or their own WiFi.

> **Developed without the hardware: feedback welcome.** This integration was written from the TTLock API documentation and the answers published by the Home Assistant integration, without a real lock or account. Please report what works and what does not on the Gladys forum or in a GitHub issue.

This integration is not affiliated with TTLock, Sciener or any lock brand.

## Overview

- One Gladys device per lock of your TTLock account, with its **state** (locked / unlocked), its **battery**, whether its **gateway is online**, and its **last access** (who, how, when).
- A **Lock** button. Locking is always safe: it is the only command a device offers.
- **Unlocking is off by default**, and never offered as a switch, a dashboard button or a voice command. If you allow it explicitly, it exists only as a scene action. Same for the passage mode.
- Two scene triggers: **Lock unlocked** (with how: passcode, card, fingerprint, app...) and **Low battery**.
- A dashboard widget: state, battery, gateway, last access and a **Lock** button.

## Requirements

- Gladys Assistant 5.1.0 or later.
- Your locks added in the **TTLock app**, with the account that administers them (the "admin" of the lock, not a person who received an eKey).
- To read the state and to lock from Gladys: a **TTLock gateway** (G2, G3, G4...) paired with the lock, or a **WiFi lock**. A Bluetooth-only lock without gateway only shows its battery and its last accesses, as synchronized by the app.
- A free **developer application** on the TTLock Open Platform:
  1. Create an account on [euopen.ttlock.com](https://euopen.ttlock.com/manager) (China: cnopen.ttlock.com). This developer account is **not** your TTLock app account.
  2. Create an application. TTLock may take a few days to approve it.
  3. Note its **client ID** and **client secret**.

## Configuration

In Gladys, open **Integrations → TTLock → Configuration** and fill in:

| Field                          | What to enter                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| TTLock cloud                   | "Europe and world" for an application created on euopen.ttlock.com, "China" for cnopen.     |
| Client ID / Client secret      | The values of your developer application.                                                   |
| TTLock app account / password  | The e-mail address or phone number and the password **you sign in to the TTLock app with**. |
| Refresh interval               | 5, 10, 15 or 30 minutes (see [API calls](#api-calls-and-quota)).                            |
| Low battery under              | The level under which the "Low battery" trigger fires.                                      |
| Language of the device texts   | Language of the feature names (fixed when a device is added) and of the last access text.   |
| Allow unlocking from scenes    | Off by default. Read [Safety](#safety) first.                                               |
| Allow passage mode from scenes | Off by default.                                                                             |

Click **Test the connection**: the message gives the number of locks and gateways, and an estimate of the API calls a day. Then open the **Discovery** tab and add your locks.

The password is sent to TTLock as an MD5 hash, like the TTLock app does. The access token TTLock returns (valid 90 days, renewed automatically) is stored in the integration's private volume, `/data`.

## Devices

Each lock of the account becomes a device named after its name in the TTLock app.

| Feature        | Type              | What it shows                                                                                             |
| -------------- | ----------------- | --------------------------------------------------------------------------------------------------------- |
| Lock state     | Lock state (read) | Locked or unlocked, as the lock answers through its gateway or WiFi.                                      |
| Lock           | Push button       | Locks the door. Only for a lock with a gateway or WiFi.                                                   |
| Battery        | Battery (%)       | The battery level of the lock.                                                                            |
| Gateway online | Yes / No          | Whether a gateway in range of the lock is connected to TTLock. Only for a lock with a gateway.            |
| Last access    | Text              | The last unlocking: how, who (app account, or the name given to the passcode, card or fingerprint), when. |

The lock state is never a switch: a switch could open the door with one tap, from a scene that "turns everything off", or from a voice assistant.

How the values are refreshed: every refresh reads the new records of the lock (accesses) and the gateway status. The state is asked to the lock itself, through its gateway, at start, after a command, as soon as a new access or locking shows up, and every 30 minutes otherwise: asking wakes the lock up, which costs its battery and API calls.

## Widget

**TTLock lock**: choose a lock in the widget settings. It shows the battery, the state, the gateway, the last access, and a **Lock** button. There is no unlock button. For a lock without gateway nor WiFi, a sentence replaces the button.

## Scene triggers

**Lock unlocked**: someone unlocked a lock. Filters: the lock (empty: any), and how (empty: any). Information passed on to the scene: the lock name, who (the app account, or the name of the passcode, card or fingerprint) and how.

- It fires at the refresh that sees the access: up to the refresh interval after the door was opened.
- An access uploaded late by the gateway (more than 15 minutes after it happened) updates the last access but fires nothing: it is history, not news.
- Failed attempts fire nothing.

**Low battery**: the battery of a lock fell under the configured level. It fires once; it fires again only after the level went back 5 points above the threshold (new batteries). Information passed on: the lock name and the battery level.

## Scene actions

- **Lock a TTLock lock**: locks, then reads the state back. Result: "Reported locked" (yes / no).
- **Unlock a TTLock lock**: refused unless "Allow unlocking from scenes" is on. Result: "Reported unlocked".
- **TTLock passage mode**: refused unless "Allow passage mode from scenes" is on. On: once opened, the lock stays open, all day, every day, until passage mode is turned off; it does not open by itself. Off: the lock locks again normally.

## Safety

Unlocking and passage mode open your door to whoever stands in front of it. That is why they are off by default and only exist as scene actions, never as a switch, a widget button, a voice command or a HomeKit / Google Home / Alexa device.

Before allowing them:

- Think about every trigger of the scene: a presence detected by mistake, a phone left at home, a scene started from the dashboard by anyone in the house.
- Gladys users can edit scenes: everyone with an account can then open the door.
- Prefer a short passcode or an eKey sent from the TTLock app for a visitor.

## Scene examples

- **Who came home**: trigger "Lock unlocked", how = fingerprint or passcode → send a message "{{lock name}}: {{who}} ({{how}})".
- **Lock up at night**: every day at 23:00, if the front door state is "unlocked" → action "Lock a TTLock lock".
- **Change the batteries**: trigger "Low battery" → send a message "Change the batteries of {{lock name}} ({{battery}} %)".
- **Leaving home**: when the last person leaves → "Lock a TTLock lock" on every door, then send a message if "Reported locked" is no.

## API calls and quota

TTLock cannot push events to a local Gladys: its callback URL must be reachable from the Internet. The integration therefore polls the TTLock cloud. TTLock limits the API calls of a developer application (error 30006, "exceeds the restrictions of API call number"); the limit itself is not published.

What a refresh costs:

- every refresh: 1 call for the gateways of the account, 1 call per lock (its records);
- every 30 minutes, and after each access: 1 call per lock with gateway or WiFi (its state);
- every hour: 1 call for the lock list, 1 per lock with gateway (its gateways).

One lock with a gateway, every 5 minutes: about 670 calls a day, 20,000 a month. Every 15 minutes: about 290 a day. **Test the connection** gives the estimate for your locks. If the limit is reached, the Configuration screen says so: choose a longer interval.

Only the locks you added in Gladys are refreshed.

## Troubleshooting

- **"TTLock refuses the sign-in"**: check the client ID and secret (on the application page of the Open Platform), and that the account is the one of the **TTLock app**, not the developer account. The region must be the one of the application.
- **No lock in the Discovery tab**: the account must be the administrator of the locks. Locks shared with you as an eKey are not listed by TTLock.
- **The state stays unknown**: the lock needs a gateway (or WiFi), and the gateway must be online. Check "Gateway online".
- **"API call limit reached"**: choose a longer refresh interval, or remove the locks you do not need from Gladys.
- **The last access is late**: accesses reach the cloud through the gateway, then Gladys at the next refresh.
- Detailed logs: set the `LOG_LEVEL` environment variable of the integration to `debug`. Tokens, passwords and passcodes are never written.

## Limitations

- Developed without the hardware nor a TTLock account: the answers of the API come from its documentation.
- No real-time events: the delay is the refresh interval. TTLock's callback needs a public URL.
- One TTLock account per Gladys. Only the locks the account administers.
- No door sensor, passcode, card or fingerprint management: use the TTLock app.
- At most 50 records per lock are read at each refresh: on a very busy lock with a long refresh interval, some accesses may be skipped.
- The feature names are fixed when the device is added: changing the language afterwards only renames new devices.
