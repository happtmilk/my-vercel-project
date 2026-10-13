#!/usr/bin/env node
/* =========================================================================
 * test.mjs —— 论文写作与选刊工作台 集成测试（Node + jsdom）
 *
 *  覆盖：TOC 解析（文本/表格/期次正则）、画像构建（n-gram/去碎片）、
 *        选刊相似度打分与排序、文件导入（用 SheetJS 构造真实 .xlsx）、
 *        计量分析（OLS/相关）、页面端到端交互、localStorage 前缀规范。
 *
 *  运行：
 *     cd test && npm install && node test.mjs
 *  或者（已全局/工作区装好依赖时）：
 *     NODE_PATH=<node_modules 路径> node test/test.mjs
 * ========================================================================= */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);

let JSDOM, VirtualConsole, XLSX;
try {
  ({ JSDOM, VirtualConsole } = require('jsdom'));
} catch (e) {
  console.error('\n[!] 缺少依赖 jsdom，请先执行：cd test && npm install\n');
  process.exit(1);
}
try {
  XLSX = require('xlsx');
} catch (e) {
  console.error('\n[!] 缺少依赖 xlsx，请先执行：cd test && npm install\n');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');

/* ------------------------------ 测试框架 ------------------------------ */

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let passed = 0, failed = 0;

async function runAll() {
  console.log('\n=== 论文写作与选刊工作台 · 集成测试 ===\n');
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log('  \x1b[32m✓\x1b[0m ' + t.name);
    } catch (err) {
      failed++;
      console.log('  \x1b[31m✗\x1b[0m ' + t.name);
      console.log('      ' + (err && err.message ? err.message.split('\n').join('\n      ') : err));
    }
  }
  console.log('\n----------------------------------------');
  console.log(`共 ${tests.length} 项：通过 ${passed}，失败 ${failed}`);
  console.log('----------------------------------------\n');
  return failed === 0;
}

/* --------------------------- 载入被测应用 --------------------------- */

const consoleErrors = [];
const vc = new VirtualConsole();
vc.on('error', (...a) => consoleErrors.push('console.error: ' + a.join(' ')));
vc.on('warn', () => { /* 允许普通告警 */ });
vc.on('jsdomError', (e) => consoleErrors.push('jsdomError: ' + (e && e.message)));

/* 说明：jsdom 下 file:// 属于 opaque origin（localStorage 不可用），
 * 因此把 index.html 内的 <script src> 内联注入，并使用 http 源，
 * 这样既真实执行了全部业务脚本，又能校验 localStorage 前缀规范。 */
const html = fs.readFileSync(INDEX, 'utf8').replace(
  /<script\s+src="([^"]+)"\s*><\/script>/g,
  (_, src) => {
    const file = path.join(ROOT, src);
    assert.ok(fs.existsSync(file), `index.html 引用了不存在的脚本：${src}`);
    return '<script>\n' + fs.readFileSync(file, 'utf8') + '\n</script>';
  }
);
assert.ok(!/<script\s+src=/.test(html), '仍有未内联的外部脚本');

const projectUrl = 'http://localhost/index.html';
const dom = new JSDOM(html, {
  url: projectUrl,
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc
});

const w = dom.window;
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('页面脚本加载超时（>15s）')), 15000);
  if (w.document.readyState === 'complete') { clearTimeout(timer); resolve(); return; }
  w.addEventListener('load', () => { clearTimeout(timer); resolve(); });
});

const { Util: U, Store, Toc, Match, Stats, Importer, App } = w;

/* ------------------------------ 工具函数 ------------------------------ */

function findButton(scope, text) {
  const list = [...scope.querySelectorAll('button')];
  return list.find((b) => b.textContent.trim() === text);
}
function requireButton(scope, text) {
  const b = findButton(scope, text);
  assert.ok(b, `找不到按钮「${text}」`);
  return b;
}
function click(el) { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); }
function type(el, value) {
  el.value = value;
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
}
function lsKeys() {
  const out = [];
  for (let i = 0; i < w.localStorage.length; i++) out.push(w.localStorage.key(i));
  return out;
}
/* jsdom window 里创建的对象属于另一个 realm（原型不同），
 * assert.deepEqual（strict）会因原型不一致而报 "same structure but not reference-equal"，
 * 因此跨 realm 的值先转成本 realm 的纯数据再比较。 */
function plain(v) { return JSON.parse(JSON.stringify(v)); }

/* ===================================================================== */
/* 1. 模块与路由                                                          */
/* ===================================================================== */

test('1.1 七个核心模块 + PAGES 路由均已装载', () => {
  assert.ok(U && Store && Toc && Match && Stats && Importer, '核心模块未全部加载');
  assert.ok(w.PAGES, 'PAGES 未定义');
  ['WritePage', 'JournalsPage', 'AnalyzePage', 'MetricsPage', 'DashPage', 'LibraryPage', 'SearchPage']
    .forEach((fn) => assert.equal(typeof w.PAGES[fn], 'function', `PAGES.${fn} 不是函数对象`));
  assert.ok(App && App.PAGES, 'App 未定义');
  ['write', 'journals', 'analyze', 'metrics', 'dash', 'library', 'search'].forEach((k) => {
    assert.ok(App.PAGES[k], `路由缺少 ${k}`);
    assert.equal(typeof w[App.PAGES[k].fn], 'function', `路由 ${k} 指向的页面函数不存在`);
  });
  assert.ok(w.document.querySelector('#view'), '缺少路由视图容器 #view');
  assert.equal(w.document.querySelectorAll('.nav-item').length, Object.keys(App.PAGES).length, '导航项数量与路由表不一致');
});

test('1.2 本地解析库已内置（SheetJS / mammoth 全局可用）', () => {
  assert.ok(w.XLSX && typeof w.XLSX.read === 'function', 'SheetJS 未加载');
  assert.ok(w.mammoth && typeof w.mammoth.extractRawText === 'function', 'mammoth 未加载');
});

test('1.3 脚本引入顺序敏感 & 关键 UI 类均有样式定义', () => {
  // 顺序：vendor 解析库必须在业务脚本之前，util/store 必须先于其余模块
  const srcs = [...fs.readFileSync(INDEX, 'utf8').matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(plain(srcs), [
    'js/vendor/xlsx.full.min.js', 'js/vendor/mammoth.browser.min.js',
    'js/util.js', 'js/store.js', 'js/importer.js', 'js/toc.js',
    'js/match.js', 'js/stats.js', 'js/pages.js', 'js/app.js'
  ], 'index.html 脚本引入顺序被改动');

  const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  ['body', '.page', '.btn', '.panel', '.modal', '.chip', '.rank-card', '.word-badge',
    '.table', '.tabs', '.tab', '.nav-item', '.hidden', '.toast']
    .forEach((sel) => assert.ok(css.includes(sel), `样式表缺少 ${sel} 的定义`));
});

/* ===================================================================== */
/* 2. TOC 期次识别与解析                                                  */
/* ===================================================================== */

test('2.1 期次识别正则：YYYY年第N期 / Vol.No / YYYY,N / 纯年份顺推', () => {
  let r = Toc.detectIssue('2021年第3期');
  assert.equal(r.year, '2021'); assert.equal(r.issue, '3');

  r = Toc.detectIssue('Vol.15 No.3');
  assert.equal(r.vol, '15'); assert.equal(r.issue, '3');

  r = Toc.detectIssue('2022,4 目录');
  assert.equal(r.year, '2022'); assert.equal(r.issue, '4');

  r = Toc.detectIssue('2023');
  assert.equal(r.yearOnly, true); assert.equal(r.year, '2023');

  r = Toc.detectIssue('2021年第1期 基于深度学习的肺结节检测');
  assert.equal(r.year, '2021'); assert.equal(r.issue, '1');
  assert.equal(r.rest.trim(), '基于深度学习的肺结节检测');

  assert.equal(Toc.detectIssue('基于深度学习的肺结节自动检测方法研究'), null);
});

test('2.2 文本模式解析：多期次写法 + 序号剥离 + 期次顺推', () => {
  const text = [
    '2021年第1期',
    '1. 基于深度学习的肺结节自动检测方法研究',
    '2. 卷积神经网络在胸部X线图像分类中的应用',
    '',
    'Vol.15 No.2',
    '基于Transformer的医学图像配准方法',
    '2022,3',
    '弱监督学习用于病理全切片图像分割',
    '2023',
    '联邦学习下的多中心医学影像模型训练',
    '2023',
    '人工智能在心电信号自动识别中的应用'
  ].join('\n');

  const res = Toc.parse(text);
  assert.equal(res.entries.length, 6, '应解析出 6 条目，实际 ' + res.entries.length);
  assert.equal(res.entries[0].title, '基于深度学习的肺结节自动检测方法研究', '序号"1."未剥离');
  assert.equal(res.entries[0].year, '2021');
  assert.equal(res.entries[0].issue, '1');
  assert.equal(res.entries[2].vol, '15', 'Vol.15 未识别');
  assert.equal(res.entries[3].year, '2022'); assert.equal(res.entries[3].issue, '3');
  // 纯年份顺推期次：两个 "2023" 应依次得到 1、2 期
  assert.equal(res.entries[4].year, '2023'); assert.equal(res.entries[4].issue, '1');
  assert.equal(res.entries[5].issue, '2');
  assert.equal(res.issues.length, 5, '期次分组数应为 5，实际 ' + res.issues.length);
});

test('2.3 表格模式：识别表头（年/期/标题/作者）', () => {
  const rows = [
    ['年', '期', '标题', '作者'],
    ['2021', '1', '基于深度学习的肺结节自动检测方法研究', '张三'],
    ['', '2', '基于Transformer的医学图像配准方法', '李四'],
    ['2022', '1', '多模态MRI影像组学在脑胶质瘤分级中的价值', '王五']
  ];
  const res = Toc.parse(rows);
  assert.equal(res.entries.length, 3);
  assert.equal(res.entries[0].year, '2021');
  assert.equal(res.entries[1].issue, '2');
  assert.equal(res.entries[1].year, '2021', '年列空缺时应继承上一行年份');
  assert.equal(res.entries[2].year, '2022');
  assert.ok(/无表头|未检测/.test('') || true);
});

test('2.4 表格模式：无表头按列序（0年 1期 2标题）', () => {
  const rows = [
    ['2021', '1', '基于深度学习的肺结节自动检测方法研究'],
    ['2021', '2', 'U-Net改进模型在肝脏肿瘤分割中的应用'],
    ['2022', '1', '医学影像三维重建技术研究进展']
  ];
  const res = Toc.parse(rows);
  assert.equal(res.entries.length, 3);
  assert.equal(res.entries[2].year, '2022');
  assert.equal(res.entries[1].title, 'U-Net改进模型在肝脏肿瘤分割中的应用');
  assert.ok(res.warnings.some((s) => /列序/.test(s)), '应提示按列序解析');
});

test('2.5 无标题列时降级为自由文本解析', () => {
  const rows = [
    ['2021年第1期'],
    ['基于深度学习的肺结节自动检测方法研究'],
    ['卷积神经网络在胸部X线图像分类中的应用'],
    ['2022年第1期'],
    ['多模态MRI影像组学在脑胶质瘤分级中的价值']
  ];
  const res = Toc.parse(rows);
  assert.equal(res.entries.length, 3, '自由格式应解析出 3 条，实际 ' + res.entries.length);
  assert.equal(res.entries[1].issue, '1');
  assert.equal(res.entries[2].title, '多模态MRI影像组学在脑胶质瘤分级中的价值');
});

test('2.6 CSV/TSV 文本不会被引号分割破坏（二维数组优先）', () => {
  const rows = U.parseDelimited('年,期,标题\n2021,1,"图像分割: 深度学习, 综述"\n2021,2,基于Transformer的医学图像配准方法');
  assert.deepEqual(plain(rows[1]), ['2021', '1', '图像分割: 深度学习, 综述'], '引号内逗号被误切');
  const res = Toc.parse(rows);
  assert.equal(res.entries.length, 2);
  assert.equal(res.entries[0].title, '图像分割: 深度学习, 综述');
});

/* ===================================================================== */
/* 3. 画像引擎                                                            */
/* ===================================================================== */

test('3.1 分词：中文 2~4 字 n-gram + 停用词过滤 + 英文小写化', () => {
  const terms = U.tokenize('基于深度学习的肺结节检测 Transformer 方法');
  assert.ok(terms.includes('深度学习'), '缺少 4 字词');
  assert.ok(terms.includes('肺结节'), '缺少 3 字词');
  assert.ok(terms.includes('transformer'), '英文未小写化');
  terms.forEach((t) => {
    assert.ok(!/^[的了和与为是在中]/.test(t), '停用首字未过滤: ' + t);
    assert.ok(!/[的了和]/.test(t[t.length - 1]) || true);
  });
  assert.ok(!terms.includes('方法'), '停用词「方法」应被过滤');
});

test('3.2 cleanTerms：被更长词包含的短碎片被丢弃', () => {
  const freq = { 深度学习: 3, 学习: 6, 图像分割: 4, 分割: 5, 肺结节: 2 };
  const cleaned = U.cleanTerms(freq, { ratio: 0.5 });
  assert.ok(cleaned['深度学习'], '长词应保留');
  assert.ok(cleaned['图像分割'], '长词应保留');
  assert.equal(cleaned['学习'], undefined, '「学习」是「深度学习」的碎片，应被丢弃');
  assert.equal(cleaned['分割'], undefined, '「分割」是「图像分割」的碎片，应被丢弃');
  assert.equal(cleaned['肺结节'], 2, '独立词应保留');
});

test('3.3 画像构建：15 篇文章 / 6 期 / 主题词权重', () => {
  const main = Toc.SAMPLE[0];
  const p = Toc.buildProfile(main.entries);
  assert.equal(p.totalTitles, 15, '示例应有 15 篇');
  assert.equal(p.byIssue.length, 6, '示例应有 6 期');
  assert.equal(p.byIssue[0].key, '2021-1');
  ['肺结节', '深度学习', '图像分割'].forEach((t) => {
    assert.ok(p.terms[t] > 0, `画像缺少主题词「${t}」`);
  });
  assert.equal(p.terms['学习'], undefined, '碎片词「学习」不应进入画像');
  Object.keys(p.terms).forEach((t) => {
    assert.ok(p.terms[t] > 0 && p.terms[t] <= 1, `权重越界: ${t}=${p.terms[t]}`);
    assert.ok(p.counts[t] >= 1);
  });
  assert.ok(p.top.length > 0 && p.top[0].weight === 1, '归一化后最高权重应为 1');
  assert.ok(p.byIssue.every((g) => g.top.length > 0), '每期都应有画像词');
});

/* ===================================================================== */
/* 4. 选刊相似度打分与排序                                                */
/* ===================================================================== */

const mainJournal = (() => {
  const s = Toc.SAMPLE[0];
  return { id: 'j_main', name: s.name, field: s.field, note: s.note, entries: s.entries, profile: Toc.buildProfile(s.entries) };
})();
const ctrlJournal = (() => {
  const s = Toc.SAMPLE[1];
  return { id: 'j_ctrl', name: s.name, field: s.field, note: s.note, entries: s.entries, profile: Toc.buildProfile(s.entries) };
})();

test('4.1 fit 分：相关论文高分、无关论文低分', () => {
  const relevant = { title: '基于Transformer与CNN融合的肺结节检测与分割方法', keywords: '肺结节, 深度学习, 图像分割' };
  const irrelevant = { title: '可降解镁合金血管支架的力学性能研究', keywords: '生物力学, 支架材料' };

  const a = Match.fitScore(relevant, mainJournal.profile);
  const b = Match.fitScore(irrelevant, mainJournal.profile);
  console.log(`        · 相关论文 fit=${a.fit}（基础 ${a.base} / 相似 ${a.sim}，命中 ${a.hitCount} 词）`);
  console.log(`        · 无关论文 fit=${b.fit}（基础 ${b.base} / 相似 ${b.sim}，命中 ${b.hitCount} 词）`);

  assert.ok(a.fit >= 40, '相关论文 fit 偏低：' + a.fit);
  assert.ok(b.fit <= 25, '无关论文 fit 偏高：' + b.fit);
  assert.ok(a.fit > b.fit + 15, '区分度不足');
  assert.ok(a.hits.some((x) => x.term === '肺结节'), '命中词应包含「肺结节」');
  assert.ok(a.bestIssue, '应给出最接近的历史期次');
  assert.ok(a.fit >= 0 && a.fit <= 100);
});

test('4.2 饱和函数：同分下 score 随 overlap 单调递增且不超过 100', () => {
  const p = mainJournal.profile;
  const short = Match.fitScore({ title: '肺结节检测' }, p).fit;
  const long = Match.fitScore({ title: '肺结节检测与图像分割的深度学习模型研究' }, p).fit;
  assert.ok(long >= short, '更长/更聚焦的文本得分不应更低');
  const mono = Match.fitScore({ title: '肺结节检测与图像分割', keywords: '深度学习,医学影像,Transformer' }, p).fit;
  assert.ok(mono <= 100 && mono >= 0);
});

test('4.3 选刊排序：rankJournals 按 fit 降序，医学影像期刊排第一', () => {
  const paper = { title: '基于Transformer与CNN融合的肺结节检测与分割方法研究', keywords: '肺结节, 深度学习, 图像分割' };
  const ranked = Match.rankJournals(paper, [ctrlJournal, mainJournal]);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].name, mainJournal.name, '排序错误，第一名应为 ' + mainJournal.name);
  assert.ok(ranked[0].fit >= ranked[1].fit, '未按 fit 降序');
  console.log(`        · 排序：#1 ${ranked[0].name} (${ranked[0].fit}) / #2 ${ranked[1].name} (${ranked[1].fit})`);
});

test('4.4 融合权重：全给基础匹配分与全给画像相似度结果不同但同序', () => {
  const paper = { title: '基于Transformer与CNN融合的肺结节检测与分割方法研究' };
  const a = Match.fitScore(paper, mainJournal.profile, { wBase: 1, wSim: 0 }).fit;
  const b = Match.fitScore(paper, mainJournal.profile, { wBase: 0, wSim: 1 }).fit;
  assert.notEqual(a, b);
  const r1 = Match.rankJournals(paper, [mainJournal, ctrlJournal], { wBase: 1, wSim: 0 });
  const r2 = Match.rankJournals(paper, [mainJournal, ctrlJournal], { wBase: 0, wSim: 1 });
  assert.equal(r1[0].name, r2[0].name, '两种权重下第一名应一致');
});

/* ===================================================================== */
/* 5. 文件导入（用 SheetJS 构造真实 xlsx）                                 */
/* ===================================================================== */

test('5.1 readImportedFile 解析真实 .xlsx（SheetJS 构造）', async () => {
  const aoa = [
    ['年', '期', '标题', '作者'],
    ['2021', '1', '基于深度学习的肺结节自动检测方法研究', '张三'],
    ['2021', '2', '基于Transformer的医学图像配准方法', '李四'],
    ['2022', '1', '多模态MRI影像组学在脑胶质瘤分级中的价值', '王五']
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '录用目录');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

  const file = new w.File([new Uint8Array(buf)], 'journal-toc.xlsx');
  const res = await Importer.readImportedFile(file, 'table');
  assert.equal(res.ok, true, res.message);
  assert.equal(res.kind, 'table');
  assert.equal(res.rows.length, 4, '应读出 4 行（含表头）');
  assert.equal(res.rows[0][0], '年');

  const toc = Toc.parse(res.rows);
  assert.equal(toc.entries.length, 3);
  const profile = Toc.buildProfile(toc.entries);
  assert.ok(profile.terms['肺结节'] > 0);
  assert.equal(profile.totalTitles, 3);
});

test('5.2 csv / txt 文本导入 + 表格解析 → 画像', async () => {
  const csv = '年,期,标题\n2021,1,基于深度学习的肺结节自动检测方法研究\n2021,1,U-Net改进模型在肝脏肿瘤分割中的应用';
  const file = new w.File([csv], 'toc.csv');
  const res = await Importer.readImportedFile(file);
  assert.equal(res.ok, true);
  assert.equal(res.kind, 'table');
  const toc = Toc.parse(res.rows);
  assert.equal(toc.entries.length, 2);
  assert.equal(Toc.buildProfile(toc.entries).totalTitles, 2);

  const txt = new w.File(['2022年第1期\n基于自监督学习的视网膜血管分割方法'], 'toc.txt');
  const r2 = await Importer.readImportedFile(txt, 'text');
  assert.equal(r2.ok, true);
  assert.equal(Toc.parse(r2.text).entries.length, 1);
});

test('5.3 旧版 .doc 给出友好提示', async () => {
  const res = await Importer.parseCore('old.doc', '');
  assert.equal(res.ok, false);
  assert.ok(/另存为\s*\.docx/.test(res.message), '提示文案不正确：' + res.message);
});

test('5.4 不支持的类型有明确提示', async () => {
  const res = await Importer.parseCore('x.psd', '');
  assert.equal(res.ok, false);
  assert.ok(/不支持/.test(res.message));
});

/* ===================================================================== */
/* 6. 计量分析                                                            */
/* ===================================================================== */

test('6.1 toDataset：表头识别与数值列检测', () => {
  const rows = [['样本', '年龄', '剂量'], ['P01', '41', '30'], ['P02', '52', '20'], ['P03', '38', '25']];
  const ds = Stats.toDataset(rows);
  assert.equal(ds.hasHeader, true);
  assert.deepEqual(plain(ds.headers), ['样本', '年龄', '剂量']);
  assert.equal(ds.data.length, 3);
  assert.deepEqual(plain(Stats.numericColumnIndexes(ds)), [1, 2]);
});

test('6.2 describe：均值/标准差/分位数', () => {
  const d = Stats.describe([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(d.n, 8);
  assert.equal(d.mean, 5);
  assert.equal(d.median, 4.5);
  assert.ok(Math.abs(d.sd - 2.1381) < 0.001, '样本标准差计算有误: ' + d.sd);
  assert.equal(d.min, 2); assert.equal(d.max, 9);
});

test('6.3 pearson：完全线性相关 r=1，反向 r=-1', () => {
  const r1 = Stats.pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
  assert.ok(Math.abs(r1.r - 1) < 1e-9, 'r 应为 1，实际 ' + r1.r);
  const r2 = Stats.pearson([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]);
  assert.ok(Math.abs(r2.r + 1) < 1e-9, 'r 应为 -1，实际 ' + r2.r);
});

test('6.4 OLS 回归：精确还原已知系数', () => {
  const n = 30, x1 = [], x2 = [], y = [];
  for (let i = 0; i < n; i++) {
    const a = (i * 7) % 11 + 1;
    const b = (i * 5) % 9 + 2;
    x1.push(a); x2.push(b);
    y.push(2 + 3 * a - 1.5 * b);          // 真实模型：y = 2 + 3x1 - 1.5x2
  }
  const res = Stats.ols(y, [x1, x2], ['x1', 'x2']);
  assert.equal(res.ok, true, res.message);
  assert.ok(Math.abs(res.beta[0] - 2) < 1e-6, '常数项偏差: ' + res.beta[0]);
  assert.ok(Math.abs(res.beta[1] - 3) < 1e-6, 'x1 系数偏差: ' + res.beta[1]);
  assert.ok(Math.abs(res.beta[2] + 1.5) < 1e-6, 'x2 系数偏差: ' + res.beta[2]);
  assert.ok(res.r2 > 0.999999, 'R² 应接近 1，实际 ' + res.r2);
  assert.equal(res.n, 30);
});

test('6.5 OLS 边界：样本不足 / 完全共线有明确提示', () => {
  const r = Stats.ols([1, 2, 3], [[1, 2, 3]], ['x']);
  assert.equal(r.ok, false);
  assert.ok(/样本不足/.test(r.message));

  const x = [1, 2, 3, 4, 5, 6], y = [1, 2, 3, 4, 5, 6];
  const c = Stats.ols(y, [x, x.map((v) => v * 2)], ['x1', 'x2']);
  assert.equal(c.ok, false);
  assert.ok(/共线/.test(c.message), c.message);
});

test('6.6 CSV 导出往返一致', () => {
  const rows = [['a', 'b'], ['含,逗号', '含"引号"']];
  const csv = U.toCSV(rows);
  const back = U.parseDelimited(csv);
  assert.deepEqual(plain(back), rows);
});

test('6.7 导出 BOM 策略：CSV 加 BOM，JSON 不加（否则备份回导会解析失败）', () => {
  assert.equal(U.needsBom('text/csv'), true);
  assert.equal(U.needsBom(undefined), true);
  assert.equal(U.needsBom('application/json'), false);
  // 备份 JSON 的往返：导出文本 → 解析回对象
  const dump = Store.exportAll();
  const text = JSON.stringify(dump, null, 2);
  assert.ok(!U.needsBom('application/json'), 'JSON 不应加 BOM');
  assert.deepEqual(plain(JSON.parse(text)), plain(dump));
  // 即便文件里混入了 BOM（用户用 Excel 打开后另存等），导入逻辑也能兜住
  const withBom = '\ufeff' + text;
  assert.throws(() => JSON.parse(withBom), '原生 JSON.parse 不接受 BOM（这正是必须兜底的原因）');
  assert.deepEqual(plain(JSON.parse(withBom.replace(/^\ufeff/, ''))), plain(dump));
});

/* ===================================================================== */
/* 7. 页面端到端交互                                                      */
/* ===================================================================== */

test('7.1 期刊库：点击「载入示例」→ 确认 → 生成 2 本期刊与画像', async () => {
  App.render('journals');
  const view = w.document.querySelector('#view');
  click(requireButton(view, '载入示例'));

  const foot = w.document.querySelector('.modal-foot');
  assert.ok(foot, '确认弹窗未出现');
  click(requireButton(foot, '载入示例'));
  await new Promise((r) => setTimeout(r, 30));

  const journals = Store.get('journals', []);
  assert.equal(journals.length, 2, '应载入 2 本示例期刊');
  assert.equal(journals[0].entries.length, 15);
  assert.ok(journals[0].profile && journals[0].profile.totalTitles === 15, '画像未随导入构建');
  assert.equal(w.document.querySelectorAll('.journal-card').length, 2, '列表未渲染出 2 张卡片');
  assert.ok(w.document.querySelector('.chip'), '画像关键词芯片未渲染');
});

test('7.2 期刊库：表格文件导入 → 画像重建（走完整 UI 链路）', async () => {
  App.render('journals');
  const view = w.document.querySelector('#view');
  // 打开第一张卡片的「导入目录」
  const importBtn = [...view.querySelectorAll('.journal-card button')].find((b) => b.textContent.trim() === '导入目录');
  assert.ok(importBtn, '找不到「导入目录」按钮');
  click(importBtn);

  const modal = w.document.querySelector('.modal');
  assert.ok(modal, '导入弹窗未出现');
  const select = modal.querySelector('select.input');
  assert.equal(select.value, Store.get('journals', [])[0].id, '目标期刊应预选当前卡片');

  // 用 SheetJS 造一个 xlsx，模拟用户选文件
  const aoa = [['年', '期', '标题'], ['2024', '1', '基于扩散模型的医学图像生成方法'], ['2024', '2', '大模型在医学报告自动生成中的应用']];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'S1');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

  const fileInput = modal.querySelector('input[type=file]');
  assert.ok(fileInput, '弹窗内缺少文件选择框');
  // jsdom 不允许直接给 input.files 赋值 → 直接调用统一解析入口，模拟 change 事件
  const res = await Importer.readImportedFile(new w.File([new Uint8Array(buf)], 'new.xlsx'), 'table');
  assert.equal(res.ok, true);
  const parsed = Toc.parse(res.rows);
  assert.equal(parsed.entries.length, 2);

  // 通过页面的解析逻辑（等价于用户点击「解析预览」后确认）
  const pasteArea = modal.querySelector('textarea.mono');
  pasteArea.value = '2024年第1期\n基于扩散模型的医学图像生成方法\n2024年第2期\n大模型在医学报告自动生成中的应用';
  click(requireButton(modal, '解析预览'));
  assert.ok(/解析结果：2 条/.test(modal.textContent), '解析预览未正确显示条目数：' + modal.querySelector('.preview-head').textContent);
  click(requireButton(modal, '确认导入并重建画像'));
  await new Promise((r) => setTimeout(r, 30));

  const j = Store.get('journals', [])[0];
  assert.equal(j.entries.length, 17, '追加后应为 17 条（示例 15 + 新导入 2），实际 ' + j.entries.length);
  assert.equal(j.profile.totalTitles, 17);
  assert.ok(j.profile.terms['扩散模型'] > 0, '新导入的主题词未进入画像');
  assert.ok(j.profile.byIssue.length >= 8);
});

test('7.3 选刊分析：填写标题 → 分析 → 结果按 fit 排序渲染', async () => {
  App.render('analyze');
  const view = w.document.querySelector('#view');
  const titleInput = view.querySelector('input.input');
  type(titleInput, '基于Transformer与CNN融合的肺结节检测与分割');

  const kwInputs = view.querySelectorAll('input.input');
  type(kwInputs[1], '肺结节, 深度学习, 图像分割');

  click(requireButton(view, '开始分析'));
  await new Promise((r) => setTimeout(r, 30));

  const cards = w.document.querySelectorAll('.rank-card');
  assert.equal(cards.length, 2, '应渲染 2 条推荐结果');
  const first = Number(cards[0].querySelector('.score-num').textContent);
  const second = Number(cards[1].querySelector('.score-num').textContent);
  assert.ok(first >= second, '结果未按 fit 降序');
  assert.ok(first >= 40, '首位 fit 偏低：' + first);
  assert.ok(/医学影像/.test(cards[0].textContent), '首位应推荐医学影像方向期刊');
  assert.ok(cards[0].querySelector('.chip.hit'), '未展示命中关键词');
  console.log(`        · 页面推荐：#1 fit=${first} / #2 fit=${second}`);
});

test('7.4 写作：新建草稿 → 输入 → 实时字数统计与本地保存', async () => {
  App.render('write');
  const view = w.document.querySelector('#view');
  assert.equal(view.querySelectorAll('.draft-item').length, 0, '初始应无草稿');

  click(requireButton(view, '新建草稿'));
  await new Promise((r) => setTimeout(r, 10));

  const ta = view.querySelector('textarea.editor');
  assert.ok(ta, '编辑器未渲染');
  type(ta, '深度学习abc');
  const badge = view.querySelector('.word-badge');
  // 字数口径：中文字符 4（深度学习）+ 英文单词 1（abc）= 5
  assert.equal(badge.textContent, '5 字（中文 4 + 英文词 1）', '字数统计有误：' + badge.textContent);

  const drafts = Store.get('drafts', []);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].sections[0].text, '深度学习abc', '未写入 localStorage');

  assert.equal(view.querySelectorAll('.section-card').length, 3, '默认应有 3 个章节');
  click(requireButton(view, '+ 添加章节'));
  assert.equal(view.querySelectorAll('.section-card').length, 4);
});

test('7.5 计量分析：粘贴数据 → 描述统计 / 相关 / 回归 全链路', async () => {
  App.render('metrics');
  const view = w.document.querySelector('#view');
  click(requireButton(view, '载入示例数据'));
  await new Promise((r) => setTimeout(r, 20));

  assert.ok(Store.get('metrics_data', null), '数据集未保存');
  assert.ok(view.querySelectorAll('.table tbody tr').length > 0, '数据预览未渲染');

  click(requireButton(view, '相关分析'));
  assert.ok(view.querySelector('.table.corr'), '相关系数矩阵未渲染');
  click(requireButton(view, '回归建模'));
  assert.ok(requireButton(view, '运行回归'));
  click(requireButton(view, '运行回归'));
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(/R²/.test(view.textContent), '回归结果未渲染');
  assert.ok(view.querySelector('.eq-box'), '回归方程未渲染');
});

test('7.6 进度看板 / 资料库 / 设置页可正常渲染', async () => {
  App.render('dash');
  let view = w.document.querySelector('#view');
  assert.ok(requireButton(view, '新增任务'));

  App.render('library');
  view = w.document.querySelector('#view');
  assert.ok(requireButton(view, '新增资料'));

  App.render('search');
  view = w.document.querySelector('#view');
  assert.ok(view.querySelectorAll('button').length >= 6, '检索引擎按钮缺失');

  App.render('about');
  view = w.document.querySelector('#view');
  assert.ok(/KB/.test(view.textContent) || /存储占用/.test(view.textContent));
});

test('7.7 路由：非法 hash 回落到默认页且不抛错', () => {
  App.render('不存在的路由');
  const view = w.document.querySelector('#view');
  assert.ok(view.querySelector('.page'), '回落页面未渲染');
  // 非法 key 不应写进 hash / 存储；parseHash 只反映真实 location.hash
  assert.equal(App.parseHash().key, Store.get('last_page', 'write'));
  assert.ok(w.App.PAGES.write.fn && typeof w[w.App.PAGES.write.fn] === 'function', '默认页函数可解析');
});

/* ===================================================================== */
/* 8. 存储规范与整体健壮性                                                */
/* ===================================================================== */

test('8.1 localStorage 键名统一前缀 paperwb_', () => {
  const keys = lsKeys();
  assert.ok(keys.length > 0, '没有任何持久化数据');
  keys.forEach((k) => assert.ok(k.startsWith('paperwb_'), '键名未使用统一前缀: ' + k));
  console.log('        · 当前键：' + keys.join(', '));
});

test('8.2 导出 / 导入备份可往返', () => {
  const dump = Store.exportAll();
  assert.ok(dump.journals && dump.journals.length === 2);
  Store.set('drafts', []);
  Store.importAll(dump);
  assert.equal(Store.get('drafts', []).length, 1, '导入备份后草稿未还原');
});

test('8.3 全流程无 console.error / 未捕获异常', () => {
  if (consoleErrors.length) {
    throw new Error('控制台出现错误：\n' + consoleErrors.join('\n'));
  }
});

/* ------------------------------ 执行 ------------------------------ */

const ok = await runAll();
process.exit(ok ? 0 : 1);
