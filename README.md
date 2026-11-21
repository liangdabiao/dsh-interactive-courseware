# dsh-interactive-courseware 课件放映厅

把一节课的讲义交给 agent，还你一套能直接上课的翻页互动课件——**播放器、页面骨架、打包脚本、机械盘点、单文件打包、档案预览**全部内置，零 API 密钥。

```
你的课件/
├── page-01.html … page-0N.html   # 每一页是一个独立的网页
├── index.html                     # 播放器：方向键翻页、进度条、目录、全屏、静音
└── 课件.html                      # 打包成的单文件版，发给别人双击就能打开
```

课堂投影、触控一体机、学生自学（电脑/平板/手机）都适用：三米外看得清、手指点得准。

## 安装

```bash
dsh plugin --profile web add https://github.com/liangdabiao/dsh-interactive-courseware
```

## 用法

侧栏打开「**课件放映厅**」→ 发起制作 → 把讲义内容粘进去（或一句话说清需求）→ agent 先出《课件设计蓝图》给你确认 → 确认后一口气生成全部页面 → 打包存证 → 回面板翻页预览。

也可以直接在对话里说：

> 这是《阿基米德与浮力》一节课的讲义，帮我做成互动课件

## 这套方法讲究什么

核心几条（完整方法论在 `skills/interactive-courseware/SKILL.md`，随插件分发，agent 按需加载）：

- **页面只放内容** —— 标题栏、页码、进度条、翻页按钮全部由播放器提供，页面里不重复画。
- **一屏一页，主体要大** —— 横屏不滚动，所有尺寸用 rem 跟着屏幕等比缩放。
- **全课只有一种强调色** —— 一个底色 + 一种强调色 + 黑白灰文字，颜色越少越高级。
- **游戏机制 = 知识点的思维动作** —— 把游戏的皮剥掉只剩选择题，就重新设计。
- **3D 默认不用** —— 只有立体结构非 3D 不可时才用，一节课不超过两三页。
- **老师随时能跳页** —— 游戏不锁翻页，公开课上不怕被某一页卡住。

工作流三阶段：**① 设计蓝图（停下等确认）→ ② 生成页面 → ③ 装进播放器**。蓝图方向错了不用返工。

## 插件提供了什么

| 层 | 内容 |
|---|---|
| 技能快照 | interactive-courseware SKILL.md 原文 + 三段固定代码（player.html / page-template.html / pack.py）+ 两套真实成品范例 |
| 工具 `courseware` | `scaffold` 落三段固定代码（只复制不修改，已存在不覆盖）；`check` 机械红线盘点（DECK 解析、页面齐全、title 格式、三段公共一致、色值直写、外链图、Emoji、hidden 兜底——硬错误阻塞、warn 不阻塞）；`pack` 打包单文件（Node 版 pack.py，无 Python 也能跑）；`save` 存证；`serve` 预览服务；`archive/history/delete/restore` 档案管理 |
| 面板「课件放映厅」 | 概览 / 发起制作 / 课件档案（删除可恢复）/ 课件预览（iframe 嵌真实播放器翻页）/ 档案历史 / 制作规范 |
| 内置示例 | 《阿基米德与浮力》《勾股定理双证记》两套真实成品课件，装好即可在面板里翻页试玩 |

**职责边界**：创作归 LLM + skill，程序只拦机械事故 + 格式约定（warn 不阻塞）；文案、题目、配色判断都是 agent 的事。

## 开发

```bash
npm install
npm run build     # 面板 bundle → dist/client.js
npm test          # lib 层单测（33 项）+ 面板前端回归（7 项，vm + DOM 桩，沙盒）
npm run smoke     # E2E 冒烟（全动作 + 真实示例 + 预览服务可达性；自动挑空闲端口，插件正在跑也能测）
npm run panel     # 面板开发预览 http://127.0.0.1:8899/dsh-interactive-courseware/
```

## 致谢

- 技能方法与三段固定代码来自 [threejs-ware / interactive-courseware](https://github.com/liangdabiao/interactive-courseware)
- 社区支持：[linux.do](https://linux.do)
- 参考文章：[把讲义变成互动课件](https://mp.weixin.qq.com/s/1aVZqBSpDuNGqiPPPpXijA)

## 许可

插件代码 MIT。内置示例课件版权归 original 作者所有（CC BY-NC 4.0 精神），勿直接商用。
