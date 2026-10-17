# 墨阅 · MoYue Reader

一个安静、干净的本地电子书阅读器。支持 **EPUB / MOBI / AZW3 / PDF / TXT**，书籍、阅读进度、书签与笔记全部保存在浏览器本地，不上传任何数据。

## 功能

- **五种格式**
  - EPUB / MOBI / AZW3：使用纯 JavaScript 解析与渲染，支持目录、分页/滚动阅读、CFI 定位。
  - TXT：自动识别 UTF-8 / GB18030 / UTF-16，按章节标题智能分章；无章节时按段落切分。
  - PDF：基于 PDF.js 连续滚动阅读，带文字层、缩放、目录、跨页搜索、文字高亮与朗读。
  - 非 DRM 文件；扫描版 PDF 没有文字层，因此搜索与朗读不可用。
- **本地书架**：拖拽或选择本地文件导入，自动提取封面与元数据；支持搜索、格式筛选、排序、查看详情与移除。
- **阅读进度**：自动保存阅读位置，书架显示进度与“继续阅读”入口；刷新、关闭浏览器后仍会保留。
- **排版与主题**：纸白、米黄、青瓷、暮色、深夜五种主题；宋体/黑体/楷体；字号、行距、版心宽度、两端对齐；支持左右分页与连续滚动。
- **目录与搜索**：完整多级目录；全书搜索，结果按章节/页码分组并可跳转。
- **高亮、笔记与书签**：划词后四色高亮、写笔记、复制、发起搜索；支持侧栏管理，点击定位回原文。EPUB/MOBI/AZW3/TXT 使用 CFI，PDF 使用归一化坐标，缩放后仍能对齐。
- **朗读**：调用系统语音（Web Speech API），按句朗读、高亮当前句，支持暂停、上一句/下一句、语速与声音选择。
- **阅读器交互**：沉浸阅读、键盘快捷键、移动端适配、深浅色界面。

## 快速开始

环境要求：Node.js 20+（推荐 24），现代浏览器（推荐最新版 Chrome / Edge）。

```bash
npm install
npm run dev
```

打开 http://127.0.0.1:5173 。

生产构建与本地服务：

```bash
npm run build
npm run preview        # Vite 预览，http://127.0.0.1:5173
# 或
npm start              # 使用 server.mjs 提供 dist 静态服务，http://127.0.0.1:5173
```

> **数据存储在同一浏览器、同一源（协议 + 主机 + 端口）下。** 开发、预览与生产服务都默认使用 `http://127.0.0.1:5173`，请固定使用该地址打开；换成 `localhost` 或其他端口会被浏览器视为另一个站点，书架会显示为空。清除站点数据也会删除全部书籍与笔记。

## 使用说明

1. 点击「导入书籍」，或把电子书拖到书架任意位置；支持一次导入多本。
2. 打开一本书后，点击上部图标打开目录、搜索、笔记与设置；点击正文中间以外的文字可阅读，划词会浮出高亮工具栏。
3. 顶部书签按钮记录当前位置；按 `B` 亦可。
4. 朗读依赖操作系统提供的语音。Windows 可在「设置 → 时间和语言 → 语音」中安装更多语音；声音与语速可在阅读设置里调整。
5. 阅读设置会即时生效并保存在浏览器中；每本书的阅读位置单独保存。

## 快捷键

| 按键 | 功能 |
| --- | --- |
| `→` / 空格 / `PageDown` | 下一页 |
| `←` / `PageUp` | 上一页 |
| `Home` / `End` | 跳到书首 / 书尾 |
| `T` | 目录 |
| `N` | 笔记 |
| `S` / `Ctrl+F` / `⌘F` | 全书搜索 |
| `B` | 添加 / 移除当前位置书签 |
| `R` | 开始 / 暂停朗读 |
| `F` | 沉浸阅读 |
| `+` / `-` | 调整字号（PDF 为缩放） |
| `?` | 快捷键说明 |
| `Esc` | 关闭面板 / 退出沉浸 |

## 目录结构

```text
src/
  components/
    Library.tsx            书架首页
    BookCard.tsx           书籍卡片
    BookDialogs.tsx        详情与删除确认
    reader/
      Reader.tsx           阅读器外壳与状态
      Panels.tsx           目录 / 笔记 / 书签 / 搜索
      SettingsPanel.tsx    阅读设置
      NoteDialog.tsx       笔记编辑
      SelectionToolbar.tsx 划词工具栏与批注卡
      TTSBar.tsx           朗读控制条
      ShortcutsDialog.tsx  快捷键
  lib/
    db.ts                  IndexedDB 存储
    importer.ts            导入、元数据与封面
    cover.ts               无封面时的程序化封面
    txt.ts                 TXT 解码、分章与书籍对象
    foliateEngine.ts       EPUB/MOBI/AZW3 引擎封装
    pdfEngine.ts           PDF 阅读引擎
    pdf.ts                 PDF.js 加载与目录
    sentences.ts           分句、语言与语音工具
    themes.ts              主题与默认设置
    readerStyles.ts        注入书页的排版样式
  vendor/foliate/          foliate-js（MIT）精简后的渲染核心
public/
  pdfjs/                   PDF.js 的 CMap 与标准字体
  samples/                 内置示例短文
server.mjs                 生产静态服务
```

## 技术栈与致谢

- [foliate-js](https://github.com/johnfactotum/foliate-js)（MIT）：EPUB / MOBI / KF8 解析、分页与 CFI 定位。本项目对其做了裁剪，并移除了书内 iframe 的脚本权限。
- [PDF.js](https://mozilla.github.io/pdf.js/)（Apache-2.0）：PDF 渲染、文字层与目录。
- React、TypeScript、Vite、lucide-react、idb、fflate、@zip.js/zip.js。

## 限制

- 不支持带 DRM 的电子书。
- 扫描版 PDF 无文字层，无法搜索/朗读；复杂排版、注释与表单不做完整还原。
- 固定版式 EPUB 可阅读，但高亮与笔记仅对可重排内容开放。
- 所有数据仅在本机浏览器内，不提供云同步；请通过浏览器数据备份手段自行备份（本项目未实现导出功能）。
