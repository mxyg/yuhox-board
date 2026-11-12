# Yuhox Board · 昱弘看板

![build](https://github.com/mxyg/yuhox-board/actions/workflows/build-windows.yml/badge.svg)

**一块大屏，实时数据，一眼看完。**

开源免费的实时屏幕数据动态显示软件。控制台留在主屏，画面全屏钉到你指定的任意一块显示器上；施工队伍、施工动态、完成进度，改一个字、推一条数据，大屏立刻跟着动。

- 平台：Windows 10/11（x64），macOS / Linux 亦可运行
- 许可：MIT，商用免费，可二次开发
- 依赖：无服务端、无账号、无联网要求，素材与数据全部本地

![大屏施工数据表](docs/images/screen-table.jpg)

## 它能做什么

| 能力 | 说明 |
|---|---|
| 指定显示器上屏 | 枚举所有显示器，选一块全屏输出；控制台仍在主屏，边改边看 |
| 列完全自定义 | 列头可改名、可拖拽调序、鼠标拖列缝调列宽、可增可删；序号列自动编号 |
| 单元格类型 | 文本列 + 进度列（输入 0–100，大屏自动画进度条并按完成度标色） |
| 手机遥控 | 同一 Wi-Fi 下手机浏览器打开即用，改动态、拖进度、改标题，无需装 App，可设口令 |
| 三种实时数据通道 | 控制台手动编辑 / HTTP 接口推送 / JSON 文件监听，局域网任何机器都能推 |
| 两种大屏版式 | 施工数据表（多列明细）、进度榜单（按进度排序） |
| 输入自动补全 | 填过的队伍、工序、动态自动记进历史，下次输入即刻联想 |
| Excel 互通 | 一键导出（表头与列宽一并导出）；导入按表头自动匹配列，陌生列自动新建 |
| 动态视觉 | 粒子与极光背景、流光光束、雷达环、扫描线、HUD 边角、标题扫光、行变更闪烁 |
| 长期驻留 | 开机自动启动（默认开）、启动自动回到上次大屏、托盘常驻、关窗不退出 |
| 现场可用性 | 黑屏待机、全局快捷键、显示器热插拔自动回落、上屏期间阻止熄屏、断网照常运行 |

主标题、副标题随时可改，控制台顶部和大屏左侧两个输入框任选其一，改完即刻同步。

![进度榜单](docs/images/screen-list.jpg)

![控制台](docs/images/control.jpg)

> **Windows 上屏前提**：显示设置里把第二块屏设为「扩展」而不是「复制」。复制模式下两块屏显示同一画面，系统层面就不存在“另一块屏”。

## 快速开始

### 使用安装包

到 [Releases](https://github.com/mxyg/yuhox-board/releases) 下载 `YuhoxBoard-Setup-x.y.z.exe` 安装，或使用免安装的 `YuhoxBoard-Portable-x.y.z.exe`。

1. 双击打开，控制台出现在主屏。
2. 「上屏控制」里选中目标显示器（点「识别显示器」会在每块屏上闪编号）。
3. 点「上屏」，画面全屏铺满那块屏。
4. 「看板内容」里逐格编辑数据，大屏实时跟随。

装完默认已开启「开机自动启动」：之后开机程序在右下角托盘待命，双击托盘图标唤出控制台，右键托盘可直接切屏、黑屏、撤屏、退出。

上过屏以后，下次启动会自动回到那块屏（可在「外观与动效」里关掉）；开机自启时也是同样行为，**开机即出画面**，控制台不弹窗。

### 手机遥控（不用装 App）

1. 控制台「实时数据源」里能看到一串地址，形如 `http://192.168.1.23:7788/m`
2. 手机连同一个 Wi-Fi，浏览器打开这个地址
3. 直接改：加/减 10% 进度、一键「完成」、改施工动态与队伍、改主副标题，改完立刻上大屏

人多眼杂的现场建议在同一个卡片里设个 4–12 位口令，手机首次打开需要输入。推送接口默认随软件启动，端口可在同一页改。

### 快捷键

| 按键 | 作用 |
|---|---|
| `Ctrl + Alt + B` | 黑屏待机 / 恢复画面 |
| `Ctrl + Alt + H` | 收起 / 唤出控制台 |
| `Ctrl + Alt + S` | 上屏 / 撤下大屏 |

快捷键全局生效（大屏全屏时也管用），可在设置里关闭；被别的软件占用时会自动跳过。

### 从源码运行

```bash
git clone https://github.com/mxyg/yuhox-board.git
cd yuhox-board
npm install
npm start
```

要求 Node.js ≥ 20。

### 打包 Windows 安装包

```bash
npm run dist:win     # 产物在 release/：NSIS 安装包 + 便携版
```

在 macOS 上交叉编译 Windows 包需要安装 wine。

## 实时数据接口

「实时数据源」里点「启动」，即在本机 `7788` 端口开一个 HTTP 接口（端口可改）。局域网内任何设备都能推数据。

```bash
# 推送数据（rows 全量替换；title / subtitle / columns / settings 可选）
curl -X POST http://192.168.1.10:7788/api/board \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "施工动态总览",
    "subtitle": "三号楼 · 当班",
    "rows": [
      { "team": "一号施工队", "act": "三层顶板钢筋绑扎", "prog": 72, "proc": "钢筋工程" },
      { "team": "机电班", "act": "一层桥架敷设与穿线", "prog": 38, "proc": "机电安装" }
    ]
  }'
```

```bash
# 读取当前看板
curl http://192.168.1.10:7788/api/board

# 只改某一行的一个单元格（手机遥控走的就是这条，不会覆盖别处改动）
curl -X POST http://192.168.1.10:7788/api/board \
  -H 'Content-Type: application/json' \
  -d '{ "rowPatch": { "id": "r1", "cells": { "prog": 88 } } }'

# 健康检查
curl http://192.168.1.10:7788/api/health
```

手机遥控页：浏览器打开 `http://192.168.1.10:7788/m`（`/` 会自动跳过去）。
设了口令后，接口需要带 `x-board-pin` 请求头或 `?pin=xxxx`。

`rows` 里的键就是列 `key`（默认 `team` / `act` / `prog` / `proc`，`idx` 为自动序号列）。
`prog` 为 0–100 的整数，非数字会被清洗后钳到区间内。

网页端可以直接调（接口已开 CORS）：

```js
await fetch('http://192.168.1.10:7788/api/board', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ rows: [{ team: '三号施工队', act: '四层砌体样板段', prog: 46, proc: '砌体工程' }] })
});
```

### JSON 文件监听

选一个 JSON 文件后，文件内容一变（保存即触发）大屏就更新。文件内容可以是行数组，也可以是完整看板对象：

```json
[
  { "team": "焊接班", "act": "管道焊接", "prog": 55, "proc": "焊接工程" }
]
```

适合配合 Excel 导出、Python 脚本、MES 落盘等任何能写文件的工具。

## 看板数据格式

```json
{
  "title": "施工动态总览",
  "subtitle": "YUHOX · 现场实时进度",
  "columns": [
    { "key": "idx",  "label": "序号",     "type": "index",    "width": 60,  "visible": true },
    { "key": "team", "label": "施工队伍", "type": "text",     "width": 150, "visible": true },
    { "key": "act",  "label": "施工动态", "type": "text",     "width": 290, "visible": true },
    { "key": "prog", "label": "施工进度", "type": "progress", "width": 190, "visible": true },
    { "key": "proc", "label": "施工工序", "type": "text",     "width": 130, "visible": true }
  ],
  "rows": [
    { "id": "r1", "cells": { "team": "一号施工队", "act": "三层顶板钢筋绑扎", "prog": 72, "proc": "钢筋工程" } }
  ],
  "dict": { "team": ["一号施工队", "机电班"] },
  "settings": {
    "accent": "#4f8cff",
    "accent2": "#22d3ee",
    "showClock": true,
    "showSummary": true,
    "zebra": true,
    "autoScroll": true,
    "scrollSpeed": 36,
    "layout": "table",
    "fontScale": 1,
    "autoLaunch": true,
    "autoRestoreOutput": true,
    "lastDisplayId": 2,
    "hotkeys": true,
    "serverAuto": true,
    "mobilePin": "",
    "tickers": ["每周五 17:00 例会同步进度"]
  }
}
```

- `columns[].type`：`index`（自动序号）/ `text` / `progress`。
- `columns[].width` 为设计宽度，控制台与大屏按同一比例分配，拖列宽两边同步。
- `layout`：`table` 施工数据表 / `list` 进度榜单。`tickers` 为底部滚动字幕，每行一条。
- `fontScale`：大屏字号缩放，0.8–1.5。
- `autoRestoreOutput` + `lastDisplayId`：启动后自动回到上次上屏的那块屏。
- `hotkeys` / `serverAuto`：全局快捷键、推送接口随软件启动。
- `mobilePin`：手机遥控口令，空字符串表示不校验。
- `dict` 是输入历史，控制台自动维护，也可用接口写入更多候选值。
- 旧版 `tasks` 数据在首次启动时自动迁移成默认五列，不丢内容。

## 数据与备份

| 运行方式 | 数据位置 |
|---|---|
| 安装版 | `%APPDATA%\yuhox-board\board.json` |
| 便携版 | `exe 同目录\YuhoxBoardData\board.json` |

- 每次启动自动备份到同级 `backup\` 目录，半小时内不重复、最多保留 5 份，误改可从这里捞回。
- 便携版整个文件夹拷到另一台电脑就能接着用，数据、列结构、口令一起带走；也可以用「导出 JSON → 导入 JSON 备份」搬。
- 控制台「外观与动效 → 数据与维护」里能看到当前路径，也能一键打开目录、导入备份、恢复示例数据或清空数据。

## 技术架构

```
主进程 (src/main)
 ├─ 显示器枚举 / 输出窗口落位（screen API，无边框全屏）
 ├─ 看板状态唯一真源（store.js，落盘 userData/board.json）
 ├─ 本地 HTTP 推送服务（server.js）
 ├─ Excel 读写在主进程（excel.js，SheetJS）
 ├─ JSON 文件监听（fs.watchFile 轮询 + 防抖）
 ├─ 托盘与开机自启（Tray + setLoginItemSettings）
 └─ 广播 board:updated / status:updated 到所有窗口
        │
        ├── 控制台窗口 (src/renderer/control)  编辑与指挥
        └── 大屏窗口   (src/renderer/output)   只渲染，不交互
```

- 大屏与控制台不共享页面状态，一切经主进程广播，多显示器 / 多窗口天然一致。
- 大屏窗口设置 `backgroundThrottling: false`，被遮挡时动画不降帧；滚动按时间推进，节流下速度依旧恒定。
- 大屏渲染按行 id 做差异化更新，只改变化的单元格，数据量大也不闪屏。
- 断网可用：除 HTTP 推送外无任何外部请求。

## 目录

```
src/main/index.js      主进程：窗口、显示器、托盘、快捷键、开机自启、IPC、文件监听
src/main/store.js      看板状态、规范化与迁移、持久化与备份
src/main/server.js     HTTP 推送接口 + 手机遥控页路由
src/main/mobile.html   手机遥控页（单文件，无外部依赖）
src/main/excel.js      Excel / CSV 导入导出
src/preload/index.js   contextBridge 白名单
src/renderer/control   控制台（数据表编辑器、列设置、外观、数据维护）
src/renderer/output    大屏（表格 / 榜单、装饰动效）
test/smoke.js          渲染冒烟测试（截图）
test/e2e.mjs           端到端测试（CDP 驱动）
test/store-test.cjs    数据层测试（无需窗口）
test/server-test.cjs   HTTP 接口测试（无需窗口）
test/ui-ids-test.cjs   界面 id 引用一致性检查
test/excel-test.mjs    Excel 往返测试
```

## 测试

```bash
# 无窗口测试（数据层 / HTTP 接口 / 界面 id），CI 里也跑这一套
npm test

# 冒烟：渲染两个界面并截图到 docs/images/
npx electron test/smoke.js

# 端到端：需先带调试端口启动应用
npx electron . --remote-debugging-port=9333 &
node test/e2e.mjs

# Excel 导出 → 读回
node test/excel-test.mjs
```

## 发版

```bash
# 本机出 Windows 包（CI 会在 windows-latest 上做同样的事）
npm run dist:win

# 走公司运维台一键发布（编译台构建）
node ai.mjs release board --version 1.2.0 --notes "手机遥控 + 开机即出画面" --wait
```

## 许可

MIT License。允许商用、修改、再分发；请保留版权声明。见 [LICENSE](LICENSE)。

---

辽宁昱弘智能科技有限公司 · YUHOX
