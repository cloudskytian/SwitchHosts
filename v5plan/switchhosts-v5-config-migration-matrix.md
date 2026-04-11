# SwitchHosts v5 配置迁移矩阵

## 目的

对当前 Electron 版 [src/common/default_configs.ts](/Users/wu/studio/SwitchHosts/src/common/default_configs.ts) 中的每个配置项，逐条记录在 v5 Tauri 版本中的：

1. 存储位置（v5 内部状态路径）
2. 默认值
3. 生效时机
4. 是否需要重启
5. 与当前 Electron 版的行为是否等价
6. 消费者（哪些 Rust 服务 / 前端组件会读它）

本文件是 Phase 0b 的交付物之一，Phase 1B 与 Phase 2 实施时以此为准。

## 存储总览

v5 所有配置与运行态辅助信息存放在 `~/.SwitchHosts/internal/` 下：

```text
~/.SwitchHosts/
  manifest.json
  trashcan.json
  entries/
  internal/
    config.json           # 本文件覆盖的 23 项配置
    state.json            # UI 运行态（窗口位置、折叠状态等）
    histories/
      system-hosts.json   # 系统 hosts 写入历史
      cmd-after-apply.json
      find.json
  v4/
```

`config.json` 的根结构：

```json
{
  "format": "switchhosts-config",
  "schemaVersion": 1,
  "ui": { ... },
  "preferences": { ... },
  "proxy": { ... },
  "http_api": { ... },
  "update": { ... },
  "env": "PROD"
}
```

分组方式仅用于提高可读性，不影响单项读写的 command 接口语义（`config_get("left_panel_show")` 仍然直接按 key 索引）。

## 配置项矩阵

下表列出 23 项可持久化配置（不含 `env`，`env` 由构建期注入，不进入 `config.json`）。

图例：

- **生效时机**：R = 立即生效 / W = 重启后生效 / C = 需要手动触发相关动作
- **等价性**：✓ 与 Electron 版行为完全等价 / △ 语义不变但存储位置变更 / ⚠ 行为有细微变化（见说明）

### UI 组

| key | 默认值 | 类型 | 存储位置 | 生效时机 | 重启 | 等价性 | 消费者 | 说明 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `left_panel_show` | `true` | bool | `config.ui.left_panel_show` | R | 否 | △ | renderer | 左侧面板显示 |
| `left_panel_width` | `270` | number | `config.ui.left_panel_width` | R | 否 | △ | renderer | 左侧面板宽度（像素） |
| `use_system_window_frame` | `false` | bool | `config.ui.use_system_window_frame` | W | **是** | △ | Rust `window` | 切换系统原生边框需要重建窗口 |

### preferences 组

| key | 默认值 | 类型 | 存储位置 | 生效时机 | 重启 | 等价性 | 消费者 | 说明 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `write_mode` | `'append'` | `'overwrite'\|'append'\|null` | `config.preferences.write_mode` | R | 否 | ✓ | Rust `hosts_apply` | 控制系统 hosts 写入模式 |
| `history_limit` | `50` | number | `config.preferences.history_limit` | R | 否 | △ | Rust `hosts_apply` + renderer | 写入历史保留上限；现在也作用于迁移后的 `internal/histories/system-hosts.json` |
| `locale` | `undefined` | `LocaleName\|undefined` | `config.preferences.locale` | R | 否 | ✓ | renderer + Rust `menu`/`tray` | `undefined` 表示跟随系统；系统检测在 Rust 侧完成 |
| `theme` | `'light'` | `'light'\|'dark'\|'system'` | `config.preferences.theme` | R | 否 | ✓ | renderer + Rust `window`（`set_theme`） |
| `choice_mode` | `2` | `0\|1\|2` | `config.preferences.choice_mode` | R | 否 | ✓ | renderer | 顶层列表选择模式（default/single/multi） |
| `multi_chose_folder_switch_all` | `false` | bool | `config.preferences.multi_chose_folder_switch_all` | R | 否 | ✓ | renderer + Rust `hosts_apply` |
| `remove_duplicate_records` | `false` | bool | `config.preferences.remove_duplicate_records` | R | 否 | ✓ | Rust `hosts_apply` | 生成最终 hosts 内容时是否去重 |
| `cmd_after_hosts_apply` | `''` | string | `config.preferences.cmd_after_hosts_apply` | R | 否 | △ | Rust `hosts_apply` | 写入成功后执行的命令；不走提权路径，执行结果记录到 `internal/histories/cmd-after-apply.json` |
| `hide_at_launch` | `false` | bool | `config.preferences.hide_at_launch` | R（下次启动生效） | 下次启动 | ✓ | Rust 启动流程 |
| `show_title_on_tray` | `false` | bool | `config.preferences.show_title_on_tray` | R | 否 | ✓ | Rust `tray` |
| `tray_mini_window` | `true` | bool | `config.preferences.tray_mini_window` | R | 否 | ✓ | Rust `tray` | 托盘点击打开 mini 窗口还是激活主窗口 |
| `hide_dock_icon` | `false` | bool | `config.preferences.hide_dock_icon` | R（下次启动生效） | 下次启动 | ✓ | Rust macOS 启动流程 | macOS only；与当前 Electron 版一致，仅启动时读取一次 |
| `send_usage_data` | `false` | bool | `config.preferences.send_usage_data` | R | 否 | ⚠ | Rust tracer stub | **实现上保持 no-op**，与当前 Electron 版 [src/main/libs/tracer.ts](/Users/wu/studio/SwitchHosts/src/main/libs/tracer.ts) 的 inert 状态一致；配置值照常迁移 |

### proxy 组

| key | 默认值 | 类型 | 存储位置 | 生效时机 | 重启 | 等价性 | 消费者 | 说明 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `use_proxy` | `false` | bool | `config.proxy.enabled` | R | 否 | △ | Rust `refresh` |
| `proxy_protocol` | `'http'` | `'http'\|'https'` | `config.proxy.protocol` | R | 否 | △ | Rust `refresh` |
| `proxy_host` | `''` | string | `config.proxy.host` | R | 否 | △ | Rust `refresh` |
| `proxy_port` | `0` | number | `config.proxy.port` | R | 否 | △ | Rust `refresh` |

**迁移说明**：v5 在存储中把代理参数重新包成 `config.proxy` 子对象，但对外的 `config_get/config_set` 命令仍然使用原有 key 名，不改变前端调用方式。

### http_api 组

| key | 默认值 | 类型 | 存储位置 | 生效时机 | 重启 | 等价性 | 消费者 | 说明 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `http_api_on` | `false` | bool | `config.http_api.enabled` | R（服务自动启停） | 否 | ⚠ | Rust `http_api` | Rust 服务监听配置变化，无需重启；**行为改进**：当前 Electron 版需要重启 |
| `http_api_only_local` | `true` | bool | `config.http_api.only_local` | R（服务自动重启监听） | 否 | ⚠ | Rust `http_api` | 同上，Rust 服务自动重建 listener |

**变化**：v5 Rust 的 HTTP 服务层会订阅这两个 key 的变更事件并自动启停/重启监听，不再要求用户手动重启应用。Electron 版本需要重启的限制被移除。

### update 组

| key | 默认值 | 类型 | 存储位置 | 生效时机 | 重启 | 等价性 | 消费者 | 说明 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `auto_download_update` | `true` | bool | `config.update.background_check` | R（下次检查生效） | 否 | ✓ | Rust `updater` | **Legacy key 保留原名**；其语义已不再是"自动下载安装"，而是"后台静默检查更新"，与当前 Electron 版一致 |

### 不再存在于 v5 的配置

| key | 处置 | 说明 |
| --- | --- | --- |
| `env` | 不持久化 | 由构建期注入，从 `cargo` feature flag 或编译常量读取，不进 `config.json` |

---

## 不存在但值得说明的"类配置"

下列条目在 Electron 版**不是** `cfgdb.dict.cfg` 的项，但常被与配置项一同讨论，需要明确其在 v5 中的归属：

| 项 | Electron 存储 | v5 归属 | 说明 |
| --- | --- | --- | --- |
| 数据目录 | `localdb.dict.local.data_dir` | **废弃** | v5 固定使用 `~/.SwitchHosts`，不再支持切换 |
| 窗口位置 / 尺寸 | `electron-window-state` JSON | `internal/state.json > window` | 由 Rust 自行写入，不使用 `tauri-plugin-window-state` |
| 文件夹折叠状态 | `swhdb.list.tree` 里的 `folder_open` / `is_collapsed` | `internal/state.json > tree.collapsedNodeIds` | 与存储方案文档一致 |
| 查找历史 | `cfgdb.collection.find_history` | `internal/histories/find.json` | 通过 `find` 窗口的 command 读写 |
| 替换历史 | `cfgdb.collection.replace_history` | `internal/histories/find.json > replace` | 同上 |
| 命令执行历史 | `cfgdb.collection.cmd_history` | `internal/histories/cmd-after-apply.json` |
| 系统 hosts 写入历史 | `swhdb.collection.history` | `internal/histories/system-hosts.json` |

这些内容都属于"每机运行状态"，**不**进入 v5 主存储的用户可见层（`manifest.json` / `entries/*.hosts` / `trashcan.json`）。

---

## 迁移规则

### 读入

从 PotDb 读入旧配置时，Rust 迁移器按以下顺序读取：

1. 读取 `<legacy-data-dir>/config` 目录下的 `cfgdb.dict.cfg` JSON 文件
2. 对每个 key 调用类型转换（bool / number / string / enum）
3. 未在默认配置中出现的 key **丢弃**（不写入 `config.json` 的 `extras`）
4. 默认配置中出现但旧数据缺失的 key **补默认值**

### 写出

Rust 迁移器按"分组后"的嵌套结构写入 `config.json`：

```json
{
  "format": "switchhosts-config",
  "schemaVersion": 1,
  "ui": {
    "left_panel_show": true,
    "left_panel_width": 270,
    "use_system_window_frame": false
  },
  "preferences": {
    "write_mode": "append",
    "history_limit": 50,
    ...
  },
  "proxy": { ... },
  "http_api": { ... },
  "update": { "background_check": true },
  "send_usage_data": false
}
```

**注意**：`send_usage_data` 的分组选择是"留在 preferences 顶层"还是"独立字段"由 Phase 1B 落地时统一决定，本矩阵标注为 `config.preferences.send_usage_data` 作为默认目标。

### 命令接口兼容

即使存储结构变成嵌套，前端调用接口保持扁平：

- `config_get("left_panel_show")` → `true`
- `config_set("left_panel_show", false)`
- `config_all()` → 返回扁平化后的对象（与 Electron 版接口兼容）

Rust 侧内部做嵌套/扁平化的转换，前端完全无感。这是为了让 renderer 的调用点在迁移过程中零改动。

---

## 实施检查点

- [ ] Phase 1B 产出 Rust 侧的 `AppConfig` 结构体与对应 `serde` 反/序列化
- [ ] Phase 1B 验证每条旧 key 都有对应的读取测试用例
- [ ] Phase 1B 在迁移器中加"未知 key 丢弃"与"缺失 key 补默认"两条单元测试
- [ ] Phase 2 验证 `http_api_on` / `http_api_only_local` 的"无需重启生效"行为
- [ ] Phase 2 验证 `theme` 切换能正确同步到 Rust `window.set_theme()`
- [ ] Beta 前做一次"全量配置项往返读写"冒烟
