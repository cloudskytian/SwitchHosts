<div align="center" markdown="1">
  <sup>Special thanks to:</sup>
  <br>
  <a href="https://go.warp.dev/SwitchHosts">
    <img alt="Warp sponsorship" width="400" src="https://github.com/user-attachments/assets/352a755a-6776-43fd-b324-19dc649747b2" />
  </a>

### [Warp, the intelligent terminal for developers](https://go.warp.dev/SwitchHosts)

[Available for MacOS, Linux, & Windows](https://go.warp.dev/SwitchHosts)<br>

</div>

---

# SwitchHosts

- [English](README.md)
- [Polski](README.pl.md)
- [简体中文](README.zh_hans.md)

項目主頁：[https://switchhosts.vercel.app](https://switchhosts.vercel.app)

SwitchHosts 是一個管理 hosts 檔案的應用程式，基於 [Tauri](https://tauri.app/)、[React](https://facebook.github.io/react/)、[Jotai](https://jotai.org/)、[Mantine](https://mantine.dev/) 等技術開發。

## 螢幕截圖

<img src="https://raw.githubusercontent.com/oldj/SwitchHosts/master/screenshots/sh_light.png" alt="Capture" width="960">

## 功能特性

- 快速切換 hosts 方案
- hosts 語法高亮顯示
- 支援從網路載入遠程 hosts 設定
- 可從系統菜單欄圖是快速切換 hosts

## 安裝

### 下載

你可以下載原始碼並自行建置，也可以從以下網址下載已經建置好的版本：

- [SwitchHosts Download Page (GitHub release)](https://github.com/oldj/SwitchHosts/releases)

你也可以通過 [Chocolatey 包管理器](https://community.chocolatey.org/packages/switchhosts)安裝已經建置好的版本：

```powershell
choco install switchhosts
```

## 數據備份

SwitchHosts 的數據文件儲存於 `~/.SwitchHosts` (Windows 下儲存使用者個人文件裡的 `.SwitchHosts` 資料夾），
其中 `~/.SwitchHosts/data` 資料夾包含數據，`~/.SwitchHosts/config` 資料夾包含各種設定。

## 開發及建置

### 前置要求

- [Node.js](https://nodejs.org/)
- [Rust](https://www.rust-lang.org/tools/install)
- Tauri 系統依賴，參見 [Tauri 前置要求](https://v2.tauri.app/start/prerequisites/)

### 開發

- 執行 `npm install` 安裝依賴
- 執行 `npm run tauri:dev` 啟動開發模式

### 建置及打包

- 執行 `npm run tauri:build` 進行生產建置
- 打包後的檔案位於 `./src-tauri/target/release/bundle/`

```bash
# 開發
npm run tauri:dev

# 生產建置
npm run tauri:build
```

## 版權聲明

SwitchHosts 是一個免費開源軟體，基於 Apache-2.0 開源協議發佈。
