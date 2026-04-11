# SwitchHosts v5 Tauri 迁移方案

## 背景

SwitchHosts 当前基于 Electron + React + Vite 构建，桌面能力主要集中在 Electron 主进程、preload 桥接和一套基于 IPC 的 action/broadcast 机制中。

v5 的目标是在不重写主要 UI 的前提下，将桌面壳能力迁移到 Tauri 2，并与既定的 v5 明文主存储方案配合，形成一个更轻量、更安全、长期更易维护的桌面架构。

本方案与以下文档配套使用：

- [switchhosts-v5-storage-plan.md](/Users/wu/studio/SwitchHosts/v5plan/switchhosts-v5-storage-plan.md)

该文档只讨论 Tauri 迁移路径，不重复展开存储格式本身的字段设计。

---

## 迁移目标与原则

### 总体目标

- 保留现有 React + Vite renderer，尽量不重写 UI 页面
- 将桌面壳能力从 `Electron main + preload + IPC` 迁移到 `Tauri 2 + Rust commands/events/plugins`
- 与 v5 明文主存储方案对齐，摆脱 PotDb 作为长期运行时依赖
- 不引入 Node sidecar
- 首个可交付的 Tauri 版本必须保留本地 HTTP API

### 核心原则

- 分阶段迁移，而不是一次性大切换
- 以 Rust 主导桌面后端和 I/O 能力，前端尽量保持稳定
- 优先迁移高耦合、高风险、对长期架构影响大的能力
- 迁移过程以“功能对等可验证”为导向，每阶段都要有明确出口条件

## 非目标

v5 首版明确不做以下事项：

- 不引入 Node sidecar
- 不重写主要 UI 页面
- 不在首版引入实时文件监听
- 不把用户主数据目录的读写默认开放给前端 `fs` 访问
- 不要求 Electron 与 v5 长期并行读写同一份目录
- 不保留运行时“切换数据目录”能力，v5 根目录固定为 `~/.SwitchHosts`

---

## 兼容范围

v5 的直接升级目标限定为“已经升级到最新 Electron 版本，并已使用 PotDb 数据目录”的用户。

明确约束如下：

- v5 直接兼容当前 Electron 版本使用的 PotDb 数据目录
- v5 不直接读取更老版本遗留的 `data.json` 等非 PotDb 结构
- 仍停留在 v3 数据结构的用户，需要先升级到最新 Electron 版本，再升级到 v5
- 这样可以避免在 Tauri 版中继续保留过深的历史兼容链路
- v5 首次启动时必须先检查旧布局，在固定根目录 `~/.SwitchHosts` 下写入新格式，并在成功后把旧版文件归档到 `~/.SwitchHosts/v4/`
- 迁移完成后，v5 固定使用 `~/.SwitchHosts` 运行，`v4/` 仅作为旧版归档目录
- 上述限制只约束“首次启动自动迁移”链路，不等于手动导入能力范围
- 手动导入旧版 JSON 备份的兼容范围在 Phase 1B 中单独实现与验收

---

## 当前架构现状盘点

### 1. 应用壳与窗口体系

当前 Electron 应用壳主要包含：

- 主窗口
- 查找窗口
- 托盘小窗
- 顶部菜单
- 系统托盘
- 单实例控制
- 窗口状态恢复

代表入口：

- [src/main/main.ts](/Users/wu/studio/SwitchHosts/src/main/main.ts:1)
- [src/main/ui/tray/index.ts](/Users/wu/studio/SwitchHosts/src/main/ui/tray/index.ts:1)
- [src/main/ui/find.ts](/Users/wu/studio/SwitchHosts/src/main/ui/find.ts:1)
- [src/main/ui/menu.ts](/Users/wu/studio/SwitchHosts/src/main/ui/menu.ts:1)

### 2. 桥接层与进程通信

当前前端与桌面后端的交互依赖：

- preload 暴露 `window._agent`
- `x_action` 调用 action
- `x_broadcast` / `y_broadcast` 做窗口间广播

代表入口：

- [src/main/preload.ts](/Users/wu/studio/SwitchHosts/src/main/preload.ts:1)
- [src/main/core/message.ts](/Users/wu/studio/SwitchHosts/src/main/core/message.ts:1)
- [src/main/core/agent.ts](/Users/wu/studio/SwitchHosts/src/main/core/agent.ts:1)
- [src/renderer/core/agent.ts](/Users/wu/studio/SwitchHosts/src/renderer/core/agent.ts:1)

### 3. 核心业务能力

当前 Electron 后端负责的核心能力包括：

- hosts 列表与内容管理
- 系统 hosts 写入
- 远程 hosts 刷新
- 远程请求代理
- `file://` 远程源读取
- 导入导出
- 数据目录切换
- 数据目录切换后的重启
- 打开外链
- 在文件管理器中定位文件
- 应用后执行命令
- 回收站与历史记录
- 系统语言检测
- Dock 图标隐藏
- 托盘标题更新

代表入口：

- [src/main/actions/index.ts](/Users/wu/studio/SwitchHosts/src/main/actions/index.ts:1)
- [src/main/actions/hosts/setSystemHosts.ts](/Users/wu/studio/SwitchHosts/src/main/actions/hosts/setSystemHosts.ts:1)
- [src/main/actions/hosts/refresh.ts](/Users/wu/studio/SwitchHosts/src/main/actions/hosts/refresh.ts:1)
- [src/main/actions/cmd/changeDataDir.ts](/Users/wu/studio/SwitchHosts/src/main/actions/cmd/changeDataDir.ts:1)

### 4. 服务能力与发布链路

当前还存在两类迁移成本较高的系统能力：

- 本地 HTTP API，用于 Alfred 等第三方调用
- 自动更新与打包发布链

代表入口：

- [src/main/http/index.ts](/Users/wu/studio/SwitchHosts/src/main/http/index.ts:1)
- [src/main/core/updater.ts](/Users/wu/studio/SwitchHosts/src/main/core/updater.ts:1)
- [scripts/make.mjs](/Users/wu/studio/SwitchHosts/scripts/make.mjs:1)

---

## 目标架构

### 1. 前端层

继续保留当前 `src/renderer` 作为主要 UI 层。

迁移重点不是重写页面，而是将前端依赖的桌面调用接口从 Electron preload 改为 Tauri 适配层：

- 保留 `actions.xxx()` 的使用习惯
- 保留 `agent.on/off/broadcast()` 的概念
- 将底层实现替换为 Tauri 的 `invoke`、事件系统和窗口 API

目标是尽量减少 UI 页面中的平台迁移噪音。

### 2. 应用后端

桌面后端由 Rust 负责，主要承接：

- 固定根目录 `~/.SwitchHosts` 下的主存储读写
- 旧 PotDb 数据迁移
- 系统 hosts 写入
- 导入导出
- 远程刷新
- 外部打开和文件定位
- 更新流程
- 本地 HTTP API

Rust 后端通过 commands 和内部服务向前端暴露能力。

### 3. 事件系统

当前基于 Electron IPC 的广播系统迁移为：

- Tauri command：替代 action 调用
- Tauri event：替代窗口间广播
- Tauri window API：替代窗口焦点、显示、隐藏、查找窗口、小窗控制

### 4. 本地服务

本地 HTTP API 不继续依赖 `@hono/node-server`，而改为 Rust 内嵌本地 HTTP 服务。

迁移要求：

- 默认端口保持兼容
- 现有 API 路由保持兼容
- `127.0.0.1` / `0.0.0.0` 监听策略保持兼容
- 配置项 `http_api_on`、`http_api_only_local` 继续保留

### 5. 存储层

主业务数据遵循既定的 v5 存储方案：

- `manifest.json`
- `entries/<id>.hosts`
- `trashcan.json`

应用内部存储仅保留：

- 配置
- 窗口状态
- 查找历史
- 命令历史
- 运行态辅助信息

这些内部文件与主数据一起位于同一个固定 v5 根目录 `~/.SwitchHosts` 下的 `internal/` 子目录中，而不是分散到 Tauri 的默认 app config/data 目录。旧版 Electron/PotDb 文件则归档到同根目录下的 `v4/` 子目录。

### 6. 权限与安全模型

Tauri 版本默认采用“Rust 后端独占主数据目录 I/O”的权限路线。

规则如下：

- 用户可见主数据目录的读写默认都走 Rust commands
- 前端默认不直接对主数据根目录使用 `fs` API
- Tauri capability/permission 配置按最小权限原则拆分
- 若后续确有前端直接访问用户目录的需要，再额外引入 `fs + persisted-scope`
- `fs + persisted-scope` 属于例外策略，不作为 v5 首版默认设计

#### Content-Security-Policy

当前 Electron 版本的 renderer `index.html` 不设置 CSP，安全模型完全依赖 preload 桥接隔离。迁移到 Tauri 后，这一假设不再成立：Tauri 2 的 webview 可以直接被前端代码触发 `invoke`，一旦前端代码被注入，影响面比 Electron 更直接。

因此 v5 首版需要在 `tauri.conf.json` 中显式配置 CSP，而不是沿用 Electron 版的“无 CSP”现状：

- 默认禁止内联 `script-src`，允许 `'self'` 与 Tauri 的 `ipc:` / `asset:` 协议
- 允许 `connect-src` 中的本地 Tauri IPC 通道
- `style-src` 允许 `'self' 'unsafe-inline'`，兼容 Mantine 的运行时样式注入
- 远程请求（如远程 hosts 拉取）统一走 Rust 后端，不允许 renderer 直接发起 `fetch` 到任意外部域名
- Phase 0 即需产出一份初版 CSP 策略并通过基础页面冒烟测试

#### DevTools 在打包版本中的可用性

Electron 版的 `cmdToggleDevTools` 在打包版本中也能工作（[src/main/actions/cmd/toggleDevTools.ts](/Users/wu/studio/SwitchHosts/src/main/actions/cmd/toggleDevTools.ts)）。Tauri 2 默认在 release 构建中关闭 DevTools，需要在 `tauri.conf.json` 或 Cargo feature 中显式打开 `devtools`，才能保留与 Electron 等价的诊断能力。

规则如下：

- v5 首版继续允许 release 构建触发 DevTools，作为故障排查入口
- `devtools` 能力仅暴露给主窗口，不对查找窗口、托盘小窗开放
- 文档中应提示高级用户该入口的存在与使用方式，与 Electron 版保持一致

### 7. capability / permission 矩阵

Phase 0 必须产出一份明确的 capability / permission 矩阵，至少覆盖：

- `dialog`
- `opener`
- `process` 或等效受控执行能力
- `updater`
- `tray`
- `window-state`
- `single-instance`
- 自定义 commands

矩阵中需要明确：

- 哪些窗口可以调用哪些能力
- 哪些能力只允许主窗口使用
- 哪些能力只能通过 Rust command 间接访问
- 哪些能力完全不对前端开放

矩阵的交付物至少应包括：

- 按窗口标签拆分的 capability 设计，至少覆盖 `main`、`find`、`tray`
- 每个窗口允许访问的 plugin 能力清单
- 每个窗口允许调用的 command 清单
- 每个窗口允许订阅或发出的事件清单
- 不开放给任意窗口、仅允许 Rust 内部使用的能力清单

### 8. 自定义 command 暴露边界

仅按窗口拆分 capability 还不够，Phase 0 还必须同步明确 Tauri 自定义 command 的暴露边界。

原因是：

- capability 用于限制窗口可访问的 core/plugin 能力
- 自定义 Rust commands 若不额外收口，容易在实现上被所有窗口共同调用
- 这会削弱 `main`、`find`、`tray` 的权限隔离效果

因此 v5 需要同步产出一份基于 `AppManifest::commands` 或等效构建期白名单机制的 command 暴露方案。

规则如下：

- 默认不把注册到 Tauri 的全部 commands 暴露给全部窗口
- `main` 窗口允许调用完整的用户交互 command 集，但仍不直接拥有主数据目录的前端 `fs` scope
- `find` 与 `tray` 只允许调用完成本窗口职责所需的窄化 intent commands，而不是原始高权限 commands
- 辅助窗口默认不直接开放：
  - 系统 hosts 原始写入 command
  - 任意进程执行 command
  - 迁移与归档 command
  - updater 安装收尾 command
  - 面向任意路径的导入导出与文件定位 command
- 若后续确需新增高风险前端 command，必须单独补 capability 设计和风险评审，而不是并入默认窗口能力

### 9. 领域服务拆分

Rust 后端不应只是一层 command 集合，而应先按领域能力拆成稳定服务，再由窗口 commands、后台任务和本地 HTTP API 共同复用。

v5 首版至少拆分以下六类服务：

- `storage`
  - 负责主存储、内部状态、迁移归档和一致性校验
- `hosts_apply`
  - 负责聚合内容、系统 hosts 写入、历史记录和写入后副作用
- `refresh`
  - 负责远程获取、代理配置、`file://` 源读取和刷新元数据
- `http_api`
  - 负责本地服务监听、路由编排和第三方调用兼容
- `import_export`
  - 负责文件导入导出、URL 导入和旧备份兼容
- `updater`
  - 负责更新检查、下载、安装和发布元数据消费

约束如下：

- 窗口 commands 只编排领域服务，不直接彼此驱动
- 本地 HTTP routes 直接调用领域服务，不通过 renderer 广播完成业务状态变更
- 后台定时任务直接调用领域服务，不依赖窗口存在
- UI event 只用于通知刷新、提示和窗口联动，不作为真实业务状态切换入口

---

## Electron 到 Tauri 的能力映射

### 窗口系统

- `BrowserWindow` -> `WebviewWindow`
- 主窗口、查找窗口、托盘小窗都改为显式管理的 Tauri 窗口
- 关闭行为、隐藏行为、聚焦行为改由 Tauri window API 实现
- 主窗口的“点击关闭按钮默认隐藏而不是退出”行为必须保留（当前由 [src/main/main.ts](/Users/wu/studio/SwitchHosts/src/main/main.ts) 的 `close` 事件配合 `global.is_will_quit` 实现）：在 Tauri 中通过监听 `WindowEvent::CloseRequested` 并调用 `api.prevent_close()` + `hide()` 实现，只有显式 `quit` 动作才真正关闭窗口
- macOS 下 Dock 图标显隐由 `hide_dock_icon` 配置驱动，迁移到 Tauri 的 `app.set_activation_policy` 等效接口，只在启动时应用一次，与现状保持一致

### 桥接层

- `preload + contextBridge + ipcRenderer/ipcMain` -> `invoke + event + window API`
- Electron `window._agent` 迁移为 Tauri 客户端适配层
- 当前的 action 名称尽量保持一致，降低前端重构量
- preload 目前还额外暴露了两个小接口，迁移时需要同步映射：
  - `popupMenu()`：右键菜单入口，迁移到 Tauri menu/popup menu 实现
  - `darkModeToggle`：深浅色联动入口，迁移到 Tauri 的 `app.set_theme()` + 主题变更事件订阅

### 托盘、菜单与系统交互

- `Tray` -> Tauri tray API / plugin
- `Menu` -> Tauri menu API
- 原生 `popup/context menu` -> Tauri menu/popup menu 实现，保持列表、查找、回收站等右键菜单语义
- `dialog` -> Tauri dialog plugin
- `shell.openExternal` / `shell.showItemInFolder` -> Tauri opener/shell 能力

### 窗口状态

- `electron-window-state` -> Tauri window-state 方案
- 主窗口与小窗尺寸/位置恢复逻辑迁入 Tauri 配套实现

### 更新与发布

- `electron-updater + electron-builder` -> `Tauri updater + Tauri bundler`
- 继续沿用 GitHub Releases 作为分发基础设施
- 更新元数据从 `latest*.yml` 切换为 Tauri updater 的静态 JSON + `.sig` 签名文件
- 打包、公证、签名、更新元数据发布脚本需要整体重建

### 版本号与发布标识

- Tauri 打包版本与 updater 比较版本统一使用公开三段版本 `X.Y.Z`
- 当前四段版本中的第 4 段继续作为内部 build number 使用
- UI、关于面板、托盘等用户可见位置继续展示 `X.Y.Z (build)` 形式
- GitHub Release tag 继续使用 `vX.Y.Z`
- 更新比较与是否可升级判断只基于公开三段 semver，不以 build number 决定升级关系

### 更新元数据发布策略

v5 首版默认采用“单 GitHub Release + 单静态 JSON 元数据”的 updater 发布策略。

规则如下：

- 每个公开版本对应一个 `vX.Y.Z` GitHub Release
- 该版本所有桌面平台的 updater bundle 与 `.sig` 都挂到同一个 Release
- 静态 JSON 使用 `platforms` 映射统一描述该版本下各平台的更新包
- 只有在本版本全部目标平台的 updater bundle 与 `.sig` 都已生成、上传并完成校验后，才生成并发布该静态 JSON
- 若任一目标平台产物缺失，则该版本 Release 保持 draft，或至少不得发布新的 updater JSON

这样可以避免客户端在更新检查时拿到不完整平台表，导致部分平台无法通过更新元数据校验。

### 本地 HTTP API

- `@hono/node-server` 本地服务 -> Rust 本地 HTTP server
- 保持当前路由语义和第三方调用方式兼容
- 首版兼容面至少固定为：
  - `/`
  - `/remote-test`
  - `/api/list`
  - `/api/toggle`
- 保持当前监听地址策略：
  - `127.0.0.1`
  - `0.0.0.0`
- 保持当前响应体语义与核心状态码兼容
- HTTP route 必须直接调用 Rust 领域服务，不通过任意 renderer event 驱动实际状态变更
- 本地 HTTP API 在“无主窗口”、“主窗口隐藏”、“仅托盘运行”场景下都必须可用

#### `/api/toggle` 的语义变更

当前 Electron 实现通过向 renderer 广播 `toggle_item` 事件完成实际切换，导致“主窗口不存在或已关闭”时 `/api/toggle` 实际不会生效。

v5 迁移后：

- `/api/toggle` 由 Rust 领域服务直接处理，不再依赖 renderer 广播
- 这意味着在“仅托盘运行”“主窗口隐藏”“主窗口关闭”等场景下 `/api/toggle` **会比 Electron 版本更可用**
- 这是预期的兼容性改进，而不是行为回归
- 迁移验收时应以“路由契约与返回值兼容”为准，而不是以“与 Electron 版运行时行为逐字节等价”为准

### 系统 hosts 写入

- `child_process + sudo` 写系统文件 -> Rust command 主导
- 权限提升流程、换行转换、写入校验、失败提示全部迁入 Rust 后端

### 应用后执行命令与提权

`cmd_after_hosts_apply` 在 v5 中仍然保留行为兼容，但执行能力收口到 Rust 内部服务，不作为任意窗口可直接调用的 command。

规则如下：

- 只有在系统 hosts 写入成功后，`hosts_apply` 服务才会触发写入后命令
- 前端只允许修改相关配置和查看执行结果，不允许直接请求“执行任意命令”
- 若实现层需要借助 Tauri shell plugin，也仅允许 Rust 内部以受控模板或受校验参数的方式调用
- Phase 0 必须明确 macOS、Linux、Windows 的提权 UX、取消路径和统一错误返回结构
- 提权失败、用户取消、执行失败都要有稳定错误码，供主窗口、托盘和 HTTP API 复用

---

## 配置驱动行为兼容

除大功能迁移外，v5 还必须保留当前一批“由配置决定行为”的逻辑。

至少包括以下配置项：

- `choice_mode`
  - 控制顶层列表的单选/多选行为
  - 注意：`folder_mode` 不是全局配置，而是每个 `folder` 节点各自持有的字段，详见存储方案中的 `folder.mode`
- `multi_chose_folder_switch_all`
  - 控制多选文件夹开关是否联动子节点
- `write_mode`
  - 控制系统 hosts 写入时采用 `append` 还是 `overwrite`
- `remove_duplicate_records`
  - 控制最终写入内容是否做去重归一化
- `cmd_after_hosts_apply`
  - 控制应用 hosts 后是否执行用户命令，以及相关结果如何保留
- `use_proxy` / `proxy_protocol` / `proxy_host` / `proxy_port`
  - 控制远程拉取与测试请求是否通过代理发出
- `tray_mini_window`
  - 控制托盘点击时打开小窗还是激活主窗口
- `hide_at_launch`
  - 控制应用启动时是否默认隐藏主窗口
- `use_system_window_frame`
  - 控制主窗口是否使用系统窗口边框
- `theme`
  - 控制前端主题与原生深浅色联动
- `locale`
  - 控制多语言与原生菜单语言
- `left_panel_show` / `left_panel_width`
  - 控制主界面左侧面板展示状态和宽度
- `http_api_on` / `http_api_only_local`
  - 控制本地 HTTP API 是否启用以及监听地址
- `history_limit`
  - 控制系统 hosts 历史记录保留数量
- `auto_download_update`
  - 兼容当前遗留语义，在 v5 中继续控制后台更新检查是否执行，而不表示自动下载安装
- `hide_dock_icon`
  - 控制 macOS Dock 图标显隐
- `show_title_on_tray`
  - 控制托盘标题是否展示当前状态
- `send_usage_data`
  - 控制使用数据上报开关及其保留行为
  - 注意：当前 Electron 版 [src/main/libs/tracer.ts](/Users/wu/studio/SwitchHosts/src/main/libs/tracer.ts) 的实际上报逻辑已被注释为 no-op，配置值存在但不会真正发送数据；v5 迁移时保留配置项与默认值不变，Rust 侧也以 no-op 实现，直到未来需要重新启用上报

迁移实施时应单独整理一份“配置兼容矩阵”，明确每个配置项在 Tauri 版中的：

- 存储位置
- 默认值
- 生效时机
- 是否需要重启
- 与现有 Electron 版是否完全行为对等

---

## 分阶段迁移步骤

## Phase 0：迁移准备与基线搭建

### 目标

搭建 Tauri 工程骨架，并建立迁移清单与适配边界。

### 任务

- 新增 `src-tauri` 基础结构
- 接入 Tauri 2 开发与构建链路
- 配置 `tauri.conf.json.build.devUrl` 指向现有 Vite 开发服务器 `http://127.0.0.1:8220`，`frontendDist` 指向 renderer 的构建产出目录；验证 `vite.render.config.mts` 中的 `base` 在 Tauri 协议下工作正常
- 保留现有 renderer 构建方式，验证 React + Vite 可嵌入 Tauri
- 明确窗口状态持久化位置：v5 首版**不使用** `tauri-plugin-window-state`，改由 Rust command 将窗口状态写入 `<v5-root>/internal/state.json`，与文件夹折叠状态等其他内部状态统一；若后续选择使用社区插件，则需要显式记录“窗口状态存 Tauri app config、其他内部状态存 `<v5-root>/internal/`”的分裂原因
- 明确版本号注入策略：`tauri.conf.json.version` 使用公开三段 semver `X.Y.Z`，四段版本号中的 build number 通过环境变量（如 `SWH_BUILD_NUMBER`）在构建期注入，Rust 启动时读取并合成 `X.Y.Z (build)` 展示字符串；updater 的 `version` 字段也用三段版本，build number 不参与升级比较
- 梳理 Electron action 列表与事件列表
- 产出 capability / permission 矩阵
- 明确 `AppManifest::commands` 或等效机制下的自定义 command 暴露边界
- 明确 `cmd_after_hosts_apply` 的 Rust 内部执行模型与结果记录方式
- 选定跨平台提权方案并记录为 ADR：
  - macOS：默认采用 `osascript -e 'do shell script ... with administrator privileges'`，`SMJobBless` 仅作为后续可选项备案（涉及 helper tool 的签名与维护成本）
  - Linux：默认采用 `pkexec`，并准备好 `sudo -A` + `SUDO_ASKPASS` 的回退路径
  - Windows：通过 UAC 提权重新拉起 helper 进程，或使用 `runas` verb
  - 统一输出取消、失败、成功的错误码结构，供主窗口、托盘、HTTP API 共用
- 明确系统 hosts 写入的提权 UX、取消路径和统一错误码结构
- 明确本地 HTTP API 直接调用 Rust 领域服务的实现边界，不依赖 renderer 广播
- 明确 `/api/toggle` 从“广播驱动”迁移为“Rust 领域服务直接驱动”，并记录其在“仅托盘运行/主窗口隐藏”场景下是**预期**的兼容性改进
- 明确 updater 采用“单 Release + 单静态 JSON”发布策略及元数据生成时机
- 明确文件夹展开状态写入 `internal/state.json`，不进入 `manifest.json`
- 明确前端适配层接口
- 确认与存储方案文档的依赖关系

### 出口条件

- Tauri 工程可启动空壳应用
- renderer 可在 Tauri 中加载
- action/event 迁移清单完整可用
- command、领域服务、HTTP API、提权和 updater 元数据边界无关键未决决策

---

## Phase 1A：前端适配层与主窗口启动

### 目标

先在不切换主数据真源的前提下，让 Tauri 主窗口跑通，并建立新的前后端通信骨架。

### 任务

- 建立前端 Tauri 适配层，替代现有 Electron `window._agent`
- 迁移基础窗口生命周期控制
- 迁移主窗口启动、显示、隐藏、聚焦
- 接通基础 command / event 通道
- 在 Rust 侧提供临时的 in-memory / fixture command 实现，用于承接列表读取、内容读取和保存动作
- Phase 1A 的数据闭环以“真实 Tauri 通道 + 非持久化 Rust stub”为准，而不是前端 mock
- 跑通主窗口启动、基础数据加载和最小编辑闭环

### 出口条件

- 主窗口在 Tauri 中可正常加载
- 不依赖 Electron preload/IPC 即可完成主窗口基本流程
- 前端所有核心调用都已通过 Tauri command / event 到达 Rust 侧，即使此时后端仍是非持久化 stub
- 前端适配层接口可承接后续迁移

---

## Phase 1B：新主存储接入与旧数据迁移

### 目标

在 Tauri 主窗口已经跑通的基础上，切换到 v5 主存储，并完成旧 PotDb 数据迁移。

### 任务

- 接入 v5 主存储格式
- 接入旧 PotDb 数据迁移入口
- 明确 PotDb 迁移读取契约：PotDb 在磁盘上为明文 JSON 文件，按 `dict/list/collection` 子目录组织，Rust 迁移器直接以只读方式解析这些 JSON 文件，**不引入 Node sidecar、也不链接 `@oldj/pot-db`**；迁移器对 PotDb 目录仅读不写，不回写任何内容到旧目录
- 首次启动时检查旧目录布局，在固定根目录 `~/.SwitchHosts` 写入新格式，并在成功后将旧布局归档到 `~/.SwitchHosts/v4/migration-<timestamp>/`
- 明确“首次启动自动迁移”和“手动导入旧备份”是两条独立链路，分别实现与验收
- 明确拒绝直接读取 v3 `data.json` 等非 PotDb 旧结构，并为用户提供升级指引
- 明确旧 Electron `userData/swh_local` 中的 `localdb` 只作为迁移输入，不再作为 v5 运行时依赖
- 若旧版本使用了自定义 `data_dir`，则只在首次迁移时将其作为 legacy 数据来源；迁移完成后统一回到 `~/.SwitchHosts`
- 旧布局归档按“语义上移动”处理：同盘优先 rename，跨盘则 copy -> verify -> delete
- 手动导入继续兼容现有 v3 / v4 JSON 备份格式，不受首次启动自动迁移兼容范围限制
- 将树展开状态等每机 UI 状态迁入 `<v5-root>/internal/state.json`，不写入 `manifest.json`
- 迁移以下核心能力到 Rust command：
  - 数据读取
  - 内容读取与保存
  - 导入导出
  - 打开外链
  - 在文件管理器中显示文件
- 跑通固定主数据目录下的新格式读写、旧数据导入与迁移

### 出口条件

- 列表与内容可正常读写
- 导入导出可用
- 旧 PotDb 数据可稳定迁移到新格式
- 首次启动自动迁移与手动导入链路都已单独验证通过
- 首次启动迁移后的运行根目录固定为 `~/.SwitchHosts`
- 旧 Electron/PotDb 文件和旧 `localdb` 快照已归档到 `~/.SwitchHosts/v4/migration-<timestamp>/`
- 主数据目录不需要前端直接访问

---

## Phase 2：桌面能力与本地服务迁移

### 目标

迁移高耦合桌面能力，并完成首个可交付版本所需的系统功能。

### 任务

- 迁移系统 hosts 写入
- 迁移远程 hosts 刷新
- 迁移远程请求代理
- 迁移 `file://` 远程源
- 保持当前远程刷新语义：
  - `refresh_interval <= 0` 时不自动刷新
  - 只有 `http://` / `https://` 远程源参与后台定时刷新
  - `file://` 远程源只支持手动刷新
- 迁移“应用后执行命令”
- 迁移查找窗口
- 迁移托盘小窗
- 迁移系统托盘
- 迁移顶部菜单
- 迁移原生 popup/context menu
- 迁移单实例逻辑
- 迁移窗口状态恢复
- 迁移 Dock 图标隐藏
- 迁移托盘标题更新
- 迁移系统语言检测
- 用 Rust 重建本地 HTTP API
- 确保 HTTP routes 直接调用领域服务，而不是通过 UI event 完成状态切换
- 确保本地 HTTP API 在无主窗口、主窗口隐藏和仅托盘运行场景下保持可用
- 保持 Alfred/第三方调用兼容

### 出口条件

- 查找窗口、托盘、小窗、菜单全部可用
- 系统 hosts 写入流程可用
- 本地 HTTP API 可在 Tauri 中稳定运行
- 首个对外可用版本所需功能完整

---

## Phase 3：更新与发布链重建

### 目标

完成 Tauri 版本的更新、打包、签名、公证与多平台发布能力。

### 任务

- 接入 Tauri updater
- 明确沿用 GitHub Releases 的更新分发模型
- 生成 Tauri updater 需要的静态 JSON + `.sig` 签名文件
- 采用“全部目标平台产物齐备后再发布元数据”的生成策略
- 重建打包脚本
- 重建签名与公证流程
- 补齐 macOS / Windows / Linux 平台差异
- Linux 发行包需显式声明 `libayatana-appindicator3-1`（或 `libappindicator3-1` 的回退）依赖，以保证 Tauri 托盘在主流发行版可用
- macOS 继续使用现有 [scripts/entitlements.mac.plist](/Users/wu/studio/SwitchHosts/scripts/entitlements.mac.plist) 中的 JIT 相关 entitlement，仅在 Tauri 构建流程下重新对应字段路径；暂不新增网络访问或 disable-library-validation 等额外权限
- 迁移现有自动更新 UI 与状态机

### 出口条件

- 打包产物可生成
- 更新检查、下载、安装可用
- 不完整平台产物不会触发新的 updater 元数据发布
- 三平台发布链可跑通

---

## Cutover：功能对等验收与 Beta 准备

### 目标

在 Tauri 版本达到功能对等后，进入 Beta 验收与切换准备。

### 任务

- 按功能对等清单逐项验收
- 验证旧数据迁移可靠性
- 验证已迁移存储格式的稳定性
- 验证第三方 HTTP API 调用兼容性
- 整理 Beta 已知问题与限制

### 出口条件

- 功能对等清单通过
- 迁移链路通过
- 可发布 Beta 版本

---

## 风险与缓解

### 1. 高权限 hosts 写入的跨平台差异

风险：

- macOS、Linux、Windows 的权限提升方式不同
- 当前 Electron 方案使用 `child_process + sudo`，迁移后不能简单照搬

缓解：

- 将系统写入逻辑统一收口到 Rust 后端
- 首先定义跨平台写入接口，再分别实现平台适配
- 单独做权限失败、取消、写入冲突回归测试

### 2. 多窗口与托盘行为差异

风险：

- 三平台对窗口定位、托盘弹窗、焦点行为支持差异明显

缓解：

- 主窗口、查找窗口、托盘小窗分别定义目标行为
- 先按最小稳定行为落地，再补平台细节优化
- 将平台差异写入验收清单

### 3. 本地 HTTP API 迁移风险

风险：

- 现有服务基于 Node/Hono，迁到 Rust 后可能出现行为细节不一致
- 若仍沿用“HTTP route -> UI 广播 -> renderer 执行业务”的旧链路，服务可用性会继续依赖窗口状态

缓解：

- 固定端口、路由、状态码、核心响应结构
- 直接让 HTTP route 调用 Rust 领域服务，而不是通过 renderer 广播驱动真实状态
- 将“无主窗口 / 主窗口隐藏 / 仅托盘运行”写入 API 验收清单
- 增补 API 层回归测试

### 4. 更新与发布链重建风险

风险：

- 自动更新、签名、公证与构建脚本均需整体替换
- 这是迁移中最容易影响发布时间的部分
- 若更新元数据在部分平台产物未齐时提前发布，客户端会拿到不完整平台表

缓解：

- 将其后移到单独阶段
- 先保证本地开发与手工打包可用
- 将静态 JSON 的生成放到所有目标平台 bundle 与 `.sig` 校验完成之后
- 再逐步接入自动更新与正式发布流程

### 5. Tauri 权限模型配置不足

风险：

- 若 capability / permission 设计过晚，后续会反复重构 command 和前端调用边界

缓解：

- 在 Phase 0 完成 capability / permission 矩阵
- 默认让 Rust 后端独占主数据目录 I/O
- 把前端直连 `fs` 视为例外而不是默认

### 6. 旧 PotDb 数据迁移风险

风险：

- 旧数据可能缺字段、损坏或包含边缘状态

缓解：

- 迁移流程采用临时目录 + 校验 + 原子切换
- 迁移前不破坏旧目录布局
- 迁移成功后固定以 `~/.SwitchHosts` 作为运行根目录，并将旧布局归档到 `~/.SwitchHosts/v4/migration-<timestamp>/`
- 失败时允许回退和重试

---

## 测试与验收

### 迁移验收顺序

迁移实施与验收按以下顺序推进：

1. 先通过数据迁移与主存储读写
2. 再通过系统 hosts 写入与高权限流程
3. 再通过本地 HTTP API 兼容性
4. 最后进入 updater 与发布链验收

### 1. 数据迁移与导入测试

#### 首次启动自动迁移

- 旧默认目录迁移
- 旧自定义 `data_dir` 迁移
- 迁移后旧布局是否正确归档到 `~/.SwitchHosts/v4/migration-<timestamp>/`
- 旧 `localdb` 快照与来源路径元数据是否正确归档
- 同盘归档是否优先走 rename
- 跨盘归档是否正确执行 copy -> verify -> delete
- 明确验证“v3 用户需先升级到最新 Electron，再升级到 v5”的阻断提示
- 坏 JSON / 缺字段 / 半损坏数据迁移
- 重复启动时迁移幂等
- 手工编辑后的循环引用校验
- 悬空引用校验
- 缺失 `entries/*.hosts` 校验
- 非法 `contentFile` 路径校验

#### 手动导入

- 本地文件导入 v3 JSON 备份
- 本地文件导入 v4 JSON 备份
- URL 导入 v3 JSON 备份
- URL 导入 v4 JSON 备份
- 非法 JSON、缺字段、过新版本提示
- 手动导入链路不受“首次启动只兼容 PotDb”限制

### 2. 功能对等测试

- 列表切换
- 内容编辑
- 查找替换
- 回收站
- 远程刷新
- 远程请求代理
- `file://` 远程源
- `choice_mode` / `folder_mode`
- `multi_chose_folder_switch_all`
- 导入导出
- 应用后执行命令
- `write_mode`
- `remove_duplicate_records`
- `cmd_after_hosts_apply`
- `use_proxy` / `proxy_protocol` / `proxy_host` / `proxy_port`
- `tray_mini_window`
- `hide_at_launch`
- `use_system_window_frame`
- `theme`
- `locale`
- `left_panel_show` / `left_panel_width`
- `history_limit`
- `auto_download_update`
- `show_title_on_tray`
- `send_usage_data`
- 托盘、菜单、小窗
- Dock 图标隐藏
- 托盘标题更新
- 系统语言检测

### 3. 系统集成测试

- 系统 hosts 写入
- 无权限、用户取消提权、提权成功、写入失败的统一错误结构
- `append` / `overwrite`、换行保持、历史记录保留与裁剪
- 写入成功后触发 `cmd_after_hosts_apply` 与命令历史记录
- 外部打开链接
- 在文件管理器中显示文件
- 单实例
- 窗口状态恢复
- 列表、查找、回收站等原生 popup/context menu 的打开、点击与关闭事件语义
- 本地 HTTP API
- 本地 HTTP API 的现有测试语义复用
- 无主窗口、主窗口隐藏、仅托盘运行时的本地 HTTP API 可用性

### 4. 发布链测试

- 打包
- 更新检查
- 更新下载
- 更新安装
- 签名与公证
- GitHub Releases + 静态 JSON + `.sig` 流程衔接
- 所有目标平台产物齐备后才发布 updater 静态 JSON
- 任一目标平台产物缺失时不会发布新的 updater 元数据
- 三段 semver 与内部 build number 的展示和比较行为一致

---

## 回滚策略

v5 不以“Electron 与 Tauri 并行运行”为目标。

回滚原则：

- 首次启动迁移前，旧 PotDb 与旧配置布局保持不动
- 只有在 `~/.SwitchHosts` 的新格式文件通过校验后，才归档旧布局到 `~/.SwitchHosts/v4/migration-<timestamp>/`
- 若迁移失败，则继续保留旧布局并提示用户处理，不进入半迁移状态
- 迁移成功后，v5 只以 `~/.SwitchHosts` 为运行根目录，`v4/` 仅保留旧版归档，不再要求与旧 Electron 版本并行兼容

---

## 参考实现入口

迁移实施时优先参考以下现有入口：

- [src/main/main.ts](/Users/wu/studio/SwitchHosts/src/main/main.ts:1)
- [src/main/preload.ts](/Users/wu/studio/SwitchHosts/src/main/preload.ts:1)
- [src/main/actions/index.ts](/Users/wu/studio/SwitchHosts/src/main/actions/index.ts:1)

同时以前置方案文档为准：

- [switchhosts-v5-storage-plan.md](/Users/wu/studio/SwitchHosts/v5plan/switchhosts-v5-storage-plan.md)

---

## 推荐结论

SwitchHosts v5 的 Tauri 迁移应采用：

- 分阶段迁移
- Rust 主导
- 前端尽量保持稳定
- 不引入 Node sidecar
- 首个可交付版本保留本地 HTTP API

这样可以在控制迁移风险的同时，逐步完成从 Electron 到 Tauri 2 的架构切换，并与新的明文主存储方案形成统一的 v5 技术基础。
