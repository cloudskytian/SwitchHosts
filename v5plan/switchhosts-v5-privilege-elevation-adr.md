# ADR: v5 跨平台系统 hosts 写入提权方案

## 状态

已决定 · Phase 0b 交付物 · Phase 2 实施

## 背景

SwitchHosts 的核心能力是写入系统 hosts 文件（`/etc/hosts`、`C:\Windows\System32\drivers\etc\hosts`），这在三大桌面平台上都需要管理员权限。当前 Electron 版的实现：

- 文件：[src/main/actions/hosts/setSystemHosts.ts](/Users/wu/studio/SwitchHosts/src/main/actions/hosts/setSystemHosts.ts)
- 策略：先尝试直接 `fs.writeFile`；若失败，用 `child_process.exec` 组装 `echo '${sudo_pswd}' | sudo -S chmod / cat` 管道，把用户输入的 sudo 密码注入到命令行
- 风险：
  - 密码通过命令行参数/stdin 传递，容易被其他进程观察到（macOS/Linux 下 `ps` 可见，即使使用 `-S` 也需要小心）
  - 管道顺序里存在短暂的 `chmod 777` 窗口
  - 仅覆盖 macOS/Linux，Windows 下当前只能依赖进程本身已经是管理员

迁移到 Tauri 后，这段逻辑必须完全重建：Tauri 没有 Node.js 的 `child_process`，也没有现成的 "sudo-prompt" 封装。本 ADR 锁定 v5 的跨平台策略。

## 目标

- 不在任何场合把用户密码写入命令行参数
- 每个平台使用**操作系统原生**的提权 UX，而不是自己搭一层密码弹窗
- 提权失败 / 用户取消 / 写入失败 三种情况返回统一错误码结构
- 只要求最小的一次性权限，不长期持有 root
- 关键路径在 Rust 侧可单元/集成测试
- 主窗口、托盘、本地 HTTP API 共享同一套提权实现

## 方案决策

### macOS

**首选**：通过 `osascript` 调用 AppleScript 的 `do shell script ... with administrator privileges`。

```rust
// 伪代码，Phase 2 实际实现
let script = format!(
    r#"do shell script "/bin/cp -f {} {} && /bin/chmod 644 {}" with administrator privileges"#,
    shell_escape(tmp_path),
    shell_escape(sys_hosts_path),
    shell_escape(sys_hosts_path),
);
Command::new("/usr/bin/osascript").arg("-e").arg(script).output()?;
```

要点：

- 系统原生弹出 TouchID / 密码框，SwitchHosts **永远不经手用户密码**
- 授权仅对本次 `do shell script` 有效，不在后台持有
- 路径参数必须走 `shell_escape`，防止注入
- 返回码区分：
  - exit 0：成功
  - exit 1 且 stderr 含 `User cancelled`：用户取消
  - 其他非零：失败
- 不依赖 `SMJobBless` / helper tool，因为维护成本高（需要单独签名、单独分发的 privileged helper），v5 首版不引入

**备选**：`SMJobBless` + `HelperTool` 模型。记录为"未来可能的性能优化项"——场景是：如果用户抱怨"每次写入都要弹提权框"，可以考虑安装一个常驻 helper 进行无感写入。代价是维护成本与签名复杂度显著增加。v5 首版**不采用**。

### Linux

**首选**：`pkexec`（来自 polkit）。

```rust
// 伪代码
Command::new("pkexec")
    .arg("--disable-internal-agent")
    .arg("/bin/sh")
    .arg("-c")
    .arg(format!("cp -f {} {} && chmod 644 {}", ...))
    .output()?;
```

要点：

- `pkexec` 会调用 polkit 的本地 agent 弹出桌面原生的认证窗口（KDE / GNOME 都有对应实现）
- SwitchHosts 永远不经手用户密码
- 需要发行版预装 polkit，主流桌面发行版（Ubuntu / Fedora / Debian with GNOME/KDE）默认都有

**回退**：若 `pkexec` 不可用（极少数最小化服务器桌面），Rust 层返回明确的 `PolkitMissing` 错误，**不自动**退回到 `sudo -A` + `SUDO_ASKPASS`。理由：

- `SUDO_ASKPASS` 需要用户自行配置一个 askpass helper，成功率和体验都不稳定
- 默默 fallback 会让错误排查更难；显式报错 + 文档指引更清晰
- v5 首版**不承担**"为没有 polkit 的 Linux 发行版兜底"的义务

v5 首版 Linux 提权支持矩阵：

| 发行版 / 桌面 | 支持 |
| --- | --- |
| GNOME（polkit 默认） | ✓ |
| KDE Plasma（polkit-kde-agent） | ✓ |
| Cinnamon / MATE / Xfce with polkit | ✓ |
| 纯 tty / 无 polkit 环境 | ✗（返回 `PolkitMissing`，引导用户手动授权 hosts 文件） |

**备选**：若社区反馈显示有足够多用户卡在 `PolkitMissing`，Phase 3 之后可以考虑新增"把文件权限交还给用户组"的引导流程（`chown oldj:oldj /etc/hosts` 这类），而不是在应用内写 askpass。这条留作**未来可选**，不进 v5 首版。

### Windows

**首选**：UAC 重启自身以 helper 子进程模式运行。

流程：

1. 主进程准备好临时文件 `%TEMP%\switchhosts-apply-<uuid>.tmp`，写入目标 hosts 内容
2. 主进程调用 `ShellExecuteW` 以 `runas` 动词重新启动**同一个 SwitchHosts 可执行文件**，传入一组特殊 CLI 参数：`--apply-hosts <src-tmp> <dst-system-hosts> <nonce>`
3. UAC 弹窗，用户同意后启动第二个进程，该进程进入特殊入口：
   - 校验 `nonce` 与父进程一致（通过命名管道或临时文件交换）
   - 校验源文件在当前用户可写的目录，目标是固定系统路径
   - 执行 copy + ACL 修正
   - 退出
4. 主进程通过命名管道读取 helper 的退出码与错误字符串

要点：

- **不依赖外部 helper exe**，复用同一个 SwitchHosts 可执行文件，避免额外签名/分发成本
- helper 模式下**只处理 hosts 写入**，不启动 UI、不启动 HTTP、不持久化任何状态
- 第二进程启动时立刻校验参数格式与 nonce，防止任意命令注入
- UAC 框由系统弹出，SwitchHosts 永不经手管理员密码

**不采用**：

- `runas` 命令行工具（需要用户在 prompt 里输入密码；UX 差）
- 长期持有的 Windows Service（与 macOS 的 SMJobBless 同样维护成本高）
- 在打包里放一个独立的 `switchhosts-helper.exe`（签名和分发翻倍）

## 统一错误模型

所有三平台的提权写入必须返回同一个 Rust enum：

```rust
#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HostsApplyError {
    #[error("permission elevation was cancelled by user")]
    UserCanceled,

    #[error("permission elevation failed: {reason}")]
    PermissionDenied { reason: String },

    #[error("system hosts write failed: {reason}")]
    WriteFailed { reason: String },

    #[error("platform not supported for automated elevation: {platform}")]
    PlatformUnsupported { platform: String },

    #[error("polkit / pkexec not available on this Linux system")]
    PolkitMissing,

    #[error("post-apply verification failed: {reason}")]
    VerificationFailed { reason: String },

    #[error("internal error: {reason}")]
    Internal { reason: String },
}
```

前端、本地 HTTP API 必须拿到这套结构化错误，而不是一段自由文本。`kind` 字段用于 UI 分支：

- `user_canceled`：不弹错误提示，只恢复"未应用"状态
- `permission_denied`：弹提示 + 链接到文档
- `polkit_missing`：弹提示 + 指向 Linux 发行版 polkit 安装指引
- `verification_failed`：提示用户检查文件系统完整性，并保留临时文件供排查
- 其他：统一弹错误 + 允许重试

## 安全考量

1. **绝不在命令行传递密码**（与当前 Electron 实现的主要区别）
2. **shell escaping**：所有通过 `osascript` / `pkexec` / `ShellExecuteW` 传递的参数必须经过 Rust 侧 `shell-escape` crate 处理
3. **临时文件位置**：仅放在当前用户可写的 `$TMPDIR` / `%TEMP%`，不放到 `/tmp`（macOS/Linux 上 `/tmp` 可能是多用户共享）
4. **临时文件权限**：创建时立即 `chmod 600`，写入完成后立即 rename
5. **nonce 校验**：Windows helper 模式下必须校验 nonce，防止其他进程诱导 SwitchHosts 写任意内容到 hosts
6. **写入后校验**：写入完成后立即再读回一次，比对字节；不一致则返回 `VerificationFailed` 并保留临时文件
7. **历史记录在提权前就落盘**：即使提权失败，用户也能看到"我尝试过应用哪份内容"
8. **`cmd_after_hosts_apply` 仅在写入+校验都通过后触发**：失败路径绝不触发写后命令

## 与 `cmd_after_hosts_apply` 的关系

`cmd_after_hosts_apply` 的执行由 Rust `hosts_apply` 服务负责，且**不走提权路径**。规则：

- 命令以**当前用户身份**执行，不继承任何提权上下文
- 命令的 stdout/stderr 捕获后写入 `internal/histories/cmd-after-apply.json`
- 命令模板支持的占位符由 Rust 侧显式白名单实现，不做任意 shell 插值
- 用户在配置里写的命令字符串**不参与 osascript/pkexec 的参数拼接**

这是一条硬边界：写入 hosts 需要 root，但写入之后的副作用命令绝不继承 root。

## 实施检查点（Phase 2）

- [ ] 选定具体 crate：`shell-escape`、`thiserror`、`serde` + 可能的 `tauri-plugin-shell`（仅 Windows helper 路径会用到）
- [ ] 实现 `HostsApplyError` 枚举并暴露给前端（通过 `#[tauri::command]` 的 `Result` 返回值）
- [ ] 编写三平台提权子模块：`macos.rs`、`linux.rs`、`windows.rs`
- [ ] 写一份集成测试：使用 mock hosts 路径（不是 `/etc/hosts`）验证 happy path 与取消路径
- [ ] UI 层为每种 `kind` 提供明确的 toast/对话框文案
- [ ] 文档里加一段"为什么每次写入都要弹提权框"的说明，避免用户以为是 bug

## 回顾

v5 首版不追求"静默写入"的极致体验，优先选择"原生弹框 + 不经手密码 + 失败报错清晰"三件套。这和当前 Electron 版相比，牺牲了一点点 UX 便利性（每次写都会弹提权框），换来了显著更小的攻击面和更简单的维护成本。

若未来有明确的用户反馈指向"静默写入"，再回头评估 macOS SMJobBless / Linux polkit policy install / Windows service 之类的长期解法，并为此专门开一份单独的 ADR。
