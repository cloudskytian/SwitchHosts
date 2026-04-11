# SwitchHosts v5 存储格式与迁移计划

## 背景

SwitchHosts v5 计划从 Electron 迁移到 Tauri，并将当前基于 PotDb 的内部存储结构，升级为一种更适合作为长期产品格式的明文主存储方案。

本方案的目标是：

- 用户的 hosts 数据明文保存在固定的 v5 根目录 `~/.SwitchHosts` 中
- 数据目录中的核心数据可见、可备份、可同步、可迁移
- PotDb 仅用于兼容旧版本数据，不再作为 v5 的长期主存储格式
- 配置和运行时状态与用户主数据分离
- 首版不引入 Node sidecar

---

## 设计目标

新格式需要满足以下要求：

- 能覆盖当前业务模型：`local`、`remote`、`group`、`folder`
- 能表达当前树结构、引用关系、远程刷新元数据、回收站信息
- 内容文件保持明文，方便用户查看和处理
- 文件路径稳定，不因标题修改、节点移动而改变
- 迁移时尽量不丢失现有字段
- 方便后续跨平台、跨框架复用

---

## 总体方案

### 核心原则

v5 的用户主数据采用：

- `manifest.json`：保存树结构与元数据
- `entries/<id>.hosts`：保存每个本地或远程 hosts 节点的正文内容
- `trashcan.json`：保存回收站数据

配置、窗口状态、命令历史、查找历史等不进入用户可见主数据文件，但仍与主数据一起放在同一个 v5 根目录下的 `internal/` 子目录中。

### v5 根目录结构

```text
<v5-root>/
  manifest.json
  trashcan.json
  entries/
    <node-id>.hosts
  internal/
    config.json
    state.json
    histories/
  v4/
    migration-<timestamp>/
      archive-metadata.json
      data/
      config/
      localdb.json
```

### 默认 v5 根目录

v5 固定使用 `~/.SwitchHosts` 作为运行根目录，`v4` 子目录仅用于收纳迁移完成后的旧版数据与旧版配置。

```text
~/.SwitchHosts
```

说明：

- v5 的运行根目录固定为 `~/.SwitchHosts`
- 若旧版本一直使用默认目录，则迁移来源也是 `~/.SwitchHosts`
- 若旧版本使用了自定义 `data_dir`，则该目录只作为首次迁移的数据来源，不再作为 v5 运行根目录
- 首次迁移完成后，旧版数据、旧版配置和旧 `localdb` 快照会统一归档到 `~/.SwitchHosts/v4/`
- v5 的用户可见主数据与内部配置仍位于根目录本身，而不是 `v4/` 子目录中

---

## 格式校验与不变量

主存储格式在运行时必须满足以下约束：

- `id` 在整个数据集中全局唯一，不能在 `root`、`children`、`trashcan.items` 中重复出现
- `root` 数组顺序有意义，表示顶层显示顺序
- `children` 数组顺序有意义，表示文件夹内显示顺序
- 同一节点只能出现在一个树位置，不能同时被多个父节点持有
- 只有 `local` 和 `remote` 节点允许出现 `contentFile`，且 `isSys !== true`
- `isSys === true` 的节点不分配 `contentFile`，其内容由运行时系统 hosts 读取服务提供
- `contentFile` 必须是相对路径，并且必须位于 `entries/` 目录下
- `contentFile` 不允许出现 `..`、绝对路径或跳出数据目录的路径
- `group.include` 只允许引用 `local` 或 `remote` 节点
- `group.include` 不允许引用 `group`、`folder`、回收站节点或不存在的节点
- `group.include` 不允许重复引用同一个节点
- `group.include` 不允许自引用
- `group.include` 数组顺序有意义，表示组合内容的拼接顺序
- 因为 `group.include` 仅允许引用 `local`/`remote`，格式层面禁止循环引用
- `trashcan.items[].node` 必须保留删除时的完整节点快照，且 `id` 必须与 `trashcan.items[].id` 一致

### 加载与校验失败策略

应用在读取用户手工修改后的主存储时，必须先做格式校验。

若发现以下问题：

- 循环引用
- 悬空引用
- 缺失的 `entries/*.hosts`
- 非法 `contentFile`
- 重复 `id`
- 不支持的节点类型

则加载器应：

- 拒绝将损坏数据作为新的运行时状态
- 保留上一次成功加载的内存快照
- 向用户展示明确错误信息
- 不主动覆盖用户已有文件，直到用户修复问题或手动恢复

---

## 主存储格式定义

### 1. `manifest.json`

`manifest.json` 是主清单文件，用来保存节点树和元数据。

示例结构：

```json
{
  "format": "switchhosts-data",
  "schemaVersion": 1,
  "root": []
}
```

字段定义：

- `format`: 固定值，标识文件类型，当前为 `switchhosts-data`
- `schemaVersion`: 当前格式版本，首版为 `1`
- `root`: 顶层节点数组

---

### 2. `HostNode` 统一结构

所有节点共用以下基础字段：

```json
{
  "id": "uuid",
  "type": "local | remote | group | folder",
  "title": "string",
  "on": true,
  "isSys": false,
  "extras": {}
}
```

字段说明：

- `id`: 节点唯一 ID，稳定且不变
- `type`: 节点类型
- `title`: 节点显示名称
- `on`: 节点当前启用状态
- `isSys`: 是否系统节点
- `extras`: 迁移保底字段，用于保存当前未正式建模但仍需保留的信息

---

### 3. `local` 节点

本地 hosts 节点示例：

```json
{
  "id": "2d8b7c2e-xxxx",
  "type": "local",
  "title": "本地开发",
  "on": false,
  "isSys": false,
  "contentFile": "entries/2d8b7c2e-xxxx.hosts",
  "extras": {}
}
```

说明：

- `contentFile` 指向对应的正文文件
- 正文内容保存在 `entries/<id>.hosts`
- `isSys === true` 的系统节点（代表 `/etc/hosts` 本身）不分配 `contentFile`，其内容由运行时系统 hosts 读取服务提供

---

### 4. `remote` 节点

远程 hosts 节点示例：

```json
{
  "id": "ab12cd34-xxxx",
  "type": "remote",
  "title": "远程规则",
  "on": false,
  "isSys": false,
  "contentFile": "entries/ab12cd34-xxxx.hosts",
  "source": {
    "url": "https://example.com/hosts",
    "refreshIntervalSec": 3600,
    "lastRefresh": "2026-04-11 10:00:00",
    "lastRefreshMs": 1775872800000
  },
  "extras": {}
}
```

说明：

- `contentFile` 保存当前远程内容缓存
- `source.url` 为远程地址
- `source.url` 允许的协议包括 `http://`、`https://`、`file://`
- `source.refreshIntervalSec` 对应当前模型中的刷新周期
- `source.refreshIntervalSec <= 0` 表示禁用自动刷新
- 只有 `http://` 和 `https://` 远程源参与后台定时刷新
- `file://` 远程源允许手动刷新，但不参与后台定时刷新
- `source.lastRefresh` / `source.lastRefreshMs` 保存最近刷新时间
- `entries/<id>.hosts` 对于 `remote` 节点是可见缓存，不是用户主编辑入口
- 用户手工修改远程缓存文件后，应用可以重新读取该内容，但下一次远程刷新会覆盖它

---

### 5. `group` 节点

分组节点示例：

```json
{
  "id": "group-001",
  "type": "group",
  "title": "组合规则",
  "on": false,
  "isSys": false,
  "group": {
    "include": ["id-a", "id-b", "id-c"]
  },
  "extras": {}
}
```

说明：

- `group.include` 保存被组合节点 ID 列表
- `group.include` 的数组顺序必须原样保留，运行时按该顺序聚合内容
- `group` 自身不对应内容文件
- 实际内容仍由运行时按引用关系聚合生成

---

### 6. `folder` 节点

文件夹节点示例：

```json
{
  "id": "folder-001",
  "type": "folder",
  "title": "工作环境",
  "on": false,
  "isSys": false,
  "folder": {
    "mode": 0
  },
  "children": [],
  "extras": {}
}
```

说明：

- `folder.mode` 对应现有 `folder_mode`
- `children` 保存子节点数组
- `folder` 自身不对应内容文件

### 7. 文件夹展开状态

文件夹展开/折叠状态属于每台机器上的 UI 运行状态，不进入用户可见主存储。

首版规则如下：

- `manifest.json` 中不保存 `folder.open` 一类展开状态字段
- 文件夹展开状态写入 `<v5-root>/internal/state.json`
- 该状态不参与 hosts 聚合、导入导出和格式校验
- 迁移旧数据时，优先读取现有 `is_collapsed`；若遇到旧备份中的 `folder_open`，仅作为兼容回退字段使用

建议的内部状态示例：

```json
{
  "tree": {
    "collapsedNodeIds": ["folder-001", "folder-002"]
  }
}
```

---

## 内容文件规则

### 文件命名规则

正文文件统一保存在：

```text
entries/<id>.hosts
```

例如：

```text
entries/2d8b7c2e-xxxx.hosts
```

### 规则说明

- 只有 `local` 和 `remote` 节点对应正文文件
- `group` 和 `folder` 节点没有独立正文文件
- 文件名基于稳定 ID，而不是标题
- 节点重命名、移动、排序调整时，不改文件路径
- 所有内容文件统一采用：
  - 编码：`UTF-8`
  - 换行：`LF`
- 真正写入系统 hosts 文件时，再按目标平台转换换行符

### 运行时写入策略

主存储在日常运行中也必须采用原子写入，而不只是迁移时原子写入。

规则如下：

- `manifest.json` 的写入流程为：先写入同目录临时文件，再使用 rename 替换正式文件
- `trashcan.json` 的写入流程为：先写入同目录临时文件，再使用 rename 替换正式文件
- `entries/<id>.hosts` 的写入流程为：先写入同目录临时文件，再使用 rename 替换正式文件
- 需要同时更新正文文件和清单文件时，先完成正文文件原子写入，再更新 `manifest.json`
- 需要同时更新树结构和回收站时，最后一步再写入最终可见的 `manifest.json` / `trashcan.json`

### 崩溃恢复策略

v1 不引入复杂事务日志，而采用“最后成功 rename 的文件为准”的恢复策略。

应用启动时：

- 可忽略并清理遗留的 `.tmp` 临时文件
- 若正式文件存在，则始终以正式文件为准
- 若临时文件存在但正式文件不存在，不自动提升临时文件为正式文件
- 若 `manifest.json` 通过校验，则继续启动
- 若 `manifest.json` 损坏，则进入错误提示与人工恢复流程

---

## 回收站格式

### `trashcan.json`

回收站文件结构：

```json
{
  "format": "switchhosts-trashcan",
  "schemaVersion": 1,
  "items": []
}
```

单个回收站条目结构：

```json
{
  "id": "node-id",
  "deletedAtMs": 1775872800000,
  "parentId": "parent-node-id-or-null",
  "node": {}
}
```

字段说明：

- `id`: 被删除节点 ID
- `deletedAtMs`: 删除时间戳
- `parentId`: 删除前的父节点 ID；顶层节点为 `null`
- `node`: 被删除时的完整节点快照

### 回收站规则

- 每次删除只产生一个顶层回收站条目，`node` 保存被删除根节点的完整快照
- 若被删除节点带有子孙节点，则这些节点继续嵌套在 `node.children` 中，而不是拆成多个 `items`
- `parentId` 记录的是“被删除根节点”原本的父节点 ID，而不是子孙节点各自的父节点
- 删除节点时保留其完整节点结构
- 若节点存在内容文件，文件暂不删除
- 恢复节点时恢复其树位置和关联内容
- 只有“永久删除”时，才递归删除对应的内容文件

---

## 可见数据与内部数据边界

### 放入用户可见数据目录的内容

以下内容属于“核心用户数据”，应放入固定的 v5 根目录 `~/.SwitchHosts`：

- 列表树结构
- 各 hosts 节点元数据
- 本地 hosts 正文
- 远程 hosts 缓存正文
- 远程刷新元数据
- 回收站数据

这些内容位于 `<v5-root>/` 根下，属于用户可见主存储。

### 放入应用内部存储的内容

以下内容不作为用户主数据的一部分：

- UI 配置
- 窗口状态
- 树展开/折叠状态
- 系统语言检测结果
- 命令历史
- 查找历史
- 最近使用状态
- 运行缓存
- 代理配置
- “应用后执行命令”配置与历史
- 其他非核心操作性状态

这些内容位于 `<v5-root>/internal/` 下，不单独写入 Tauri 的 app config/data 目录。

---

## 旧数据兼容策略

### 总原则

PotDb 不再作为 v5 长期主存储，只作为迁移来源。

### 直接兼容范围

v5 的直接迁移目标限定为“已经升级到最新 Electron 版本、并完成 PotDb 数据落盘”的用户。

明确约束如下：

- v5 直接兼容当前 Electron 版本使用的 PotDb 数据目录
- v5 不直接读取更老版本遗留的 `data.json` 等非 PotDb 结构
- 仍停留在 v3 数据结构的用户，需要先升级到最新 Electron 版本，完成 `v3 -> PotDb` 迁移后，再升级到 v5
- 这样可以避免在 v5 中长期保留过多历史兼容分支
- v5 首次启动时必须先检查是否存在旧布局，完成新格式迁移后再把旧版文件归档到 `~/.SwitchHosts/v4/`

### 迁移读取范围

迁移器需要读取以下旧数据：

- `swhdb.list.tree`
- `swhdb.list.trashcan`
- `swhdb.collection.hosts`
- `swhdb.collection.history`（系统 hosts 写入历史）
- `swhdb.dict.meta`
- `cfgdb.dict.cfg`
- `cfgdb.collection.cmd_history`（应用后执行命令的历史）
- 旧目录中的 `config/` 内容
- 旧 Electron `userData/swh_local` 中 `localdb` 记录的 `data_dir`
- 必要的命令历史与查找历史

### 历史记录迁移目标

系统 hosts 写入历史与命令历史属于用户可见的业务痕迹，不应在迁移时直接丢弃。迁移规则如下：

- `swhdb.collection.history` 转存到 `<v5-root>/internal/histories/system-hosts.json`，继续受 `history_limit` 控制
- `cfgdb.collection.cmd_history` 转存到 `<v5-root>/internal/histories/cmd-after-apply.json`，保留当前的裁剪上限
- 查找历史与替换历史转存到 `<v5-root>/internal/histories/find.json`
- 历史记录均属于每机内部状态，不进入 `manifest.json`，也不进入 v5 备份 JSON 的默认导出范围

### 迁移写入范围

迁移后：

- 核心业务数据写入新主存储格式
- 配置和历史写入 `<v5-root>/internal/`
- 旧版 `data/`、`config/` 等文件以及旧 `localdb` 快照归档到 `<v5-root>/v4/`
- v5 运行时只使用 `<v5-root>` 根目录下的新格式文件，不再读取已归档到 `v4/` 的旧布局
- 旧 `swhdb.dict.meta.version` 仅作为迁移来源使用，不作为 v5 用户可见主存储字段长期保留

---

## 迁移流程

### 首次启动判定

v5 启动时按以下顺序判定：

1. v5 运行根目录固定为 `~/.SwitchHosts`
2. 如果 `~/.SwitchHosts/manifest.json` 已存在且有效，直接使用该 v5 根目录
3. 否则读取旧 Electron `userData/swh_local` 中的 `localdb.data_dir`
4. 若存在旧 `data_dir`，则将其作为旧版数据来源目录；否则回退到默认旧目录 `~/.SwitchHosts`
5. 检查旧 PotDb 数据与旧配置是否存在
6. 若存在，则执行一次性迁移，在 `~/.SwitchHosts` 下生成 v5 新格式文件
7. 新格式校验通过后，再将旧版 `data/`、`config/` 以及旧 `localdb` 快照归档到 `~/.SwitchHosts/v4/`
8. 迁移成功后切换到 `~/.SwitchHosts` 运行

### 迁移步骤

1. 读取旧树结构和内容数据
2. 读取旧配置、历史记录和 `localdb` 中的必要状态
3. 规范化节点字段
4. 生成新的 `manifest.json`
5. 为 `local` / `remote` 节点生成 `entries/<id>.hosts`
6. 生成 `trashcan.json`
7. 生成 `<v5-root>/internal/` 下的配置与状态文件
8. 校验所有引用关系和内容文件完整性
9. 原子替换正式目录中的新格式文件
10. 生成旧布局归档目录 `~/.SwitchHosts/v4/migration-<timestamp>/`
11. 将旧版 `data/`、`config/`、旧 `localdb` 快照和来源路径信息写入该归档目录
12. 标记迁移完成

### 原子写入策略

迁移过程先写入临时目录：

```text
~/.SwitchHosts/.migration-tmp/
```

完成全部校验后再替换到正式目录，避免中断时留下半成品。

### 失败处理

若迁移失败：

- 不覆盖已有的 `<v5-root>` 正式目录
- 不破坏旧 PotDb 与旧配置目录
- 给用户明确错误提示
- 允许下次重试迁移

### 旧版文件归档规则

迁移成功后，旧版目录结构统一归档到 `<v5-root>/v4/` 下。

归档目标包括但不限于：

- 旧 `data/`
- 旧 `config/`
- 从旧 Electron `userData/swh_local` 提取的 `localdb.json` 快照
- 记录原始来源路径的 `archive-metadata.json`
- 其他仍属于 Electron/PotDb 布局的旧版文件

规则如下：

- 只有在新格式文件写入并校验通过后，才归档旧版文件
- `v4/` 仅作为旧版归档目录，不作为 v5 运行目录
- v5 运行时不再读取 `v4/` 中的旧版文件
- 每次成功迁移都写入独立的 `v4/migration-<timestamp>/` 子目录，避免与已有归档冲突
- `archive-metadata.json` 至少记录旧 `data/`、旧 `config/` 与旧 `localdb` 的原始绝对路径、归档时间以及归档模式
- `localdb.json` 采用展平后的 JSON 快照格式，而不是继续保留原始 PotDb 目录结构
- 旧布局归档的语义目标是“移动”，而不是“复制后长期保留两份”
- 若旧目录与 `~/.SwitchHosts` 位于同一文件系统，优先使用 rename 完成归档
- 若旧目录位于不同文件系统，则采用“复制到归档目录 -> 校验归档结果 -> 删除旧目录”的两阶段迁移
- 只有在归档副本校验通过后，才允许删除原始自定义目录中的旧布局
- 若旧版数据原本位于自定义目录，迁移成功后不再要求继续在原位置保留可运行布局
- 若归档步骤失败，应保留新格式文件与旧文件现状，并提示用户手动处理

---

## 外部文件改动策略

首版不做实时监听。

应用应在以下时机检测并重载外部文件改动：

- 应用启动时
- 应用重新获得焦点时
- 用户手动触发刷新时

后续若需要，再评估引入实时文件监听。

### 外部改动冲突策略

当应用检测到外部文件改动时，按以下规则处理：

- 若当前编辑器没有待保存修改，可自动重载磁盘内容
- 若当前编辑器存在待保存修改，则不自动覆盖当前编辑内容
- 发生冲突时，应提示用户选择“重新加载磁盘内容”或“保留当前编辑内容”
- 对 `remote` 节点而言，外部手改缓存文件可被读取，但下一次远程刷新仍会覆盖缓存

---

## 导入导出策略

### 自动迁移与手动导入的边界

v5 需要明确区分两条兼容链路：

- 首次启动自动迁移：只面向当前 Electron/PotDb 布局
- 手动导入：继续兼容旧版 v3 / v4 JSON 备份

两条链路规则如下：

- “首次启动自动迁移”的兼容范围不自动扩展到手动导入
- “手动导入”不要求来源目录仍保持 PotDb 可运行布局
- 两条链路分别实现、分别测试、分别给出失败提示

### 旧版兼容

继续支持旧版 JSON 备份导入。

### v5 导出

v5 的导出不再直接导出 PotDb 原始结构，而应导出基于领域模型的备份 JSON。

### v5 导入

v5 需支持两类导入：

- 旧版备份 JSON
- v5 新格式备份 JSON

### v5 备份 JSON 结构

建议的 v5 备份 JSON 包装结构如下：

```json
{
  "format": "switchhosts-backup",
  "schemaVersion": 1,
  "exportedAt": "2026-04-11T12:00:00.000Z",
  "manifest": {},
  "entries": {
    "node-id": "hosts content"
  },
  "trashcan": {}
}
```

说明：

- `manifest` 对应当前主清单
- `entries` 为节点 ID 到正文内容的映射
- `trashcan` 对应当前回收站结构
- 这是一种“内容备份”，不是“完整环境备份”
- 默认不导出 `<v5-root>/internal/` 中的 UI 状态、历史记录和运行态辅助信息
- `internal/` 中的代理配置、`write_mode`、`cmd_after_hosts_apply`、`locale`、`theme` 等行为配置默认也不进入该 JSON 备份
- 若需要完整回放某台机器上的运行状态，应直接备份整个 `~/.SwitchHosts` 目录，而不是只依赖备份 JSON

### 运行时与导入时的共同校验

以下校验既适用于用户直接编辑后的运行时加载，也适用于导入操作：

- `group.include` 是否只引用 `local` / `remote`
- 是否存在悬空引用
- 是否存在重复 `id`
- 是否存在非法 `contentFile`
- `entries/*.hosts` 是否与清单中的引用一致

---

## 旧字段到新字段映射

以下映射用于实现旧 PotDb 数据到 v5 主存储的转换：

| 旧字段 | 新字段 | 说明 |
| --- | --- | --- |
| `id` | `id` | 稳定节点 ID，直接沿用 |
| `title` | `title` | 直接沿用 |
| `on` | `on` | 直接沿用 |
| `type` | `type` | 节点类型直接沿用 |
| `is_sys` | `isSys` | 命名风格改为 camelCase |
| `url` | `source.url` | 仅 `remote` 节点使用 |
| `refresh_interval` | `source.refreshIntervalSec` | 秒级刷新间隔 |
| `last_refresh` | `source.lastRefresh` | 最近刷新时间字符串 |
| `last_refresh_ms` | `source.lastRefreshMs` | 最近刷新时间戳 |
| `include` | `group.include` | 仅 `group` 节点使用，顺序必须保留 |
| `folder_mode` | `folder.mode` | 仅 `folder` 节点使用 |
| `is_collapsed` | `internal.state.tree.collapsedNodeIds[]` | 当前树 UI 状态，`true` 时将该文件夹 ID 记入折叠集合 |
| `folder_open` | `internal.state.tree.collapsedNodeIds[]` | 历史兼容回退字段，`false` 时记入折叠集合，不再进入主存储 |
| `collection.hosts[].content` | `entries/<id>.hosts` | 正文改为独立明文文件 |
| 其他未建模字段 | `extras` | 迁移期保底保留 |

补充说明：

- `schemaVersion` 表示 v5 主存储格式版本，不等价于旧 `swhdb.dict.meta.version`
- 若后续需要保留导入来源版本，可写入内部迁移日志或诊断信息，而不是回写到用户可见主存储
- 若旧数据同时存在 `is_collapsed` 与 `folder_open`，以 `is_collapsed` 为准

---

## 为什么不继续使用 PotDb 目录格式

PotDb 当前更适合作为实现细节，而不适合作为长期用户数据格式，原因包括：

- 结构以 `dict/list/collection` 为中心，暴露的是实现方式而不是业务模型
- 用户很难理解不同目录和 JSON 的语义
- 不利于未来脱离 Node 运行时
- 不利于后续 Tauri / Rust / CLI / Web 共用同一数据契约

因此，v5 应以更稳定的领域格式作为长期主存储。

---

## 推荐结论

v5 推荐采用：

- v5 统一根目录：固定 `~/.SwitchHosts`
- 用户可见主存储：`manifest.json + entries/<id>.hosts + trashcan.json`
- 应用内部存储：位于同一根目录下的 `internal/`
- 旧版归档目录：位于同一根目录下的 `v4/`
- 旧 PotDb：仅作为一次性导入来源
- 首版外部改动同步策略：启动 / 聚焦 / 手动刷新时重载

这套方案可以同时满足：

- 明文可见
- 用户可控
- 易迁移
- 不依赖 Node sidecar
- 方便未来长期演进
