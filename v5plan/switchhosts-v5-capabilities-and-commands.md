# SwitchHosts v5 Capability / Command 暴露矩阵

## 目的

本文件定义 Tauri 2 下各窗口允许访问的 core / plugin 能力与自定义 command 白名单，是 Phase 0b 的交付物之一。Phase 1A 的前端适配层和 Rust command 注册层都要以此为准。

参考文档：

- [switchhosts-v5-tauri-migration-plan.md](/Users/wu/studio/SwitchHosts/v5plan/switchhosts-v5-tauri-migration-plan.md)
- [switchhosts-v5-storage-plan.md](/Users/wu/studio/SwitchHosts/v5plan/switchhosts-v5-storage-plan.md)

## 设计原则

1. **最小权限**：每个窗口只暴露完成其职责所需的能力
2. **Rust 独占 I/O**：用户主数据目录 `~/.SwitchHosts` 完全由 Rust 领域服务访问，不对前端开放 `fs` plugin
3. **高风险操作走窄化 intent command**：不把"系统 hosts 原始写入"直接暴露给任意窗口，而是提供"apply 某节点"这类领域动词
4. **辅助窗口默认收紧**：`find` / `tray` 窗口只能调用完成自身职责的 command，不继承 `main` 的高权限命令集
5. **capability 文件按窗口分组**：每个窗口至少一个 capability 文件，便于单独审计

---

## 窗口清单

v5 首版有三个 webview 窗口：

| 窗口 label | 用途 | 路由 | 生命周期 |
| --- | --- | --- | --- |
| `main` | 主界面：hosts 树、编辑器、偏好、回收站、历史 | `#/` | 应用启动后创建，支持隐藏与显示 |
| `find` | 查找 / 替换浮窗 | `#/find` | 首次使用时创建，blur 时隐藏 |
| `tray` | 托盘点击弹出的小窗 | `#/tray` | 托盘点击时显示，blur 时隐藏 |

另有一个"无窗口"执行上下文：Rust 后台任务和本地 HTTP API。后者不受 capability 限制，但必须直接调用 Rust 领域服务，不允许通过前端广播驱动业务。

---

## Core plugin 能力授权

下表列出 Tauri core plugin 能力在各窗口的开放情况。`×` 表示不开放，`✓` 表示开放，`—` 表示该窗口不需要。

| 能力 | `main` | `find` | `tray` | 说明 |
| --- | --- | --- | --- | --- |
| `core:default` | ✓ | ✓ | ✓ | 基线 |
| `core:event:default` | ✓ | ✓ | ✓ | 三个窗口需要互相 emit/listen 做广播 |
| `core:window:default` | ✓ | ✓ | ✓ | 每个窗口允许管理自身的显示/隐藏/焦点 |
| `core:webview:default` | ✓ | ✓ | ✓ | 允许 DevTools（Phase 0a 的决策） |
| `core:webview:allow-internal-toggle-devtools` | ✓ | × | × | release 构建中也可切换 DevTools 仅限主窗口 |
| `core:app:default` | ✓ | × | × | quit、应用元数据仅主窗口 |
| `core:menu:default` | ✓ | ✓ | ✓ | 右键 popup 菜单三窗口都需要 |
| `core:path:default` | × | × | × | 路径计算由 Rust 统一做，前端不需要 |
| `core:image:default` | × | × | × | 暂无前端图像处理需求 |
| `core:resources:default` | ✓ | ✓ | ✓ | Tauri 内部 channel/资源管理依赖 |
| `core:tray:default` | × | × | × | 托盘注册只由 Rust 启动流程触发 |

**注意**：`fs`、`shell`、`dialog`、`os`、`http`、`notification`、`clipboard-manager` 等 plugin 在 v5 首版**全部不启用**。如果需要对应功能，必须通过自定义 Rust command 提供窄化接口。

---

## 自定义 command 暴露矩阵

所有业务能力通过 `#[tauri::command]` 暴露。每个 command 必须有对应的 Tauri permission 定义文件（`src-tauri/permissions/<group>.toml` 或等效方式），capability 才能引用。

v5 首版规划 14 个 command 分组，共 ~50 条命令。下表按组列出：

### G1. `basic`（所有窗口）

| command | `main` | `find` | `tray` | 说明 |
| --- | --- | --- | --- | --- |
| `ping` | ✓ | ✓ | ✓ | 存活探测 |
| `get_basic_data` | ✓ | ✓ | ✓ | 启动时的基础元数据包 |
| `config_get` | ✓ | ✓ | ✓ | 读单个配置项 |
| `config_set` | ✓ | ✓ | ✓ | 写单个配置项（Rust 侧做 schema 校验） |
| `config_all` | ✓ | ✓ | ✓ | 全量读配置 |
| `config_update` | ✓ | ✓ | ✓ | 批量更新配置 |
| `open_url` | ✓ | ✓ | ✓ | 外链打开（Rust 白名单 `http/https/mailto`） |
| `show_item_in_folder` | ✓ | × | × | 仅主窗口偏好项会调用 |

### G2. `list_read`（所有窗口）

| command | `main` | `find` | `tray` | 说明 |
| --- | --- | --- | --- | --- |
| `get_list` | ✓ | ✓ | ✓ | 读取整棵 hosts 树 |
| `get_item_from_list` | ✓ | ✓ | ✓ | 按 id 读单节点元数据 |
| `get_content_of_list` | ✓ | ✓ | ✓ | 聚合某节点/多选的最终内容 |
| `get_trashcan_list` | ✓ | × | × | 回收站只在主窗口显示 |

### G3. `list_write`（主窗口）

| command | `main` | `find` | `tray` | 说明 |
| --- | --- | --- | --- | --- |
| `set_list` | ✓ | × | × | 写入整棵 hosts 树结构 |
| `move_to_trashcan` | ✓ | × | × | 单节点移入回收站 |
| `move_many_to_trashcan` | ✓ | × | × | 批量移入 |
| `restore_item_from_trashcan` | ✓ | × | × | 恢复节点 |
| `delete_item_from_trashcan` | ✓ | × | × | 永久删除单条 |
| `clear_trashcan` | ✓ | × | × | 清空回收站 |

### G4. `hosts_content`

| command | `main` | `find` | `tray` | 说明 |
| --- | --- | --- | --- | --- |
| `get_hosts_content` | ✓ | ✓ | × | 读某节点正文 |
| `set_hosts_content` | ✓ | ✓ | × | 写某节点正文（`find` 需要支持替换并写回） |
| `get_system_hosts` | ✓ | × | × | 读 `/etc/hosts` 原始内容 |
| `get_path_of_system_hosts` | ✓ | × | × | 展示系统 hosts 路径 |

### G5. `hosts_apply`（窄化 intent）

| command | `main` | `find` | `tray` | 说明 |
| --- | --- | --- | --- | --- |
| `apply_hosts_selection` | ✓ | × | ✓ | 把选中的节点写入系统 hosts（背后聚合 + 去重 + 提权 + 历史 + cmd_after_apply） |
| `toggle_hosts_item` | ✓ | × | ✓ | 单节点开关，由 tray 与主窗口共用；内部仍会触发 apply |
| `get_apply_history` | ✓ | × | × | 系统 hosts 写入历史列表 |
| `delete_apply_history_item` | ✓ | × | × | 删除单条历史 |

**关键规则**：
- 系统 hosts 的原始写入 command **不暴露**给任意窗口；只有 `hosts_apply` 内部 Rust 服务可以调用底层 writer
- `tray` 窗口虽然允许 `apply_hosts_selection`，但参数必须是"已有的节点 id 列表"，不允许直接传入 hosts 文件内容
- 本地 HTTP API 的 `/api/toggle` 内部也走 `toggle_hosts_item` 这一条路径

### G6. `remote_refresh`

| command | `main` | `find` | `tray` | 说明 |
| --- | --- | --- | --- | --- |
| `refresh_remote_hosts` | ✓ | × | × | 手动刷新单个远程节点 |
| `refresh_all_remote_hosts` | ✓ | × | × | 手动刷新全部 |

后台定时刷新直接由 Rust `refresh` 服务驱动，不走 command。

### G7. `find_window`

| command | `main` | `find` | `tray` | 说明 |
| --- | --- | --- | --- | --- |
| `find_show` | ✓ | ✓ | × | 打开查找窗口 |
| `find_by` | × | ✓ | × | 执行查找 |
| `find_add_history` | × | ✓ | × | 查找历史：追加 |
| `find_get_history` | × | ✓ | × | 查找历史：读取 |
| `find_set_history` | × | ✓ | × | 查找历史：覆写 |
| `find_add_replace_history` | × | ✓ | × | 替换历史：追加 |
| `find_get_replace_history` | × | ✓ | × | 替换历史：读取 |
| `find_set_replace_history` | × | ✓ | × | 替换历史：覆写 |

### G8. `cmd_history`

| command | `main` | `find` | `tray` | 说明 |
| --- | --- | --- | --- | --- |
| `cmd_get_history_list` | ✓ | × | × | `cmd_after_hosts_apply` 的执行历史 |
| `cmd_delete_history_item` | ✓ | × | × | |
| `cmd_clear_history` | ✓ | × | × | |

> `cmd_after_hosts_apply` 本身没有"前端触发执行"的 command。只有系统 hosts 写入成功后，Rust `hosts_apply` 服务才会触发它。

### G9. `dev`

| command | `main` | `find` | `tray` | 说明 |
| --- | --- | --- | --- | --- |
| `toggle_devtools` | ✓ | × | × | 主窗口 release 构建中也允许切 DevTools |

### G10. `window_ctl`

| command | `main` | `find` | `tray` | 说明 |
| --- | --- | --- | --- | --- |
| `hide_main_window` | ✓ | × | ✓ | 替代 `closeMainWindow`，语义从"关闭"明确为"隐藏" |
| `focus_main_window` | × | × | ✓ | 托盘要求把主窗口拉到前台 |
| `quit_app` | ✓ | × | × | 显式退出 |
| `update_tray_title` | ✓ | × | × | 托盘文字刷新 |

### G11. `import_export`

| command | `main` | `find` | `tray` | 说明 |
| --- | --- | --- | --- | --- |
| `export_data` | ✓ | × | × | 导出 v5 备份 JSON |
| `import_data` | ✓ | × | × | 导入本地文件（v3 / v4 / v5 备份） |
| `import_data_from_url` | ✓ | × | × | URL 导入 |

### G12. `updater`

| command | `main` | `find` | `tray` | 说明 |
| --- | --- | --- | --- | --- |
| `check_update` | ✓ | × | × | |
| `download_update` | ✓ | × | × | |
| `install_update` | ✓ | × | × | 触发安装并重启，前端必须先弹窗确认 |

### G13. `data_dir`

| command | `main` | `find` | `tray` | 说明 |
| --- | --- | --- | --- | --- |
| `get_data_dir` | ✓ | × | × | **只读**，展示 `~/.SwitchHosts` 的绝对路径 |

**不保留**：`get_default_data_dir`、`cmd_change_data_dir` 在 v5 全部移除。v5 根目录固定为 `~/.SwitchHosts`，不再支持运行时切换。

### G14. `migration`（启动阶段，不对外暴露）

| command | `main` | `find` | `tray` | 说明 |
| --- | --- | --- | --- | --- |
| `migration_status` | ✓ | × | × | 仅查询迁移状态与归档目录 |

**不暴露**：真正执行 PotDb → v5 迁移、写入 `v4/migration-<ts>/` 归档的动作**完全不对任何窗口开放**。迁移器只在 Rust 启动流程中被调用一次，迁移失败会通过 `get_basic_data` 的返回字段告知前端。

---

## 完全不开放给任意窗口的内部动作

下列能力**只允许 Rust 内部调用**，不对任何窗口开放 command：

1. `/etc/hosts` 的底层写入（由 `hosts_apply` 服务内部调用 `write_system_hosts`）
2. 提权后执行任意 shell 命令
3. `cmd_after_hosts_apply` 的实际执行（只在 `hosts_apply` 成功后自动触发）
4. PotDb 迁移器的执行入口
5. 旧布局归档到 `v4/migration-<ts>/` 的移动/复制/删除动作
6. updater 的 "install and relaunch" 最终回调（通过 main 窗口的 `install_update` 触发，但 Rust 侧会重新校验用户最后一次同意时间戳）
7. 本地 HTTP 服务器的启动/停止（由 Rust 启动流程根据 `http_api_on` 配置驱动）
8. 后台定时刷新任务的启动/停止

这些动作若需要对外暴露开关，只会通过 G1.`config_set` 修改对应配置项（如 `http_api_on`），由 Rust 服务观察配置变化自行启停。

---

## Capability 文件规划

`src-tauri/capabilities/` 下至少维护以下文件：

| 文件 | `windows` | 涵盖能力 |
| --- | --- | --- |
| `main.json` | `["main"]` | G1–G13 全集（按实际使用为准），core plugin 全部允许项 |
| `find.json` | `["find"]` | G1 + G2 + G4（仅 get/set content）+ G7，core plugin 裁剪 |
| `tray.json` | `["tray"]` | G1 + G2 + G5（仅 apply/toggle）+ G10（focus/hide main），core plugin 裁剪 |
| `shared-event.json` | `["main", "find", "tray"]` | `core:event:default` + `core:window:default` 等三窗口共享项 |

Phase 0a 的 `default.json` 只放 `core:default` 和主窗口，Phase 1A 启动时会用上述四个文件替换，并删掉 `default.json`。

---

## 实施检查点

Phase 1A 开始前需确认：

- [ ] 上表中每个命令都在 Rust 侧有对应的 `#[tauri::command]` 存根（即使是空实现）
- [ ] 每个命令都有 permission 文件定义
- [ ] 每个 capability 文件只引用该窗口允许的 permission
- [ ] `main.json` / `find.json` / `tray.json` 之间**不允许**有命令被同时列入 `find` 和 `tray` 但不在 `main` 的情况（作为一致性检查）
- [ ] 前端 Tauri 适配层的 `actions.xxx()` 调用全部能映射到上表中的 command 名
- [ ] 不在上表中的原 Electron action 名（例如 `cmdChangeDataDir`、`getDefaultDataDir`）必须在适配层中显式报错，避免静默失败

---

## 验收

本文件进入代码阶段后，验证方式为：

1. Phase 1A 每实现一个 command，交叉对照本表更新状态
2. 每次新增 capability 条目时，CI 或本地脚本需要校验 `windows × permission` 组合是否仍与本表一致
3. Beta 验收前跑一次"窗口 × command"穿透测试，确保不在白名单里的组合返回统一的 `PermissionDenied` 错误
