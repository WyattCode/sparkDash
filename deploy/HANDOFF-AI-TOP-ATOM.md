# AI TOP ATOM / sparkDash 部署交接

更新时间：2026-10-09 02:00（Asia/Taipei），最终图标修正后复核。工作目录 `/home/wyatt/sparkDash`。

## 当前交付状态

访问地址：http://192.168.10.124:5555/ 。已部署中文改版、双机监控、AI TOP ATOM 设备名称、青蓝主题和四台设备线框装饰。

| 节点 | 管理地址 | CX7 地址 | 角色 | 采集 |
| --- | --- | --- | --- | --- |
| AI TOP ATOM · aaa0 (Head) | 192.168.10.124 | 10.77.0.1 | head | 本机 /proc、/sys、nvidia-smi；模型 API 8888 |
| AI TOP ATOM · 0130 (Worker) | 192.168.10.189 | 10.77.0.2 | worker | SSH 硬件采集，workerHeadId=local-spark |

Worker 的模型名称由 Head 派生；不单独探测 Worker 的 8888 端口。设备配置在 `config/sparks.json`，界面设置在 `config/settings.json`。两台设备均已验证在线。

## 必须理解的版本边界

- 仓库：`https://github.com/WyattCode/sparkDash.git`。
- 后端和可编辑 React 源码：`feat/zh-ui-hardening-20260914`，基线提交 `6c2dbde4d824d41f25dd4b3be289a2da7b3e631a`。
- 当前线上前端来自用户指定的 `http://192.168.10.233:5555/` 的已构建资源，之后做了名称替换、主题和 SVG 定制。
- `.233` 的 SSH 登录失败，**尚未取得它对应的前端源码或后端版本**。当前 `src/` 不等于线上前端的完整源码。
- **直接运行 `npm run build` 会覆盖已确认的线上界面。** 不要把分支构建结果直接当成当前交付版本。
- 本轮修改及交接包随本次提交交付到当前改版分支；后端基线提交仍为上述 6c2dbde。

## 前端文件与定制约束

| 文件 | 用途 |
| --- | --- |
| `public/atom-theme.css` | 青蓝主题变量与装饰图样式的可编辑文件 |
| `public/atom-device.svg` | 真机格栅、波浪、网孔的简化线框图 |
| `dist/index.html` | 当前生产入口，加载定制 JS 与主题覆盖层 |
| `dist/assets/index-atom-1c89a7ef6e.js` | `.233` 的构建 JS，替换品牌文字后的生产文件 |
| `dist/assets/index-ZorAO5mU.css` | `.233` 原版布局及动画，不修改几何布局 |
| `deploy/ai-top-atom/frontend.tar.gz` | 当前确认版本的完整前端快照，不含运行配置与密钥 |
| `deploy/ai-top-atom/manifest.json` | 快照及其 11 个资源的 SHA-256 校验值 |
| `deploy/ai-top-atom/restore-frontend.py` | 校验并恢复快照，入口最后替换，先备份现有 dist |
| `deploy/ai-top-atom/sparkdash.service` | 当前用户服务配置副本 |

用户确认的边界：四台装饰设备保持原来的方向、尺寸、间距、排列和动画；只改造型细节。不能再为了符合产品照片视角，把它们改成横向排列或改变占位。主题大框的字号、间距和高度沿用 `.233` 原版；模型信息区透明，融入同一背景。格栅最前、波浪肋条在后、细网孔更后；不是照片级精确描摹。

深色使用海军蓝底、冰白文字、青蓝高光；白色使用冷白底、蓝灰边框。原金属色变量 `--dgx-metal` 和 `--dgx-glow` 必须一起覆盖，否则网格、动画、阴影会残留金色。告警颜色保持状态语义。

修改主题或 SVG 后：复制 `public/atom-*` 到 `dist/`，更新 CSS 内 SVG 的版本查询参数和入口里的 CSS 版本参数，再刷新浏览器检查。随后重新生成快照及所有 SHA-256；当前恢复脚本会拒绝与清单不一致的快照。不要只改 public 后认为已经上线。

产品参考原图：`/home/wyatt/Desktop/product.png`。当前装饰采用代码原生 SVG，不依赖远程图片服务。

## 运行方式

使用用户级 systemd，未使用 Docker：当前用户无法直接访问 Docker socket，sudo 需要密码。Node.js 安装于用户目录，版本 v24.21.0，ARM64；下载时已校验官方 SHA-256。

- 实际服务文件：`/home/wyatt/.config/systemd/user/sparkdash.service`。
- Node：`/home/wyatt/.local/opt/node/bin/node`。
- 服务启用开机启动、`Restart=always`、5 秒重启间隔；用户 `Linger=yes`，无需保持登录。
- 监听 `0.0.0.0:5555`；`SPARKDASH_ALLOW_OPEN_REMOTE=1`，当前局域网无需登录。
- 本机 `HOST_SYS_PATH=/sys`、`HOST_ROOT_PATH=/`。**不要设置 `HOST_PROC_PATH=/proc`**：当前采集器会误认为运行在容器中并调用 nsenter，普通用户无权进入 PID 1 命名空间。保持默认不存在的 `/host/proc`，使采集器回退到本机读取。
- SSH 用户 wyatt；`~/.ssh/config` 将 `192.168.10.189` 映射到 `10.77.0.2`，使用 `~/.ssh/id_ed25519_tensorfold`。因此远程采集依赖直连链路，不只是 Wi-Fi 地址。

```bash
systemctl --user status sparkdash --no-pager
systemctl --user restart sparkdash
journalctl --user -u sparkdash -n 80 --no-pager
curl -fsS http://127.0.0.1:5555/api/health
curl -fsS http://127.0.0.1:5555/api/sparks
curl -fsS http://127.0.0.1:5555/api/sparks/local-spark/metrics
curl -fsS http://127.0.0.1:5555/api/sparks/spark-0130/metrics
ssh -o BatchMode=yes -o ConnectTimeout=5 wyatt@192.168.10.189 hostname
```

运行配置、SSH 私钥和 `config/.secrets-key` 均不能放入 Git 或前端快照。当前 `remote-open` 允许可达客户端读写 API，部署没有应用登录；不要未经另行配置直接暴露公网。`SSH identity is not mounted` 健康警告只检查默认密钥文件，未识别 SSH config 的自定义密钥，并不表示 Worker 连接失败。首次使用 secrets store 前未生成 secrets key 属于预期状态。

## 验证与复核结论

本轮复核覆盖代码差异、主题/SVG、服务配置、关键采集与认证路径、源码测试和线上浏览器渲染；不是对所有代码路径或所有操作做穷举验证。

- TypeScript 类型检查通过；分支源码隔离构建通过，未覆盖生产 dist。构建有单个 JS chunk 超过 500 kB 的提示，属于优化项。
- 后端 383/383 测试通过。
- 前端 235/235 测试通过（39 个文件）。这些测试验证仓库源码，不能替代 `.233` 构建资源的完整测试。
- 修正 `server/sparks/__tests__/fleet-energy.test.js` 的历史测试时钟：样本固定在 2026-08-23，而 flush 使用实际日期；超过 31 天后样本被正常清理，断言失败。为该测试注入同一时间轴的 now，未修改生产能耗逻辑。
- 浏览器检查深色/白色主题；桌面 1440px 下主题框高 322.109375px，与停用主题覆盖层后的原版一致。
- 390、768、1440px，深色/白色共六组浏览器检查均无横向溢出，无 pageerror。桌面装饰单机 58.25×175px，手机 38.25×130px；偶数设备保留原来的 15px 错位。
- 实际资源请求成功、两台设备在线，API 和 WebSocket 已验证可用。用户服务 active、enabled、Linger=yes。
- 交付快照恢复脚本已在本机实测成功，校验全部 11 个文件，并留下 `.dist-backup-*` 原版本备份。
- 未执行关机、唤醒、模型更新或压力测试等可能影响正在运行工作负载的操作。

## 恢复、升级与备份

恢复当前已确认前端：

```bash
cd /home/wyatt/sparkDash
python3 deploy/ai-top-atom/restore-frontend.py
```

脚本校验归档和文件内容，先将原 dist 备份到 `.dist-backup-时间戳`，再恢复资源，最后替换入口；不会改变 `config/`。静态资源无需重启 Node。刷新浏览器即可。

依赖更新或迁移前先备份 `config/`（包含可能存在的加密密钥及 secrets），保存 SSH 配置和服务文件；备份必须限制访问权限。生产 dist、现有配置与密钥缺一不可。`frontend.tar.gz` 仅恢复界面，不能恢复主机配置。

源码验证命令（不要把构建命令直接用于当前生产 dist）：

```bash
export PATH=/home/wyatt/.local/opt/node/bin:$PATH
npm run typecheck
npm run test:server
npm run test:frontend
# 如需检查分支是否能构建，输出到临时目录，避免覆盖生产资源：
npm run build -- --outDir /tmp/sparkdash-source-build
```

后续真正源码化的首要工作：从 `.233` 所有者处取得运行版本的完整源码/提交，将现有前端改动回迁到其 React/CSS 源文件，再正常构建和比对；当前快照是可恢复的交付包，不代表已经完成源码对齐。不能用 main 或当前分支的旧布局替代它。

更新运行服务配置后执行 `systemctl --user daemon-reload`，再重启服务。迁移主机时需要调整服务绝对路径、节点地址和 SSH 配置，原样照搬路径不适用于其他用户。

## 本轮改动清单

- 增加 `public/atom-theme.css`、`public/atom-device.svg`。
- 增加部署快照、校验清单、恢复脚本及服务配置副本。
- 修改 `config/settings.json` 为用户参考站的舒适密度等设置；节点配置独立保存。
- 修复一个使用过期固定日期的测试。
- `.gitignore` 补充运行连接日志和本地前端恢复备份，避免误提交。
- 本文为交接主入口；既有 README 的 Docker 流程不代表本机当前部署方式。

## 最终图标配置

- 浏览器标签 favicon 使用 `.233` 原始的透明背景、24×24 闪电 data URI，仅 stroke 从 `#e8a830` 改为 `#70d8f5`；没有方形底色，形状、描边宽度和 path 不变。已从两站实际返回的 HTML 自动比对确认。
- `index.html` 与 `dist/index.html` 均保持上述最终配置。
- `public/icons/sparkdash.svg` 及 192/512 PNG、maskable PNG 用于应用/主屏幕图标：海军蓝底 `#111c30`、青蓝闪电 `#70d8f5`，沿用原有闪电形状。浏览器 favicon 不引用这张带底 SVG。
- Apple touch icon 与 manifest 图标 URL 带 `atom-cyan-1` 版本参数；manifest 的 theme/background 颜色及 HTML theme-color 已同步海军蓝。
- `public/manifest.webmanifest` 是可编辑源，`dist/manifest.webmanifest` 是当前生产文件。已安装应用的旧图标更新受浏览器/系统缓存影响，页面刷新不保证桌面快捷方式立即换图。

## 最终二次复核记录

日期：2026-10-09 02:00（Asia/Taipei）。没有再次调整已确认的视觉设计和生产配置。

| 检查 | 结果 |
| --- | --- |
| `git diff --check` | 通过 |
| `npm run typecheck` | 通过 |
| `npm test` 后端 | 383/383 通过 |
| `npm test` 前端 | 235/235 通过，39 个文件 |
| 分支源码构建到 `/tmp/sparkdash-final-source-build` | 通过；生产 dist 未被覆盖 |
| 浏览器 1440/768/390px × 深色/白色 | 六组无横向溢出，无页面 JS 异常 |
| favicon 与 `.233` 比对 | 除描边颜色外完全一致 |
| 线上资源与本地快照清单 | 11 个文件 SHA-256 全部一致 |
| 在临时目录恢复快照 | 成功；恢复后逐文件校验通过 |
| 损坏归档的恢复测试 | 被拒绝，已有入口未被修改 |
| 双机指标 | Head 和 Worker 均在线 |
| systemd | active、enabled；Linger=yes |

恢复脚本使用本机 Python 3.12.3；迁移时使用 Python 3.12 或更高版本，确保支持 `tarfile.extractall(filter='data')`。恢复脚本本身及交接文档不包含在前端归档内，迁移须一起携带 `deploy/ai-top-atom/` 文件夹。

构建提示单个 JS chunk 超过 500 kB，属于性能优化事项；未为消除提示修改用户已确认的界面。

复核范围包括本轮全部本地改动，以及相关运行、配置、恢复与采集路径。已构建的第三方前端没有完整对应源码，无法据此宣称完成该产物所有内部代码路径的源码审计；仓库测试同样不覆盖用户不可获得的那部分源码。后续源码对齐仍按上文版本边界处理。

本轮最终验证日志保存在本机 `/tmp/sparkdash-final-{typecheck,tests,build,browser}.log`，临时目录可能被清理，不能将日志当作持久交付件。文档中的结果和快照清单是交接记录。最终复核后的改动及本交接记录包含在同一 Git 提交中。
