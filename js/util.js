/* =========================================================================
 * util.js —— 通用工具层
 *  · DOM 小工具（原生，无框架）
 *  · 中文 2~4 字 n-gram 分词 / 停用词 / 去碎片(cleanTerms)
 *  · 字数统计（中文字 + 英文词）
 *  · 文件下载、Toast 提示、id 生成、格式化
 * 同时以 UMD 形式导出，便于 Node + jsdom 集成测试直接 require。
 * ========================================================================= */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* 1. DOM 工具                                                         */
  /* ------------------------------------------------------------------ */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  /** 创建元素：h('div', {class:'x', onclick:fn}, 'text', childEl) */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class' || k === 'className') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'dataset' && typeof v === 'object') Object.assign(el.dataset, v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  function append(parent, child) {
    if (child === null || child === undefined || child === false) return parent;
    if (Array.isArray(child)) { child.forEach(function (c) { append(parent, c); }); return parent; }
    parent.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
    return parent;
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; }

  /** HTML 转义（所有用户输入渲染前必须过一遍） */
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ------------------------------------------------------------------ */
  /* 2. 杂项                                                             */
  /* ------------------------------------------------------------------ */

  var _seq = 0;
  function uid(prefix) {
    _seq += 1;
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + _seq.toString(36);
  }

  function debounce(fn, wait) {
    var t = null;
    return function () {
      var self = this, args = arguments;
      if (t) clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(self, args); }, wait || 300);
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function fmtDate(ts) {
    var d = ts ? new Date(ts) : new Date();
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /** 是否需要加 UTF-8 BOM：仅文本类（CSV/TXT）加，JSON 等结构化格式不能加 */
  function needsBom(mime) {
    return /^(text\/(csv|plain|tab-separated-values)|application\/vnd\.ms-excel)/.test(mime || 'text/csv');
  }

  /** 触发浏览器下载（纯前端，不经过服务端） */
  function download(filename, content, mime) {
    var type = mime || 'text/csv';
    var blob = new Blob([(needsBom(type) ? '\ufeff' : '') + content], { type: type + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }

  var _toastBox = null;
  function toast(msg, type) {
    if (typeof document === 'undefined') return;
    if (!_toastBox) {
      _toastBox = h('div', { class: 'toast-box' });
      document.body.appendChild(_toastBox);
    }
    var node = h('div', { class: 'toast toast-' + (type || 'info'), text: msg });
    _toastBox.appendChild(node);
    setTimeout(function () { node.classList.add('out'); }, 2200);
    setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 2600);
  }

  /* ------------------------------------------------------------------ */
  /* 3. 中文分词：2~4 字 n-gram + 英文词                                */
  /* ------------------------------------------------------------------ */

  // 单字停用（作为 n-gram 首/尾字符时丢弃，抑制 "的深度""基于" 这类噪声）
  var STOP_CHARS = '的了和与及在为是对中上下之其也者且或等这那我你他她它们个把被从到由以并而则于所就还都很更最一二三四五六七八九十';
  // 词级停用
  var STOPWORDS = ('研究 应用 分析 方法 系统 设计 实现 影响 探讨 综述 进展 评价 效果 作用 相关 因素 临床 本文 报道 观察 ' +
    '体会 技术 问题 讨论 初步 结果 意义 价值 一种 基于 及其 关于 通过 采用 提出 建立 构建 进行 不同 主要 重要 ' +
    '现状 趋势 特点 分析研究 推广应用 实验 试验 数据 模型 模型构建 方案 策略 对策 调查 比较 一组 例如 目的 ' +
    'matlab 数据据').split(/\s+/).filter(Boolean);
  var EN_STOPWORDS = ('the and for with from using based study studies analysis method methods research paper ' +
    'new novel approach approaches results result of in on to by via an a is are this that we our its their ' +
    'using its can may could').split(/\s+/).filter(Boolean);

  var STOP_SET = {};
  STOPWORDS.forEach(function (w) { STOP_SET[w] = 1; });
  var EN_STOP_SET = {};
  EN_STOPWORDS.forEach(function (w) { EN_STOP_SET[w] = 1; });
  var STOP_CHAR_SET = {};
  STOP_CHARS.split('').forEach(function (c) { STOP_CHAR_SET[c] = 1; });

  var RE_ZH_RUN = /[\u4e00-\u9fff]{2,}/g;
  var RE_EN_WORD = /[A-Za-z][A-Za-z0-9]*(?:[-'][A-Za-z0-9]+)*/g;

  function _validGram(g) {
    if (STOP_CHAR_SET[g[0]] || STOP_CHAR_SET[g[g.length - 1]]) return false;
    if (STOP_SET[g]) return false;
    return true;
  }

  /**
   * 分词：中文 2~4 字滑窗 n-gram（经停用过滤）+ 英文/数字词（小写化）
   * @returns {string[]} 词条数组（含重复，用于词频统计）
   */
  function tokenize(text) {
    var out = [];
    if (!text) return out;
    var s = String(text);
    var en = s.match(RE_EN_WORD) || [];
    for (var i = 0; i < en.length; i++) {
      var w = en[i].toLowerCase();
      if (w.length < 2 && !/\d/.test(w)) continue;
      if (EN_STOP_SET[w]) continue;
      out.push(w);
    }
    var runs = s.match(RE_ZH_RUN) || [];
    for (var r = 0; r < runs.length; r++) {
      var run = runs[r];
      for (var n = 2; n <= 4; n++) {
        for (var k = 0; k + n <= run.length; k++) {
          var g = run.slice(k, k + n);
          if (_validGram(g)) out.push(g);
        }
      }
    }
    return out;
  }

  /** 统计词频 → { term: count } */
  function termFreq(terms) {
    var f = {};
    for (var i = 0; i < terms.length; i++) f[terms[i]] = (f[terms[i]] || 0) + 1;
    return f;
  }

  /**
   * cleanTerms —— 按"包含关系"去碎片：
   * 若短词 t 被更长词 s 完全包含，且同时满足
   *   · s 的频次 >= t 频次 * ratio（t 的出现大部分来自 s）
   *   · s 自身足够"有支撑"（频次 >= minSupport，默认 2）
   * 则认为 t 只是 s 的碎片（例如「学习」之于「深度学习」），丢弃。
   *
   * minSupport 的作用：只出现 1 次的更长词很可能是跨词边界的噪声 n-gram
   * （如标题「肺结节自动检测」切出的「肺结节自」），不能作为判据去吃掉
   * 真正的主题词「肺结节」，因此频次不足的长词不参与去碎片。
   *
   * @param {Object<string, number>} freq 词频表
   * @param {{ratio?:number, minSupport?:number}} [opts]
   */
  function cleanTerms(freq, opts) {
    var ratio = (opts && opts.ratio !== undefined) ? opts.ratio : 0.5;
    var minSupport = (opts && opts.minSupport !== undefined) ? opts.minSupport : 2;
    var terms = Object.keys(freq).sort(function (a, b) {
      return (b.length - a.length) || (freq[b] - freq[a]) || (a < b ? -1 : 1);
    });
    var kept = [];
    var out = {};
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      var fragment = false;
      for (var j = 0; j < kept.length; j++) {
        var s = kept[j];
        if (s.length <= t.length) continue;
        if (s.indexOf(t) < 0) continue;
        if (freq[s] < minSupport) continue;
        if (freq[s] >= freq[t] * ratio) { fragment = true; break; }
      }
      if (!fragment) { kept.push(t); out[t] = freq[t]; }
    }
    return out;
  }

  /** 取词频最高的 n 个词 → [{term, count}] */
  function topTerms(freq, n) {
    return Object.keys(freq).map(function (t) { return { term: t, count: freq[t] }; })
      .sort(function (a, b) { return b.count - a.count || (b.term.length - a.term.length) || (a.term < b.term ? -1 : 1); })
      .slice(0, n || 20);
  }

  /** n-gram 分词 → 去停用 → 去碎片 → 归一化词频权重 {term: 0~1} */
  function buildTermWeights(text, opts) {
    var freq = cleanTerms(termFreq(tokenize(text)), opts);
    return normalizeWeight(freq);
  }

  /** 频次 → 权重（除以最大值，落在 0~1） */
  function normalizeWeight(freq) {
    var max = 0, t;
    for (t in freq) if (freq[t] > max) max = freq[t];
    var out = {};
    for (t in freq) out[t] = max > 0 ? +(freq[t] / max).toFixed(4) : 0;
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* 4. 字数统计：中文字符 + 英文单词                                    */
  /* ------------------------------------------------------------------ */

  function countWords(text) {
    var s = text ? String(text) : '';
    var cn = (s.match(/[\u4e00-\u9fff]/g) || []).length;
    var en = (s.match(/[A-Za-z][A-Za-z0-9'-]*/g) || []).length;
    var punct = (s.match(/[\u3000-\u303f\uff00-\uffef]/g) || []).length;
    return { cn: cn, en: en, punct: punct, total: cn + en };
  }

  function countFmt(text) {
    var c = countWords(text);
    return c.total + ' 字（中文 ' + c.cn + ' + 英文词 ' + c.en + '）';
  }

  /* ------------------------------------------------------------------ */
  /* 5. CSV 序列化                                                       */
  /* ------------------------------------------------------------------ */

  function toCSV(rows) {
    return (rows || []).map(function (row) {
      return row.map(function (cell) {
        var s = (cell === null || cell === undefined) ? '' : String(cell);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
  }

  /** CSV/TSV 文本 → 二维数组（处理引号包裹与 \r\n） */
  function parseDelimited(text, sep) {
    var s = String(text || '').replace(/^\ufeff/, '');
    if (!sep) sep = (s.indexOf('\t') >= 0 && s.indexOf(',') < 0) ? '\t' : ',';
    var rows = [], row = [], cur = '', inQ = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (inQ) {
        if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === sep) { row.push(cur.trim()); cur = ''; }
      else if (ch === '\n') { row.push(cur.trim()); rows.push(row); row = []; cur = ''; }
      else if (ch === '\r') { /* skip */ }
      else cur += ch;
    }
    row.push(cur.trim());
    if (row.length > 1 || row[0] !== '') rows.push(row);
    // 丢弃全空行
    return rows.filter(function (r) { return r.some(function (c) { return c !== ''; }); });
  }

  /* ------------------------------------------------------------------ */

  var Util = {
    $: $, $$: $$, h: h, append: append, clear: clear, esc: esc,
    uid: uid, debounce: debounce, clamp: clamp, fmtDate: fmtDate,
    download: download, toast: toast,
    tokenize: tokenize, termFreq: termFreq, cleanTerms: cleanTerms,
    topTerms: topTerms, buildTermWeights: buildTermWeights, normalizeWeight: normalizeWeight,
    countWords: countWords, countFmt: countFmt,
    toCSV: toCSV, parseDelimited: parseDelimited, needsBom: needsBom,
    STOPWORDS: STOPWORDS, STOP_CHARS: STOP_CHARS
  };

  global.Util = Util;
  if (typeof module !== 'undefined' && module.exports) module.exports = Util;
})(typeof window !== 'undefined' ? window : globalThis);
