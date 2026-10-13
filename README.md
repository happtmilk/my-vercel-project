# 论文写作与选刊工作台

纯前端、**零运行时依赖**、可直接静态部署的单页应用（SPA）。用于：
论文草稿章节化写作 → 期刊录用目录导入 → 主题偏好画像 → 选刊 fit 打分 → 计量分析。

- 技术栈：原生 HTML / CSS / JavaScript（vanilla），**无框架、无构建工具、无 npm 运行时依赖**
- 数据存储：浏览器 `localStorage`，键名统一前缀 `paperwb_`
- 网络：**不发起任何跨域请求**，无后端；内置解析库全部本地化，可完全离线使用

---

## 一、目录结构

```
.
├── index.html                  # 唯一页面：按顺序引入 vendor → 业务脚本
├── css/
│   └── style.css               # 手写样式（浅色主题）
├── js/
│   ├── vendor/
│   │   ├── xlsx.full.min.js        # SheetJS 0.18.5（解析 Excel，本地离线）
│   │   └── mammoth.browser.min.js  # mammoth 1.6.0（解析 Word .docx，本地离线）
│   ├── util.js                 # DOM 工具 / 中文 2~4 字 n-gram 分词 / 停用词 / cleanTerms / 字数统计 / CSV
│   ├── store.js                # localStorage 持久层（paperwb_ 前缀、导出导入、占用统计）
│   ├── importer.js             # readImportedFile(file, mode) 统一文件导入 + parseCore 纯函数内核
│   ├── toc.js                  # 录用目录(TOC)解析 + 画像引擎 + 内置示例数据
│   ├── match.js                # 选刊相似度算法（加权重叠 + 饱和函数 + 5:5 融合）
│   ├── stats.js                # 计量分析（描述统计 / 相关 / OLS 回归）
│   ├── pages.js                # 8 个页面：function XxxPage(root, param) {...}
│   └── app.js                  # PAGES 路由映射 + 哈希路由 + 启动
├── test/
│   ├── test.mjs                # Node + jsdom 集成测试（37 项，含文件导入/画像/打分/排序）
│   ├── smoke.mjs               # 冒烟测试：遍历 8 个页面并点击全部安全按钮，断言控制台无报错
│   └── package.json            # 仅测试用的 devDependencies（jsdom / xlsx）
└── README.md
```

脚本引入顺序（`index.html` 中固定，顺序敏感）：

```
xlsx → mammoth → util → store → importer → toc → match → stats → pages → app
```

---

## 二、本地运行

**方式 1：直接双击**
双击 `index.html` 用浏览器打开即可（`file://` 协议下所有功能正常，包括 Excel/Word 解析与本地存储）。

> 若浏览器把 `file://` 视为受限源而禁用了 `localStorage`（个别安全策略较严的版本），
> 应用会自动降级为**内存存储**：功能照常可用，只是关闭页面后数据不保留 —— 此时请用
> 「数据与关于 → 导出全部数据 JSON」备份，或改用下面的方式 2。

**方式 2：本地静态服务器**（体验更接近线上）

```bash
# 任选其一
python -m http.server 8080
npx serve .
```

然后访问 `http://localhost:8080`。

---

## 三、部署（静态托管）

### Netlify Drop（最快，得到长期链接）
1. 打开 <https://app.netlify.com/drop>
2. 把**整个项目文件夹**拖进页面（含 `index.html`、`css/`、`js/`）
3. 几秒后即得到形如 `https://xxxx.netlify.app` 的长期链接，可直接分享

### GitHub Pages
1. 新建一个 **Public** 仓库，把全部文件上传（保留目录结构）
2. 仓库 → **Settings → Pages**
3. Source 选 **Deploy from a branch**，Branch 选 **main**，目录选 **/(root)**，保存
4. 稍等 1–2 分钟，访问 `https://<用户名>.github.io/<仓库名>/`

> 其它同等方案：Vercel、Cloudflare Pages、Gitee Pages、对象存储静态网站托管等，都是拖文件即可。

### 关于数据与隐私
- 所有用户数据（期刊、画像、草稿、数据集、任务、资料）都存放在**各自浏览器**的 `localStorage` 中，键名前缀 `paperwb_`。
- 不同用户之间数据互不干扰；分享链接不会泄露任何个人数据（部署包内只有代码和示例数据）。
- 换电脑/换浏览器请用「数据与关于 → 导出全部数据 JSON」备份，再在新环境导入。
- `localStorage` 通常上限约 5MB，页面底部「数据与关于」会实时显示占用。

---

## 四、核心功能与算法

### 1. 写作模块
- 草稿列表 + 章节化管理（增删章节、上下移动、章节改名）
- **实时字数统计**：中文字符数 + 英文单词数（`Util.countWords`）
- 自动保存到 `paperwb_drafts`；支持导出 Markdown、一键把标题/关键词/摘要送到「选刊分析」

### 2. 期刊库模块
- 期刊条目：名称、领域、备注、历年录用目录、画像
- 列表工具条：**全选 / 批量删除 / 导入录用目录 / 载入示例 / 新增**
- 导入录用目录：**双模式**——① 粘贴文本（也支持从 Excel 直接复制的制表符表格）② 上传文件（`.xlsx/.xls/.docx/.csv/.tsv/.txt`，旧版 `.doc` 提示另存为 `.docx`）
- 去重追加或覆盖重建，导入后自动重算画像

### 3. 画像引擎（`js/toc.js`）

```
标题文本
  → 中文 2~4 字滑窗 n-gram（+ 英文/数字词小写化）
  → 停用词过滤（词级停用表 + 首尾停用字过滤，压掉"的/基于"类噪声）
  → cleanTerms 去碎片：短词 t 被更长词 s 完全包含，且 freq(s) ≥ ratio × freq(t)、freq(s) ≥ minSupport(=2) → 丢弃 t
  → 按「年/期」切分目录（同时生成期次级画像）
  → 聚合词频并归一化为权重 { term: 0~1 }
```

> `minSupport` 的作用：只出现 1 次的更长词往往是跨词边界的噪声 n-gram（如「肺结节自动检测」切出的`肺结节自`），
> 不能让它吃掉真正的主题词`肺结节`，因此频次不足的长词不参与"去碎片"判定。

**期次识别正则**支持：`YYYY年第N期`、`Vol.15 No.3`、`2021,3`、`2021-3`、`第3期`（沿用上方年份）、**纯年份顺推期次**。

**表格解析策略**：
1. 优先在前 5 行里找表头（含「年/期/标题/作者/关键词」等中英字段，至少命中 2 列）
2. 无表头 → 按列序 `0=年, 1=期, 2=标题`
3. 连标题列都没有 → 每个单元格当一行文本走自由格式解析
4. 二维数组直接解析（避免 CSV 引号问题），文本按行解析

### 4. 选刊相似度（`js/match.js`）

```
fit = 100 × ( wBase × 基础匹配分 + wSim × 画像相似度 )      // 默认 5:5 融合

基础匹配分 = 1 - exp(-Kb × pCover)     pCover = 命中画像词权重和 / 画像权重总和
画像相似度 = 1 - exp(-Kp × pPrec)      pPrec  = Σ 论文高频词归一权重 × 画像中该词权重
```

- 两路都经饱和函数 `1-exp(-k·x)` 压缩到 0~1，天然抑制长文本的通胀
- 输出 0–100 的 fit 分，按分排序推荐，并展示**命中关键词**、两路分数条、**最接近的历史期次**
- 融合权重可用滑块实时调整（基础匹配分 ↔ 画像相似度）
- 结果可导出 CSV

### 5. 计量分析模块（`js/stats.js`)
- 数据导入：复用统一文件导入（Excel/CSV/TSV/TXT）+ 直接粘贴表格
- 描述统计：n、缺失、均值、标准差、变异系数、最小值、Q1、中位数、Q3、最大值、极差
- 相关性：Pearson 相关系数矩阵（成对剔除缺失，含 p 值与 `* / ** / ***` 显著性标记）
- 建模：多元线性回归（OLS，正规方程 + 高斯消元），输出系数、标准误、t 值、p 值、R²、调整 R²、RMSE，并给出回归方程
- 导出：原始数据 / 描述统计 / 相关系数矩阵 / 回归结果均支持导出 CSV（带 BOM，Excel 打开不乱码）

### 6. 辅助模块
- **研究进度看板**：任务看板（待开始/进行中/已完成/阻塞）、总体进度条、逾期高亮、导出 CSV
- **资料库**：文献/笔记/链接/数据/分析五类，支持检索、JSON 导出
- **文献检索**：一键跳转 Google Scholar / 知网 / PubMed / arXiv / Semantic Scholar / 万方（**纯链接跳转，不做后台请求**），并支持在本地资料库与全部期刊目录中检索
- **数据与关于**：存储占用、全量备份导出/导入、清空本应用数据

---

## 五、测试

```bash
cd test
npm install          # 安装 jsdom、xlsx（仅测试用，不影响应用运行）
node test.mjs        # 集成测试：37 项，全部通过
node smoke.mjs       # 冒烟测试：8 个页面全点一遍，断言控制台 0 报错
```

> 若本机已有 jsdom / xlsx 的 node_modules，也可免安装直接跑：
> ```bash
> NODE_PATH=/path/to/node_modules node test/test.mjs
> ```

测试在 jsdom 里**真实加载 `index.html` 并执行全部脚本**（含 SheetJS/mammoth）——为此测试会把
`index.html` 里的 `<script src>` 内联注入并使用 `http://localhost` 源，因为 jsdom 下 `file://`
属于 opaque origin，`localStorage` 会被禁用（真实浏览器里 `file://` 可用）。

覆盖范围：

| 组 | 内容 |
|---|---|
| 1 | 模块装载、PAGES 路由完整性、本地解析库可用、脚本引入顺序与样式契约 |
| 2 | 期次识别正则、文本/表格/无表头/自由格式解析、CSV 引号安全 |
| 3 | n-gram 分词与停用词、cleanTerms 去碎片、画像权重构建 |
| 4 | fit 打分区分度、饱和函数单调性、选刊排序、融合权重 |
| 5 | **用 SheetJS 构造真实 .xlsx 走统一导入入口**、CSV/TXT 导入、`.doc` 友好提示 |
| 6 | 表头识别、描述统计、Pearson、OLS 系数还原、共线/样本不足边界、CSV 往返、导出 BOM 策略 |
| 7 | 期刊库载入示例/文件导入画像重建、选刊分析渲染、写作字数与保存、计量分析全链路、其余页面渲染、非法路由回落 |
| 8 | localStorage 前缀规范、备份导入导出往返、**全流程无 console.error** |

最近一次运行结果：`共 37 项：通过 37，失败 0`，冒烟测试 `控制台错误：0`。

---

## 六、浏览器兼容性

Chrome / Edge / Firefox / Safari 现代版本均可。使用的是 ES5 语法 + 原生 DOM API，
不使用 ES Module、不使用构建产物，`file://` 直接双击也能跑。
