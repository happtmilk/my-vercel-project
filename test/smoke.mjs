#!/usr/bin/env node
/* =========================================================================
 * smoke.mjs —— 冒烟测试：把所有页面渲染一遍，并点击页面上每个"安全"按钮，
 *              确保浏览器里各功能可跑通、控制台无报错（等价于人工点一遍）。
 *
 *  运行： NODE_PATH=<node_modules> node test/smoke.mjs
 * ========================================================================= */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const { JSDOM, VirtualConsole } = require('jsdom');
const XLSX = require('xlsx');

/* 内联 index.html 里的脚本（jsdom 下 file:// 是 opaque origin，localStorage 不可用） */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace(/<script\s+src="([^"]+)"\s*><\/script>/g, (_, src) =>
    '<script>\n' + fs.readFileSync(path.join(ROOT, src), 'utf8') + '\n</script>');

const errors = [];
/* jsdom 未实现真实页面跳转（文献检索的外链新窗口），属于宿主限制而非应用报错 */
const HOST_NOISE = /Not implemented: (navigation|window\.(open|alert))/;
const vc = new VirtualConsole();
vc.on('error', (...a) => { const s = 'console.error: ' + a.join(' '); if (!HOST_NOISE.test(s)) errors.push(s); });
vc.on('jsdomError', (e) => { const s = 'jsdomError: ' + (e && e.message); if (!HOST_NOISE.test(s)) errors.push(s); });

const dom = new JSDOM(html, { url: 'http://localhost/index.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
const w = dom.window;
await new Promise((r) => (w.document.readyState === 'complete' ? r() : w.addEventListener('load', r)));

/* jsdom 未实现 createObjectURL（导出用），打桩 */
w.URL.createObjectURL = () => 'blob:stub';
w.URL.revokeObjectURL = () => {};

const view = () => w.document.querySelector('#view');
const SKIP = /(清空|删除|移除|重新加载|全部清空|取消)/;

function clickAll(scope, label) {
  const btns = [...scope.querySelectorAll('button')].filter((b) => !SKIP.test(b.textContent.trim()));
  btns.forEach((b) => {
    try {
      b.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    } catch (e) {
      errors.push(`[${label}] 点击「${b.textContent.trim()}」抛错：${e.message}`);
    }
  });
  return btns.length;
}

/* 0. 先给期刊库载入示例（后面选刊分析/资料库要有数据） */
w.App.render('journals');
clickAll(view(), 'journals');
const confirmBtn = [...w.document.querySelectorAll('.modal-foot button')].find((b) => /载入示例|确认|确定/.test(b.textContent));
if (confirmBtn) confirmBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

/* 1. 遍历所有路由：渲染 + 点击全部安全按钮 */
let totalClicks = 0;
const perRoute = [];
for (const key of Object.keys(w.App.PAGES)) {
  w.App.render(key);
  const v = view();
  if (!v.querySelector('.page')) errors.push(`[${key}] 页面未渲染出 .page 容器`);
  if (/页面渲染出错/.test(v.textContent)) errors.push(`[${key}] 页面渲染出错：${v.textContent.slice(0, 160)}`);
  const n = clickAll(v, key);
  totalClicks += n;
  perRoute.push(key + '(' + n + ')');

  /* 弹窗里的安全按钮也点一遍（如「解析预览」），然后关闭 */
  const modal = w.document.querySelector('.modal');
  if (modal) {
    clickAll(modal, key + '/modal');
    const cancel = [...modal.querySelectorAll('button')].find((b) => /取消|关闭/.test(b.textContent));
    if (cancel) cancel.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  }
}

/* 2. 文件导入链路：造一个真实 xlsx，走 Importer + Toc + 画像 */
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ['年', '期', '标题', '作者'],
  ['2025', '1', '基于扩散模型与多模态融合的医学图像生成与分割', '张三'],
  ['2025', '2', '大模型在医学报告自动生成中的应用', '李四']
]), 'TOC');
const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
const file = new w.File([new Uint8Array(buf)], 'smoke.xlsx');

/* 3. 回归：确认页面流程后无 console 报错 */
w.App.render('write');
w.App.render('analyze');

await new Promise((r) => setTimeout(r, 50));

const imported = await w.Importer.readImportedFile(file, 'table');
const toc = w.Toc.parse(imported.rows);
const profile = w.Toc.buildProfile(toc.entries);

console.log('\n=== 冒烟测试 ===');
console.log(`  路由数：${Object.keys(w.App.PAGES).length} · 每页安全按钮点击：${perRoute.join(' / ')}`);
console.log(`  安全按钮点击数：${totalClicks}`);
console.log(`  xlsx 导入：${imported.ok ? 'OK' : 'FAIL'} · 解析条目 ${toc.entries.length} · 画像词 ${Object.keys(profile.terms).length} 个`);
console.log(`  控制台错误：${errors.length}`);
if (errors.length) {
  errors.forEach((e) => console.log('   ' + e));
  process.exit(1);
}
console.log('  结果：通过（无报错）\n');
