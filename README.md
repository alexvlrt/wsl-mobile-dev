<div align="center">

# 📱 wsl-mobile-dev

### One command to get your Android phone talking to Metro from WSL2 — again, and again.

A small CLI that checks and repairs the four things an **Expo** / **React Native** dev build
needs on **WSL2**: USB passthrough, adb server, reverse tunnels, Metro hostname.

[![npm](https://img.shields.io/npm/v/wsl-mobile-dev?color=%23cb3837&logo=npm)](https://www.npmjs.com/package/wsl-mobile-dev)
[![CI](https://img.shields.io/github/actions/workflow/status/alexvlrt/wsl-mobile-dev/ci.yml?branch=main&logo=github&label=CI)](https://github.com/alexvlrt/wsl-mobile-dev/actions)
[![coverage](https://img.shields.io/badge/coverage-99%25-brightgreen)](#tests)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![types](https://img.shields.io/badge/types-TypeScript-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

</div>

---

## Quick start

```bash
npx wsl-mobile-dev doctor   # tells you what is broken — changes nothing
npx wsl-mobile-dev init     # writes wsl-mobile-dev.config.json
npx wsl-mobile-dev dev      # repairs what is broken, then starts Metro
```

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

`doctor` never touches your machine and exits `1` when something is broken, so it also works
in a script. `up` performs the fixes. `dev` does `up` and then starts Metro.

---

## The problem it solves

To run an Expo dev build on a phone from WSL2, four things must be true **at the same time**:

1. the phone is passed through from Windows to WSL (`usbipd`),
2. the Linux `adb` server is running and can see it,
3. `adb reverse` tunnels exist so the phone can reach Metro and your local backend,
4. Metro announces a hostname the phone can actually reach.

They break constantly, and rarely for the same reason twice:

| What you did | What broke |
| :--- | :--- |
| Unplugged the phone | A USB reset silently drops the usbipd attachment |
| Rebooted | The adb server is gone, or the Windows one grabbed the cable |
| Reconnected | `adb reverse` tunnels do not survive it |
| Started Docker | Expo picks the bridge IP `172.18.0.1`, and the Hermes inspector stops working |
| Booted the emulator | It runs on Windows, so the Linux `adb` cannot see it |

A blog post fixes this once. This tool fixes it every time: it is **idempotent**, so you can
run it as often as you like — it looks at what is actually true and repairs only what is
actually broken.

## Install

```bash
npx wsl-mobile-dev doctor          # no install at all
npm install --save-dev wsl-mobile-dev   # or keep it in the project
```

Then, typically, in `package.json`:

```json
{ "scripts": { "dev": "wsl-mobile-dev dev", "doctor": "wsl-mobile-dev doctor" } }
```

**Requirements:** WSL2, Node 20+, and `adb` on your WSL `PATH`
(`sudo apt-get install -y android-tools-adb`). For a phone over USB you also need
[usbipd-win](https://github.com/dorssel/usbipd-win) on the Windows side
(`winget install usbipd`). `doctor` runs anywhere and names whatever is missing.

## Commands

| Command | What it does | Changes your machine? |
| :--- | :--- | :---: |
| `doctor` | Reports what is broken and what is fine. Works with no config. | no |
| `init` | Writes a starter config, guessing the package id from your `app.json`. | config file only |
| `up` | Repairs usbipd attachment, adb server and reverse tunnels. | yes |
| `dev` | `up`, then `npx expo start --dev-client` with the right Metro hostname. | yes |
| `emu` | Boots the Windows AVD and attaches its tunnels. Does not start Metro. | yes |
| `install <apk>` | Installs an APK, retrying the failures that are not really failures. | yes |

**Options:** `--variant <name>` · `--target device|emulator` · `--serial <serial>` ·
`--dry-run` (print what `up` would do) · `--help` · `--version`

## Configuration

`wsl-mobile-dev.config.json`, at the root of your project. `init` generates it for you.

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

| Key | Meaning |
| :--- | :--- |
| `variants.<name>.devClientPackage` | Android application id of that dev client build. Required. |
| `variants.<name>.reverses` | Extra tunnels, `{ device, host, label? }`. Metro's `8081 → 8081` is added for you. |
| `defaultVariant` | Which variant to use when `--variant` is not passed. |
| `avd` | Windows AVD name used by `emu`. |
| `packagerHostname` | Hostname handed to Metro. Defaults to `localhost`. |

> **Device ports must be 1024 or above.** Android refuses a privileged port as the *source*
> of a reverse, and the runtime error it gives you instead is useless. So a backend running
> on host `:80` is reached through device port `8090`.

### Why reverse tunnels

If your backend runs on the same machine as Metro, the phone can reach it locally — no public
tunnel, no ngrok:

```
phone:8090  ->  adb reverse  ->  host:80  ->  your local backend
```

Your API URL becomes a constant (`http://localhost:8090/api/v1`) that no script ever rewrites:
no random subdomain, no waiting for a tunnel, no stale URL baked into a bundle.

### Why `dev` exists next to `up`

`up` will never set your Metro hostname, on purpose. `REACT_NATIVE_PACKAGER_HOSTNAME` is an
environment variable, so it only exists inside the process that sets it — a standalone `up`
exits long before you type `expo start`, and cannot reach into that later shell.

So: `up` repairs what survives its own exit (attachments, servers, tunnels). `dev` is the one
that guarantees the hostname, because it is Metro's parent process. `doctor` reports the risk
and points at the fix. If you prefer your own Metro command, export the variable yourself.

## Does one of these sound like your day?

- `expo wsl2 adb device not found`
- `react native metro 172.18.0.1 hermes inspector`
- `usbipd attach lost after replug`
- `adb devices empty in wsl but works in windows`
- `android emulator on windows not visible from wsl`
- `expo dev client cannot connect to metro wsl`

Then `doctor` is the first thing to run.

## Tests

Observation, planning and execution are three separate layers, and every external command
goes through one injected seam — so the whole tool is tested without a phone, without Windows
and without adb.

```bash
npm test           # 254 tests
npm run coverage   # 99% lines, 100% functions
```

Including the property the design rests on:

> **Idempotence.** Reconcile a simulated machine, observe it again, and the second plan must
> be empty. A third pass too. A simulated replug puts it back to broken, and the next `up`
> silently repairs it.

## Contributing

Issues and PRs welcome. This is maintained best-effort by one person who uses it daily on one
Xiaomi and one AVD, so **reports from other phones and other Windows builds are the most
useful thing you can send**.

```bash
npm install
npm run check     # typecheck + tests
```

## License

[MIT](LICENSE)

<div align="center">
<sub>Built out of a <code>dev.sh</code> that grew too many scars worth sharing.</sub>
</div>
