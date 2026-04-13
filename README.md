<div align="center" markdown="1">
  <sup>Special thanks to:</sup>
  <br>
  <a href="https://go.warp.dev/SwitchHosts">
    <img alt="Warp sponsorship" width="400" src="https://github.com/user-attachments/assets/bb4a0222-12bf-4c79-bb80-a8ed4672b801" />
  </a>

### [Warp, the intelligent terminal for developers](https://go.warp.dev/SwitchHosts)

[Available for MacOS, Linux, & Windows](https://go.warp.dev/SwitchHosts)<br>

</div>

---

# SwitchHosts

- [Polski](README.pl.md)
- [简体中文](README.zh_hans.md)
- [繁體中文](README.zh_hant.md)

Homepage: [https://switchhosts.vercel.app](https://switchhosts.vercel.app)

SwitchHosts is an App for managing hosts file, it is based on [Tauri](https://tauri.app/), [React](https://facebook.github.io/react/), [Jotai](https://jotai.org/), [Mantine](https://mantine.dev/), etc.

## Screenshot

<img src="https://raw.githubusercontent.com/oldj/SwitchHosts/master/screenshots/sh_light.png" alt="Capture" width="960">

## Features

- Switch hosts quickly
- Syntax highlight
- Remote hosts
- Switch from system tray

## Install

### Download

You can download the source code and build it yourself, or download the built version from following
links:

- [SwitchHosts Download Page (GitHub release)](https://github.com/oldj/SwitchHosts/releases)

You can also install the built version using the [package manager Chocolatey](https://community.chocolatey.org/packages/switchhosts):

```powershell
choco install switchhosts
```

## Backup

SwitchHosts stores data at `~/.SwitchHosts` (Or folder `.SwitchHosts` under the current user's home
path on Windows), the `~/.SwitchHosts/data` folder contains data, while the `~/.SwitchHosts/config`
folder contains various configuration information.

## Develop and build

### Prerequisites

- [Node.js](https://nodejs.org/)
- [Rust](https://www.rust-lang.org/tools/install)
- Tauri system dependencies, see [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)

### Development

- Run `npm install` to install dependencies
- Run `npm run tauri:dev` to start the app in development mode

### Build and package

- Run `npm run tauri:build` to create a production build
- The packaged files will be in `./src-tauri/target/release/bundle/`

```bash
# development
npm run tauri:dev

# production build
npm run tauri:build
```

## Copyright

SwitchHosts is a free and open source software, it is released under the [Apache License](./LICENSE).
