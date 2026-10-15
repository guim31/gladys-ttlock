# TTLock cloud fixtures

Answers of the TTLock Open Platform cloud API (v3), shaped after the official
documentation (euopen.ttlock.com, mirrored in
[jbergler/hass-ttlock](https://github.com/jbergler/hass-ttlock/tree/main/docs/ttlock-cloud-api))
and the fixtures of that Home Assistant integration (`tests/const.py`, MIT
license, © Jonas Bergler).

Anonymized: lock and gateway ids, MAC addresses, names, tokens and accounts are
invented; the credential fields TTLock returns (`lockData`, `lockKey`,
`adminPwd`...) are replaced by `<REMOVED>`. The passcode in
`lockRecord-list.json` (`keyboardPwd`) is kept on purpose: a test checks it
never reaches Gladys nor the logs.
