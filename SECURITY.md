# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Configuration** (stored by Gladys): the client ID and secret of the TTLock
  developer application, and the e-mail (or phone) and password of the TTLock
  app account. The password is sent to TTLock as an MD5 hash, as the TTLock app
  does, and only over HTTPS.
- **`/data/ttlock-state.json`**, the only file written, owner-only: the TTLock
  access and refresh tokens, and per lock the ids of the records already seen,
  the last access (method, the name TTLock gives it, time) and whether the low
  battery was announced. Never a passcode: the `keyboardPwd` of a record is
  dropped as soon as it is read.
- **Network**: HTTPS to `euapi.ttlock.com` or `cnapi.ttlock.com` only; nothing
  listens.
- **Commands**: locking is always available; unlocking and passage mode are
  disabled by default and, once allowed, exist only as scene actions.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the TTLock cloud, apps, gateways and locks.
