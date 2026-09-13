<div align="center">

# 📱 wsl-mobile-dev

### One command to get your Android phone talking to Metro from WSL2, again and again.

A small CLI that checks and repairs the four things an **Expo** / **React Native** dev build
needs on **WSL2**: USB passthrough, adb server, reverse tunnels, Metro hostname.

[![npm](https://img.shields.io/npm/v/wsl-mobile-dev?color=%23cb3837&logo=npm)](https://www.npmjs.com/package/wsl-mobile-dev)
[![CI](https://img.shields.io/github/actions/workflow/status/alexvlrt/wsl-mobile-dev/ci.yml?branch=main&logo=github&label=CI)](https://github.com/alexvlrt/wsl-mobile-dev/actions)
[![coverage](https://img.shields.io/badge/coverage-99%25-brightgreen)](#-tests)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

</div>

---

## ⚡ Quick start

```bash
npx wsl-mobile-dev doctor   # tells you what is broken, changes nothing
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

Using it every day? `npm install --save-dev wsl-mobile-dev`, then call it from your scripts.

**Requirements:** WSL2, Node 20+, and `adb` on your WSL `PATH`
(`sudo apt-get install -y android-tools-adb`). For a phone over USB, also
[usbipd-win](https://github.com/dorssel/usbipd-win) on Windows (`winget install usbipd`).
`doctor` runs anywhere and names whatever is missing.

## 🤔 Why

Running an Expo dev build from WSL2 means keeping the phone passed through from Windows, the
adb server alive, the `adb reverse` tunnels up and Metro's hostname reachable, all at once.
They break constantly, and rarely for the same reason twice:

| What you did | What broke |
| :--- | :--- |
| Unplugged the phone | A USB reset silently drops the usbipd attachment |
| Rebooted | The adb server is gone, or the Windows one grabbed the cable |
| Reconnected | `adb reverse` tunnels do not survive it |
| Started Docker | Expo picks the bridge IP `172.18.0.1`, and the Hermes inspector stops working |
| Booted the emulator | It runs on Windows, so the Linux `adb` cannot see it |

A blog post fixes this once. This tool is **idempotent**, so you can run it as often as you
like: it looks at what is actually true and repairs only what is actually broken.

## 🚀 Commands

| Command | What it does | Changes your machine? |
| :--- | :--- | :---: |
| `doctor` | Reports what is broken and what is fine. Works with no config, exits `1` when something is broken. | no |
| `init` | Writes a starter config, guessing the package id from your `app.json`. | config file only |
| `up` | Repairs usbipd attachment, adb server and reverse tunnels. | yes |
| `dev` | `up`, then `npx expo start --dev-client` with the right Metro hostname. | yes |
| `emu` | Boots the Windows AVD and attaches its tunnels. Does not start Metro. | yes |
| `install <apk>` | Installs an APK, retrying the failures that are not really failures. | yes |

**Options:** `--variant <name>` · `--target device|emulator` · `--serial <serial>` ·
`--dry-run` · `--help` · `--version`

> **`up` never sets the Metro hostname, on purpose.**
> `REACT_NATIVE_PACKAGER_HOSTNAME` only exists inside the process that sets it, and a
> standalone `up` exits long before you type `expo start`. Use `dev`, which is Metro's parent
> process, or export the variable yourself.

## ⚙️ Configuration

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
> of a reverse. So a backend on host `:80` is reached through device port `8090`.

A reverse tunnel is also why you need no ngrok for your local backend:

```
phone:8090  ->  adb reverse  ->  host:80  ->  your local backend
```

Your API URL becomes a constant (`http://localhost:8090/api/v1`) that no script ever rewrites.

## 🧪 Tests

Observation, planning and execution are separate layers, and every external command goes
through one injected seam, so the tool is tested without a phone, without Windows and
without adb, including the idempotence property the whole design rests on.

```bash
npm test           # 254 tests
npm run coverage   # 99% lines, 100% functions
```

## 🤝 Contributing

Issues and PRs welcome, especially reports from other phones and other Windows builds.
Run `npm install && npm run check` (typecheck + tests) before opening one.

## 📄 License

[MIT](LICENSE)
