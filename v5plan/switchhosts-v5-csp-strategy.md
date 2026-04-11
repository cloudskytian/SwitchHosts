# SwitchHosts v5 Content-Security-Policy 策略

## 目的

本文件定义 Tauri 版本的 CSP 策略，是 Phase 0b 的交付物之一。当前 Phase 0a 已经在 `src-tauri/tauri.conf.json` 写入了一版宽松 CSP 以保证窗口能渲染；Phase 1A 与 Phase 2 需要依照本文件逐步收紧。

## 背景

当前 Electron 版的 renderer 没有 CSP：

- [src/renderer/index.html](/Users/wu/studio/SwitchHosts/src/renderer/index.html) 没有 `<meta http-equiv="Content-Security-Policy">`
- Electron 主进程也未设置 `session.defaultSession.webRequest.onHeadersReceived` 类型的 CSP 注入
- 安全模型完全依赖 preload 的 `contextIsolation` 隔离

这在 Electron 下勉强够用，但 Tauri 2 的 webview 可以直接被前端代码触发 `invoke` —— 一旦前端被注入脚本，影响面比 Electron 更直接。因此 v5 必须显式维护 CSP。

## 策略总览

CSP 分两级管理：

1. **Dev CSP**（`tauri dev` / React HMR 场景）：宽松度足以让 Vite 的 HMR websocket、source map、浏览器内联错误提示正常工作
2. **Prod CSP**（`tauri build` 打包产物）：收紧到只允许 `'self'` + Tauri 的 `ipc:` + 必要的 `asset:` / `data:` / 运行时样式

Tauri 2 的 `tauri.conf.json > app.security.csp` 字段支持构建时根据 `--debug` / release 切换；同时也可以通过 `devCsp` 字段提供独立的 dev 策略。v5 采用下述分层。

## Prod CSP（目标状态）

```text
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' asset: data:;
font-src 'self' data:;
connect-src 'self' ipc: http://ipc.localhost;
object-src 'none';
base-uri 'self';
frame-ancestors 'none';
form-action 'none';
```

逐条说明：

- `default-src 'self'`：保底策略，后面的指令覆盖具体类型
- `script-src 'self' 'wasm-unsafe-eval'`：
  - **禁止** `'unsafe-inline'` 与 `'unsafe-eval'`
  - 保留 `'wasm-unsafe-eval'` 是因为 wry 的 webview 在某些平台需要它来初始化自身 bridge；若 Phase 2 验证下来不需要可移除
- `style-src 'self' 'unsafe-inline'`：
  - Mantine 8 在运行时注入内联 `<style>` 标签实现主题切换和动态 CSS 变量，必须允许 inline style
  - 若后续切换到 CSS-in-JS 的"静态提取"方案，可改为 `'self'` + 构建期 hash
- `img-src 'self' asset: data:`：
  - `asset:` 是 Tauri 的自定义协议，用于访问 Rust 侧通过 `asset_protocol` 暴露的资源
  - `data:` 允许 base64 小图标（图标文件中也有这种情况）
  - **不允许** `https:` —— renderer 侧不应该直接加载外部图片；若将来需要显示远程 favicon 等，走 Rust 代理
- `font-src 'self' data:`：Mantine 和部分组件库用 data URI 内联 woff 字体
- `connect-src 'self' ipc: http://ipc.localhost`：
  - `ipc:` 是 Tauri 2 在 Linux/Windows 上使用的 invoke 通道
  - `http://ipc.localhost` 是 Tauri 2 在 macOS 上使用的 invoke 通道（自定义 loopback）
  - **不允许** 任意外部域名 —— 所有远程请求都走 Rust 后端
- `object-src 'none'`：完全禁止 `<object>`/`<embed>`/`<applet>`
- `base-uri 'self'`：防止 `<base href>` 被注入篡改链接
- `frame-ancestors 'none'`：不允许任何外部页面把 SwitchHosts 嵌入 iframe
- `form-action 'none'`：项目没有表单提交，显式禁用

## Dev CSP（开发态松绑项）

在 dev 模式下，相较 prod 额外允许以下内容：

```text
script-src ... http://127.0.0.1:8220;
connect-src ... ws://127.0.0.1:8220 http://127.0.0.1:8220;
img-src ... http://127.0.0.1:8220;
style-src ... http://127.0.0.1:8220;
```

原因：

- Vite 的 HMR client 从 `http://127.0.0.1:8220` 加载 JS 并通过 `ws://127.0.0.1:8220` 推送热更新
- 开发时的 source map / 动态 import 走 `fetch` 到同一源
- 偶尔会有 dev-only 的 inline 样式或 img 通过 Vite 重写到 `http://127.0.0.1:8220`

实现方式选择：

- **首选**：`tauri.conf.json > app.security.devCsp` 单独维护 dev 策略
- **备选**：若 Tauri 版本不支持 `devCsp`，改为在构建脚本里根据 `--debug` 生成不同的 `tauri.conf.json` 片段

Phase 0a 当前已写入的 CSP 属于"dev 与 prod 混合"的过渡版本，容忍 Vite HMR 的同时也允许了 Vite 地址出现在 prod CSP 里 —— Phase 1A 必须把它拆成 dev/prod 两份。

## 不允许的内容（硬边界）

下列内容在任何时候都不允许：

- `script-src` 出现 `'unsafe-inline'`
- `script-src` 出现 `'unsafe-eval'`
- `script-src` 或 `connect-src` 出现任意 `https://` 外部域名
- `frame-src` 允许任何来源（项目不使用 iframe）
- `worker-src` 允许 `blob:` 或 `data:`（目前不使用 Web Worker）

若将来因新功能需要放宽，必须走"CSP 变更评审 + 重新评估权限矩阵"流程，而不是直接改 `tauri.conf.json`。

## Tauri dev CSP 的已知坑点

Tauri 在运行时会对 CSP 做一次自动处理：

- Tauri 会在 HTML 注入之前的处理阶段往 CSP 的 `script-src` 追加它自身的 nonce，允许 `window.__TAURI_INTERNALS__` 相关 bootstrap 脚本运行
- 这发生在 Tauri 构建期，不需要手动 allow inline 或 nonce

因此：

- 不要为了"让 Tauri bootstrap 通过"而在 `script-src` 加 `'unsafe-inline'`
- 如果 prod 构建后浏览器控制台出现 "Refused to execute inline script because it violates ..."，应检查 Tauri 构建日志里的 nonce 注入是否被某步处理打断，而不是直接放宽 CSP

## 与 capability 矩阵的一致性

本策略与 [switchhosts-v5-capabilities-and-commands.md](/Users/wu/studio/SwitchHosts/v5plan/switchhosts-v5-capabilities-and-commands.md) 形成双重保险：

- capability 矩阵保证**前端能调用哪些 command**
- CSP 保证**前端能向哪些目标发起网络或资源请求**

两者必须同时满足，才允许一条请求成功。举例：即使 `core:http` plugin 被启用了，只要 CSP 的 `connect-src` 没有对应外部域名，请求依然会被浏览器层拦截。v5 同时在 capability 和 CSP 两个层面都禁止前端直连外部网络。

## 验收

- [ ] Phase 1A 拆分出 dev / prod 两份 CSP，并通过基础页面冒烟测试
- [ ] Phase 2 完成后对 prod 构建启用"严格模式"：任何 CSP 违反都在 DevTools 控制台里报可见错误，作为 Beta 验收项
- [ ] Phase 2 在构建流水线里加一个 CSP 静态 lint：检测 `script-src` 是否出现 `unsafe-*` 关键字，出现即失败
- [ ] Beta 版本发布前进行一次 CSP 回归：刷新主窗口 / 查找窗口 / 托盘小窗，确保三者都没有 CSP 报错
