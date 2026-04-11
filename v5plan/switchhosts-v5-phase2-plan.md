# SwitchHosts v5 Phase 2 详细执行计划

## 背景

Phase 0 与 Phase 1 已经完成（骨架、前端适配层、存储层、PotDb 迁移、手动导入导出、v5 manifest 格式）。Phase 2 是 Tauri 迁移中**工作量最大、风险最集中**的一段：要把 Electron 主进程承担的桌面壳能力（系统 hosts 写入、远程刷新、托盘、菜单、查找窗口、本地 HTTP API、单实例……）全部用 Rust 重建出来。

本文件把 Phase 2 拆成 9 个有序子步骤（P2.A – P2.I），每一步都自带 scope、任务清单、出口条件、风险与决策点。Phase 2 全部完成后即可进入 Phase 3（更新与发布链）。

参考文档：

- [switchhosts-v5-tauri-migration-plan.md](/Users/wu/studio/SwitchHosts/v5plan/switchhosts-v5-tauri-migration-plan.md)
- [switchhosts-v5-storage-plan.md](/Users/wu/studio/SwitchHosts/v5plan/switchhosts-v5-storage-plan.md)
- [switchhosts-v5-capabilities-and-commands.md](/Users/wu/studio/SwitchHosts/v5plan/switchhosts-v5-capabilities-and-commands.md)
- [switchhosts-v5-privilege-elevation-adr.md](/Users/wu/studio/SwitchHosts/v5plan/switchhosts-v5-privilege-elevation-adr.md)
- [switchhosts-v5-implementation-notes.md](/Users/wu/studio/SwitchHosts/v5plan/switchhosts-v5-implementation-notes.md)

---

## 推荐执行顺序

```
P2.A  →  P2.E  →  P2.F  →  P2.B  →  P2.C  →  P2.D  →  P2.G  →  P2.H  →  P2.I
```

理由：

- **P2.A 是基座**：单实例锁、关闭 = 隐藏、窗口位置持久化、Dock 控制。后面所有窗口相关步骤都依赖它。
- **P2.E（hosts 写入）排第二**：这是迁移里风险最高、用户感知最强的能力。早做意味着早暴露三平台提权 / 错误模型 / 写入校验的问题，后面的子步骤都依赖它能跑通。
- **P2.F 紧跟 P2.E**：因为远程刷新写入的就是 `entries/<id>.hosts`，跟 apply 服务消费的是同一个文件。
- **P2.B/C/D 是 UI 增量**：托盘 / 菜单 / 查找窗口，独立性高，按用户感知顺序排。
- **P2.G（HTTP API）依赖 P2.E**：`/api/toggle` 直接调用 `hosts_apply` 服务（不再走 renderer 广播）。
- **P2.H 是杂项**：locale 检测、open_url、show_item_in_folder、深浅色，可以穿插。
- **P2.I 是债务清理**：留到最后，避免影响主线。

每个子步骤完成后建议跑一次 `npm run tauri:dev` 冒烟，再决定是否进下一步。

---

## 公共原则

整个 Phase 2 沿用以下约束：

1. **Rust 独占主数据 I/O**：所有 `~/.SwitchHosts/` 下的读写都经由 `storage` 服务，不开 `tauri-plugin-fs`。
2. **领域服务先于 command**：每个新能力先抽成 Rust 模块（`hosts_apply`、`refresh`、`http_api`、`tray_service`……），command 只做编排。窗口 commands、HTTP 路由、后台任务都直接调用领域服务，**不通过 renderer event 驱动业务状态变更**。
3. **renderer 接口冻结**：不重写前端组件。所有改动通过 `src/renderer/core/agent.ts` 的适配层、Rust commands 和事件桥落地。
4. **每个子步骤一个 commit**（必要时拆 2–3 个）。出口条件不达成不进下一步。
5. **不引入 Node sidecar**。
6. **每次 cargo check 必须零警告**（`#[allow(dead_code)]` 仅允许在"下一步立即使用"的字段上，且必须有注释说明）。

---

## P2.A — 窗口生命周期基座

### 目标

让主窗口表现得像一个真实的桌面应用：单实例锁、关闭按钮 = 隐藏、窗口位置持久化、macOS Dock 图标受配置控制。后续所有 UI 子步骤都建立在这之上。

### 任务

1. 添加 `tauri-plugin-single-instance` 依赖并在 Builder 注册；第二个实例触发后 focus 已有的 main 窗口。
2. 为 main 窗口安装 `WindowEvent::CloseRequested` 监听器：
   - 默认走 `api.prevent_close()` + `window.hide()` 路径
   - 仅当 `AppState` 上的 `is_will_quit: AtomicBool` 为 true 时才允许真正关闭
3. 实现真实的 `quit_app` 命令：设置 `is_will_quit = true`，然后 `app.exit(0)`。
4. 实现 `hide_main_window` 与 `focus_main_window`（替换 Phase 1A stub）。
5. 窗口几何信息持久化：
   - 在 `StateFile` 上扩展 `window: { main: { x, y, width, height, maximized } }` 字段（serde flatten 已经允许扩展，零迁移成本）
   - 监听 `WindowEvent::Moved` / `Resized` / `CloseRequested`，写回 `internal/state.json`
   - 启动时若 state.json 中有有效几何，把 main 窗口恢复到对应位置/大小；同时校验在屏幕范围内
6. macOS Dock 图标控制：启动时根据 `hide_dock_icon` 调用 `app.set_activation_policy(Accessory or Regular)`。仅启动时读取一次（与 Electron 版一致）。
7. **不**做：托盘、查找窗口、菜单。

### 出口条件

- [ ] 启动两次 → 第二次关闭，第一次焦点回到前台（单实例）
- [ ] 点关闭按钮 → 窗口隐藏；从托盘/Dock 重新激活后回到前台（macOS）
- [ ] 在窗口被隐藏的状态下，菜单项 / 托盘项的"退出"能彻底退出
- [ ] 移动/缩放主窗口 → 重启后位置/大小恢复
- [ ] `hide_dock_icon = true` 在 macOS 下隐藏 Dock 图标
- [ ] `cargo check` 干净

### 风险

- macOS 下 `set_activation_policy` 在某些 Tauri 版本上需要主线程调用 — 用 `app.run_on_main_thread`。
- 多屏环境下的窗口几何越界检测要谨慎；不能恢复到屏幕外的位置。
- 单实例插件需要在 `Builder::default()` 链路里**最早**注册（否则可能漏掉传入参数）。

---

## P2.E — 系统 hosts 写入与 apply 流水线

### 目标

把"选中节点 → 应用到系统"这条核心链路打通。包含内容聚合、提权写入、写入校验、历史记录、`cmd_after_hosts_apply` 触发。

### 任务

1. **内容聚合（`hosts_apply::aggregate`）**：
   - 入参：选中节点 id 列表
   - 解析 `group.include` 引用，按顺序拼接每个 `local`/`remote` 节点的 `entries/<id>.hosts` 内容
   - 应用 `remove_duplicate_records`（相同 host → IP 映射只保留第一次出现的）
   - 加 `# --- SWITCHHOSTS_CONTENT_START ---` / END 包围标记
   - 平台换行符转换：UTF-8 LF → 目标平台原生换行（macOS/Linux LF，Windows CRLF）
2. **`write_mode` 处理**：
   - `overwrite`：用聚合内容完全替换 `/etc/hosts`
   - `append`：保留 `/etc/hosts` 中 SwitchHosts 标记之外的部分，把聚合内容塞进标记之间
3. **真实的 `get_content_of_list` 命令**（替换 Phase 1B stub）：调用 `aggregate` 返回字符串，让 renderer 预览。
4. **跨平台提权模块**（按 [privilege-elevation-adr.md](/Users/wu/studio/SwitchHosts/v5plan/switchhosts-v5-privilege-elevation-adr.md)）：
   - `src-tauri/src/hosts_apply/elevate/macos.rs` — `osascript` + `do shell script ... with administrator privileges`
   - `src-tauri/src/hosts_apply/elevate/linux.rs` — `pkexec`，缺失则返回 `PolkitMissing`
   - `src-tauri/src/hosts_apply/elevate/windows.rs` — UAC self-relaunch helper（同一可执行文件 + `--apply-hosts` 子命令 + nonce 校验）
   - 每个平台模块导出 `fn write_with_elevation(tmp_path, system_path) -> Result<(), HostsApplyError>`
5. **统一错误枚举 `HostsApplyError`**（在 `hosts_apply/error.rs`）：`UserCanceled` / `PermissionDenied` / `WriteFailed` / `VerificationFailed` / `PolkitMissing` / `PlatformUnsupported` / `Internal`，serde 序列化用 `tag = "kind"` 让前端 switch。
6. **写入流程**：
   - 写到当前用户的 `$TMPDIR/switchhosts-apply-<uuid>.tmp`，权限 0600
   - 调平台 elevate 函数把 tmp 移动 / 复制到系统 hosts 路径
   - 立即读回字节，与 tmp 内容比对；不一致 → `VerificationFailed`，保留 tmp 供排查
7. **历史记录**：
   - 写入成功后，把 `{id, content, add_time_ms, label}` 追加到 `internal/histories/system-hosts.json`
   - 按 `history_limit` 配置裁剪
   - `get_apply_history` / `delete_apply_history_item` 实现真实 body
8. **`cmd_after_hosts_apply` runner**：
   - **以当前用户身份**执行（不继承 elevate 上下文）
   - 命令字符串走简单 `sh -c` / `cmd /c`，参数只接受占位符替换（如 `{path}`），**不允许任意 shell 插值**
   - 捕获 stdout/stderr/退出码，写入 `internal/histories/cmd-after-apply.json`
   - `cmd_get_history_list` / `cmd_delete_history_item` / `cmd_clear_history` 实现真实 body
9. **`apply_hosts_selection` 命令**（替换 Phase 1A stub）：
   - 入参：节点 id 数组 + 选项
   - 走聚合 → 提权写入 → 校验 → 历史 → `cmd_after_apply` → 返回结果
   - 结果是 `Result<{success: bool, applied_at_ms}, HostsApplyError>`
10. **`toggle_hosts_item` 命令**：单节点开关，内部修改 `manifest.root` 中节点的 `on` 字段，然后调 apply 流水线（如果当前 `choice_mode` 允许多选）

### 出口条件

- [ ] 用户在 UI 选中 hosts → 点 Apply → 弹原生提权框 → 同意 → `/etc/hosts` 真的更新
- [ ] 写入完成后内容立即可被 `cat /etc/hosts` 看到，且与 SwitchHosts 内编辑的内容一致
- [ ] 取消提权 → UI 显示 `user_canceled` 提示，状态回退
- [ ] `cmd_after_hosts_apply` 设置为 `echo done` → 写入成功后能在历史里看到 stdout
- [ ] 历史记录裁剪到 `history_limit`
- [ ] `write_mode = overwrite` 与 `append` 各自表现正确
- [ ] `remove_duplicate_records = true` 时去重生效
- [ ] 三平台至少 macOS 验收通过（Linux/Windows 验收推迟到 Beta，但代码必须存在且能编译）

### 风险

**Phase 2 全程最高风险点**。具体：

- macOS：osascript 的 `do shell script` 参数转义如果做错，会变成命令注入。所有路径必须走 `shell-escape` crate（要新增依赖）。
- Linux：`pkexec` 在没有 polkit agent 的最小化 shell 环境下会卡住或失败 — 先检测 `which pkexec`。
- Windows：self-relaunch helper 模式涉及 nonce 通信、命名管道或临时文件交换，单元测试困难。先用临时文件简化。
- 写入校验失败时是否要回滚？v5 首版**不回滚**，只报错并保留 tmp 文件，因为没有可信的"上一份内容"快照（系统 hosts 可能被其他工具改过）。
- `cmd_after_hosts_apply` 如果用户写了 `rm -rf /` 我们也照做 — 这是用户配置，不在我们的安全边界内，但绝不能让它继承 root。

### 决策点

- **是否提供"始终使用同一次提权"的 keep-alive 选项**？v5 首版**不提供**。每次写入都弹原生框。如果用户抱怨，再考虑 macOS SMJobBless / polkit policy install。
- **Linux 的 SUDO_ASKPASS 兜底**？v5 首版**不做**。明确返回 `PolkitMissing` + 文档指引。
- **`write_mode = null` 的语义**？等价于 `append`，与 Electron 一致。

---

## P2.F — 远程 hosts 刷新

### 目标

支持 `remote` 节点的内容拉取：`http(s)://`、`file://`、代理、手动刷新、后台定时刷新。

### 任务

1. **`refresh` 服务模块**（`src-tauri/src/refresh/`）：
   - `fetch(url, proxy_config) -> Result<String, RefreshError>` 支持 `http://` `https://` `file://`
   - http(s) 走 `reqwest`（已经在 Phase 1B 加了），代理配置从 `AppConfig` 读取
   - file:// 走 `std::fs::read_to_string`（先做 URL → 路径解析，注意 Windows file://C:/...）
2. **写入 `entries/<id>.hosts`** 并更新节点的 `last_refresh` / `last_refresh_ms`：
   - 通过 `manifest.save()` 写回（renderer-shape 字段名 last_refresh*；on-disk 自动转 source.lastRefresh*）
3. **真实的 `refresh_remote_hosts` / `refresh_all_remote_hosts` 命令**：替换 Phase 1A stub
4. **后台定时调度器**：
   - 在 `lib.rs` 启动时 `tokio::spawn` 一个后台 task
   - 每 60 秒扫描 `manifest.root`，挑选满足以下条件的 remote 节点：
     - `refresh_interval > 0`
     - URL 是 `http://` 或 `https://`（**不**给 `file://` 跑后台刷新，仅手动）
     - `now - last_refresh_ms >= refresh_interval * 1000`
   - 对每个匹配节点调 `fetch` + 写回
   - 任务生命周期跟随 `app.run()`，**不依赖任何窗口存在**
5. **代理支持也复用到 `import_data_from_url`**：把 reqwest client 的构建抽成 helper，让 import 和 refresh 共用
6. **`get_basic_data` 返回的 list 里 last_refresh* 字段刷新后能被 renderer 看到**

### 出口条件

- [ ] 添加一个 `https://example.com/hosts` 的 remote 节点 → 点手动刷新 → `entries/<id>.hosts` 更新且节点的 `last_refresh` 时间戳变化
- [ ] 配置代理（`use_proxy=true`）→ 远程拉取走代理
- [ ] `file:///some/local/file.txt` 节点 → 手动刷新读到文件内容
- [ ] 设置 `refresh_interval=60`，等 1 分钟 → 后台自动刷新
- [ ] 在主窗口隐藏的状态下，后台刷新仍然工作
- [ ] `import_data_from_url` 现在也能走代理

### 风险

- reqwest 的代理配置在 SOCKS 环境下需要 `socks` feature；首版只支持 http/https proxy。
- file:// URL 的 Windows 路径解析有坑（`file:///C:/path/file` vs `file://localhost/C:/path/file`）— 用 `url::Url` crate 解析，不要手撕。
- 后台 task 需要访问 `AppState`，但 `AppState` 是 `tauri::State<'_, AppState>`，拿到 `AppHandle` 后用 `app.state::<AppState>()`。

---

## P2.B — 系统托盘 + 托盘小窗

### 目标

托盘图标 + 托盘菜单 + 点击行为 + 托盘小窗（`tray_mini_window` 配置控制）。

### 任务

1. **托盘图标**（`tauri::tray::TrayIconBuilder`）：
   - 用现有的 `assets/logoTemplate*.png`（macOS template image）
   - 在 `AppState::bootstrap` 之后、Builder `.setup` 阶段创建
2. **托盘菜单**（右键托盘）：
   - Show / Hide / Apply / Quit 等基本项
   - locale-aware 标签（用现有的 i18n 资源）
3. **托盘点击行为**：
   - 读 `tray_mini_window` 配置
   - true → 创建/显示托盘小窗（`#/tray` 路由）
   - false → 显示主窗口
4. **托盘小窗**：
   - 单独的 `WebviewWindow`，label = `tray`，size 300x600，无边框，blur-to-hide
   - URL 指向 dev server `http://127.0.0.1:8220/#/tray` 或 prod 的 frontendDist
5. **`update_tray_title` 命令**：根据当前激活的 hosts 列表生成短文本，更新托盘标题（macOS 特性）
6. **`show_title_on_tray` 配置**：true 时显示标题，false 时只显示图标

### 出口条件

- [ ] 系统托盘出现 SwitchHosts 图标
- [ ] 右键 → 弹出菜单
- [ ] 左键 → 根据配置打开主窗口或 mini 窗
- [ ] mini 窗显示 hosts 列表，可点击切换
- [ ] mini 窗 blur 自动隐藏
- [ ] `show_title_on_tray = true` 时托盘旁边显示当前激活的 hosts 名称
- [ ] Apply 完成后托盘标题立即更新

### 风险

- macOS 与 Linux 的托盘 API 在 Tauri 2 下成熟度不同；Linux 需要 `libayatana-appindicator3-1` 系统包（已在 Phase 0b 文档记录）。
- mini 窗的 blur-to-hide 在 GTK 下有时不触发；预留一个手动关闭的按钮兜底。

---

## P2.C — 顶部菜单（原生菜单栏）

### 目标

macOS 上的原生菜单栏 + Windows / Linux 的窗口菜单。

### 任务

1. **菜单结构**（用 `tauri::menu::MenuBuilder`）：
   - App 菜单（仅 macOS）：About、Preferences、Hide、Quit
   - File：Import、Export、Import from URL
   - Edit：Cut、Copy、Paste、Find（→ 触发 find_show command）
   - View：切换主题、切换面板
   - Window：Minimize、Zoom（macOS 标准）
   - Help：Homepage、Check for Updates
2. **locale-aware 标签**：构建菜单时读 `AppConfig.locale`
3. **菜单事件路由**：复用 Phase 1B step 2.5 装的 `on_menu_event` handler，用菜单项 id 前缀区分（`menu_app_*` vs `popup_menu_item_*`）
4. **菜单状态更新**：locale 切换、主题切换时重建菜单
5. **不**实现：动态菜单项（recently opened files 等）

### 出口条件

- [ ] macOS 顶部菜单栏显示完整菜单
- [ ] 所有项点击都有响应（最起码弹出对应窗口或调命令）
- [ ] 切换 locale 后菜单语言变化
- [ ] Cmd+F 触发 find 窗口

### 风险

- Tauri 2 在 Linux GTK 上对窗口内菜单的支持有限 — 可以接受 Linux 不显示原生菜单，依靠托盘菜单兜底。
- 菜单 id 命名空间要和 popup_menu 区分，避免 `on_menu_event` 错路由。

---

## P2.D — 查找窗口

### 目标

独立的查找/替换窗口（`#/find` 路由），blur-to-hide。

### 任务

1. **`find_show` 命令真实实现**：创建/显示 `find` WebviewWindow
   - label = `find`，size 480x400，无边框，skip taskbar
   - URL `#/find`
2. **窗口生命周期**：blur 自动 hide（不销毁），下次 show 直接 show 已存在的窗口
3. **真实的 find 命令实现**（替换 Phase 1A stub）：
   - `find_by(query, options)` — 在 Rust 侧搜索所有 entries 文件，返回匹配位置数组
   - `find_add_history` / `find_get_history` / `find_set_history` — 写到 `internal/histories/find.json`
   - `find_add_replace_history` / `find_get_replace_history` / `find_set_replace_history` — 同上不同 key
4. **替换写回路径**：查找窗口替换某段文字 → 通过 Tauri event 把替换结果发给 `main` 窗口 → main 调 `set_hosts_content` 落盘
   - 不给 find 窗口直接的 `set_hosts_content` 权限（参见 capability 矩阵）

### 出口条件

- [ ] Cmd+F 或菜单项 → 查找窗口出现
- [ ] 输入查询 → 主窗口高亮匹配项
- [ ] 替换 → 主窗口对应文件被写回
- [ ] 查找窗口失焦自动隐藏
- [ ] 查找历史持久化

### 风险

- 替换写回路径走事件而不是 command，需要 main 窗口在线 — 如果 main 被 hide 了，事件还是能送到（Tauri event 是窗口级，不要求显示），所以问题不大。
- 多窗口的 capability 边界：find 窗口不能持有写权限（已在 Phase 0b 矩阵确定）。

---

## P2.G — 本地 HTTP API

### 目标

Rust 内嵌 HTTP 服务，重建 Electron 时代的 Hono 路由：`/`、`/remote-test`、`/api/list`、`/api/toggle`。

### 任务

1. **HTTP 服务器**：选 `axum`（生态好、与 tokio 自然契合）
2. **路由实现**：
   - `GET /` → `"Hello SwitchHosts!"`
   - `GET /remote-test` → `"# remote-test\n# {ts}"`
   - `GET /api/list` → 调 `storage::manifest::Manifest::load(&paths)` + 扁平化为 `{success: true, data: [...]}` JSON
   - `GET /api/toggle?id=<id>` → **直接调用 `hosts_apply::toggle_hosts_item` 服务函数**，不走 renderer broadcast。返回 `"ok"` 或错误字符串
3. **监听地址**：从 `AppConfig` 读 `http_api_only_local`：
   - true → `127.0.0.1:<port>`
   - false → `0.0.0.0:<port>`
4. **生命周期**：
   - 启动时根据 `http_api_on` 决定是否启动 server
   - 配置变化（`config_set("http_api_on", ...)` 或 `http_api_only_local` 变化）→ 服务自动重启 listener
   - 实现方式：用 `tokio::sync::watch` 或 `tokio::sync::Notify` 让 server task 感知配置变化
5. **不依赖窗口**：HTTP 服务必须在主窗口隐藏 / 仅托盘运行 / 主窗口未创建场景下都可用
6. **响应体语义保留**：与 Electron 当前的响应字符串、状态码、JSON 字段名严格一致（Alfred 等第三方调用方依赖）

### 出口条件

- [ ] `curl http://127.0.0.1:<port>/` → `Hello SwitchHosts!`
- [ ] `curl http://127.0.0.1:<port>/api/list` → 返回 hosts 列表 JSON
- [ ] `curl http://127.0.0.1:<port>/api/toggle?id=<existing-id>` → `ok`，且系统 hosts 真的被切换
- [ ] 主窗口完全关闭（隐藏到托盘）状态下，上面的 curl 都仍然可用 — 这是相对 Electron 版的**预期行为改进**
- [ ] `config_set("http_api_on", false)` → 服务在 1 秒内停止监听
- [ ] `config_set("http_api_only_local", false)` → 服务自动切到 `0.0.0.0` 监听

### 风险

- axum 的 graceful shutdown + 重启需要小心管理 task 句柄，避免泄漏。
- 端口冲突（其他进程占用）需要明确报错而不是静默失败。
- `/api/toggle` 现在能在主窗口不存在时工作 — 这是预期改进，但需要在 release notes 显式说明（参见 [tauri-migration-plan.md](/Users/wu/studio/SwitchHosts/v5plan/switchhosts-v5-tauri-migration-plan.md) 的 `/api/toggle` 语义变更小节）。

---

## P2.H — 系统集成杂项

### 目标

系统语言检测、外链打开、文件管理器定位、深浅色联动。零散但都不大。

### 任务

1. **系统语言检测**：
   - 用 `sys-locale` crate 或 `tauri::Manager::get_locale`
   - 在 `AppState::bootstrap` 时检测一次，存入 `AppState.system_locale: String`
   - 通过 `get_basic_data` 暴露给 renderer
   - 当 `AppConfig.locale` 是 None 时，UI 用 system_locale 兜底
2. **`open_url` 真实实现**：替换 Phase 1A stub
   - 使用 `tauri-plugin-shell` 的 `opener` 或自己写 Rust 实现
   - URL 白名单：`http://`、`https://`、`mailto:`，其余拒绝
3. **`show_item_in_folder` 真实实现**：
   - macOS: `open -R <path>`
   - Linux: `xdg-open <parent-dir>`（无原生"select file"）
   - Windows: `explorer.exe /select,<path>`
4. **`dark_mode_toggle` 真实实现**：
   - 调 `WebviewWindow::set_theme(Light/Dark/None)`
   - `theme = "system"` → 跟随系统（`set_theme(None)`）

### 出口条件

- [ ] 首次启动（locale 未配置）→ UI 自动用系统语言
- [ ] 点偏好里的"主页"链接 → 浏览器打开
- [ ] 点偏好里的"在文件管理器中显示" → Finder/Explorer 打开
- [ ] 切换主题 → 标题栏 / 边框颜色立即跟随变化（macOS 最明显）

### 风险

- `tauri-plugin-shell` 的 `opener` 需要 capability 配置；要在 default.json 加 `shell:allow-open`。
- `dark_mode_toggle` 在 Linux GTK 上效果有限，预期 Linux 验收宽松。

---

## P2.I — Phase 1 债务清理

### 目标

清掉 Phase 0/1 留下的债务。在进 Phase 3 之前做完，避免发布链复杂化。

### 任务

1. **Per-window capability 拆分**（参见 [capabilities-and-commands.md](/Users/wu/studio/SwitchHosts/v5plan/switchhosts-v5-capabilities-and-commands.md)）：
   - `src-tauri/capabilities/main.json` — 全集
   - `src-tauri/capabilities/find.json` — 收紧到 G1+G2+G4(只读)+G7
   - `src-tauri/capabilities/tray.json` — 收紧到 G1+G2+G5+G9
   - `src-tauri/capabilities/shared-event.json` — 三窗口共享的 event/window 权限
   - 删除 `default.json`
2. **Tauri 专用 renderer 构建输出目录**：
   - 解决 `frontendDist: "../build"` 与 Electron 共享 `build/` 目录的脏问题
   - 新增 `vite.render-tauri.config.mts`，输出到 `build-tauri/`
   - `tauri.conf.json` 的 `frontendDist` 改指向 `../build-tauri`
   - `beforeBuildCommand` 改成新配置的构建命令
3. **版本号注入**：
   - 写一个 `build.rs` 或 npm 脚本，读 `src/version.json` 的前三段，写入 `tauri.conf.json` 的 `version` 字段
   - Rust 启动时读环境变量 `SWH_BUILD_NUMBER`，合成 `X.Y.Z (build)` 字符串
4. **`agent.once` race 修复**（如果 P2.D 验收时遇到了）：
   - 让 `PopupMenu.show` 改成 async，先 `await` 所有 `once` 注册再 invoke `popup_menu`
   - 或者把 `once` 改成返回 Promise<OffFunction>，调用方 await
5. **MSRV 对齐**：按 Tauri 2.10 实际要求更新 `Cargo.toml` 的 `rust-version`
6. **孤儿 entries GC**：清理 `entries/` 下没有节点引用的 `.hosts` 文件（在 P2.E 已经间接需要：永久删除回收站时要删 entries）

### 出口条件

- [ ] 三个 capability 文件存在，每个窗口的能力按矩阵收紧
- [ ] `npm run tauri:build` 产生干净的 bundle，没有 Electron `main.js` / `preload.js` 残留
- [ ] `tauri.conf.json` 的 version 不是硬编码 `4.3.0`，而是从 `src/version.json` 注入
- [ ] 关于面板显示 `X.Y.Z (build)` 形式
- [ ] 永久删除回收站条目时，对应的 `entries/<id>.hosts` 也被删除

### 风险

- 拆 capability 的过程中可能漏权限 → 所有窗口启动后跑一遍命令验证。
- 改 frontendDist 可能影响 dev 模式 — 充分测试 `tauri:dev` 在改动前后都能 hot reload。

---

## Phase 2 全局出口条件

完成所有 9 个子步骤后，应该满足：

- [ ] 全部 [tauri-migration-plan.md > Phase 2](/Users/wu/studio/SwitchHosts/v5plan/switchhosts-v5-tauri-migration-plan.md) 列出的能力可用
- [ ] 系统 hosts 写入流程在 macOS 通过验收
- [ ] 本地 HTTP API 在 macOS 通过验收
- [ ] 查找 / 替换 / 回收站 / 历史 / 远程刷新 / Apply / 切换主题 / 切换 locale 全部跑通
- [ ] Alfred 调用兼容（手动 curl 验证）
- [ ] 三平台代码都存在且 cargo check 通过；macOS 真实运行验收，Linux/Windows 在 Phase 3 / Cutover 阶段验收

到这一步，Phase 2 的实质性工作就结束了，可以进入 Phase 3（更新 + 发布链重建）。

---

## 估算与建议节奏

| 子步骤 | 估算 commit 数 | 主要不确定性 |
|---|---|---|
| P2.A | 1 | 单实例插件 + 窗口几何持久化集成 |
| P2.E | 2–3 | 三平台提权代码（macOS 先行） |
| P2.F | 1–2 | reqwest 代理配置 + 后台 task 生命周期 |
| P2.B | 1–2 | 托盘小窗的 blur 行为 |
| P2.C | 1 | locale 联动 |
| P2.D | 1 | find 窗口的事件回路 |
| P2.G | 1–2 | axum 服务的优雅启停 |
| P2.H | 1 | 杂项 |
| P2.I | 2–3 | capability 拆分 + 构建产物分离 |

合计预计 11–17 个 commit，按 1 个子步骤一次冒烟的节奏走，整段 Phase 2 期望能在可控范围内完成。

每个子步骤执行前都建议：

1. 先读对应这一节
2. 列出本子步骤的 todo
3. 开工，cargo check 必须零警告
4. 自检（参考 [implementation-notes.md](/Users/wu/studio/SwitchHosts/v5plan/switchhosts-v5-implementation-notes.md) 的"自检 checklist"）
5. commit + smoke test
