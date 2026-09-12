<div align="center">

# 📱 wsl-mobile-dev

### Your WSL2 machine forgets the phone every morning. This remembers it for you.

A tiny CLI that reconciles the state an **Expo** or **React Native** dev build needs on **WSL2**:<br/>
usbipd attachment, adb server, reverse tunnels, Metro hostname.

[![npm](https://img.shields.io/npm/v/wsl-mobile-dev?color=%23cb3837&logo=npm)](https://www.npmjs.com/package/wsl-mobile-dev)
[![CI](https://img.shields.io/github/actions/workflow/status/alexvlrt/wsl-mobile-dev/ci.yml?branch=main&logo=github&label=CI)](https://github.com/alexvlrt/wsl-mobile-dev/actions)
[![coverage](https://img.shields.io/badge/coverage-99%25-brightgreen)](#-tests)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![types](https://img.shields.io/badge/types-TypeScript-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

</div>

---

```console
$ npx wsl-mobile-dev doctor

  ✓ required tools present
  ✓ adb server answering
  ✗ usbipd: phone on bus 2-2 is shared but not attached to WSL (a replug detaches it)
  ✗ reverse 8081 to host 8081 (Metro) is missing
  ✗ reverse 8090 to host 80 (backend) is missing
  ✓ dev client com.example.app.development: installed

  2 fixable by `wsl-mobile-dev up`, 1 needing you.
```

```console
$ npx wsl-mobile-dev up
  fixed: phone on bus 2-2 is shared but not attached to WSL
  fixed: reverse 8081 to host 8081 (Metro) is missing
  fixed: reverse 8090 to host 80 (backend) is missing
Reconciled.
```

---

## 🤔 Why this exists

Search for "Expo on WSL2" and you find fifteen blog posts. Follow one and it works. Come back
tomorrow, and it does not.

**That is the tell.** This was never a documentation problem. It is a **state reconciliation**
problem. A blog post is linear and played once; the machine's state is different every
morning:

| What changed overnight | What breaks |
| :--- | :--- |
| 🔌 You unplugged the phone | A USB reset silently drops the usbipd attachment |
| 💀 The adb server died | Or the Windows adb server grabbed the cable instead |
| 🕳️ The reverse tunnels are gone | `adb reverse` does not survive a reconnect |
| 🐳 You started Docker | Expo picks the bridge IP `172.18.0.1` as the packager host, the Hermes inspector stops registering |
| 🪟 You booted the emulator | It runs on Windows, so the Linux `adb` cannot see it |
| ↩️ You used `adb.exe` | It emits CRLF, so every anchored match like `/device$/` quietly fails |

No document can fix a recurring, variable-state problem. Only an **idempotent program** can.
So this is one: run it as often as you like, it looks at what is actually true and repairs
only what is actually broken.

## 📦 Install

```bash
# Try it without installing anything
npx wsl-mobile-dev doctor

# Or keep it in the project
npm install --save-dev wsl-mobile-dev
pnpm add -D wsl-mobile-dev
```

Requires **Node 20+** and **WSL2**. `doctor` runs anywhere and tells you what is missing.

## 🚀 Commands

| Command | What it does | Touches your machine? |
| :--- | :--- | :---: |
| `doctor` | Reports what is broken, and what is fine. Works with no config at all. | ❌ |
| `init` | Writes a starter config, inferred from your `app.json`. | 📝 config only |
| `up` | Reconciles persistent state: usbipd, adb server, reverse tunnels. Idempotent. | ✅ |
| `dev` | Runs `up`, then starts Metro with a packager hostname a device can reach. | ✅ |
| `emu` | Boots the Windows AVD and attaches its reverses. Does not start Metro. | ✅ |
| `install <apk>` | Installs an APK, retrying the failures that are not really failures. | ✅ |

**Flags:** `--variant <name>` · `--target device|emulator` · `--serial <serial>` · `--dry-run`

## ⚠️ Why `up` cannot fix everything (and says so)

`up` will never set your Metro hostname, and that is deliberate.

`REACT_NATIVE_PACKAGER_HOSTNAME` is an environment variable. It has to exist **inside the
process that runs Metro**. A standalone `up` is a separate process that exits before you ever
type `expo start`, so it physically cannot put a variable into that later shell. Any tool
claiming otherwise is lying to you.

So the split is honest:

- **`up`** reconciles only what survives its own exit: attachments, ports, servers.
- **`dev`** is the one that guarantees the hostname, because it is Metro's **parent process**.
- **`doctor`** reports the risk and points at the fix. It cannot do more.

## ⚙️ Configuration

`wsl-mobile-dev.config.json`, at the root of your project. Run `init` to generate it.

```json
{
  "defaultVariant": "development",
  "variants": {
    "development": {
      "devClientPackage": "com.example.app.development",
      "reverses": [{ "device": 8090, "host": 80, "label": "backend" }]
    },
    "staging": {
      "devClientPackage": "com.example.app.staging"
    }
  },
  "avd": "Medium_Phone_API_36.1"
}
```

- **Variants are first class.** Real projects ship dev, staging and production dev clients with
  different application ids. A single-package config could not replace the scripts people
  already have.
- **Metro's own reverse is added for you.** You never have to remember `8081`.
- **Device ports below 1024 are rejected at validation time**, with an explanation. Android
  refuses a privileged port as a reverse source, and the runtime error it gives you instead is
  useless. This is why a host backend on `:80` is reached through device port `8090`.

### 🔁 The reverse tunnel is the point

If your backend runs on the same machine as Metro, you do **not** need a public tunnel to
reach it from the phone. A reverse does it locally:

```
phone:8090  ->  adb reverse  ->  host:80  ->  your local backend
```

Your API URL becomes a constant (`http://localhost:8090/api/v1`) that no script ever rewrites.
No random subdomain, no waiting for a tunnel to come up, no stale URL baked into a bundle.

## 🔎 Does this describe your day?

If you searched for any of these, you are in the right place:

- `expo wsl2 adb device not found`
- `react native metro 172.18.0.1 hermes inspector`
- `usbipd attach lost after replug`
- `adb devices empty in wsl but works in windows`
- `pm list packages returns nothing after attach`
- `android emulator on windows not visible from wsl`
- `expo dev client cannot connect to metro wsl`

## 🧪 Tests

The interesting part of this package is not the commands, it is that **every decision is a pure
function**. Observation, planning and application are three separate layers, and every external
command goes through one injected seam. So the whole thing is tested without a phone, without
Windows, and without adb.

```bash
npm test           # 237 tests
npm run coverage   # 99% lines, 100% functions
```

Including the property the design rests on:

> **Idempotence.** Reconcile a simulated machine, observe it again, and the second plan must be
> empty. A third pass too. A simulated replug puts it back to broken, and the next `up` silently
> repairs it.

## 🤝 Contributing

Issues and PRs welcome. This is maintained best-effort by one person who uses it daily on one
Xiaomi and one AVD, so **real-world reports from other phones and other Windows builds are the
most useful thing you can send**.

```bash
npm install
npm run check     # typecheck + tests
```

## 📄 License

[MIT](LICENSE)

<div align="center">
<sub>Built out of a <code>dev.sh</code> that grew too many scars worth sharing.</sub>
</div>
