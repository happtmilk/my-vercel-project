/* =========================================================================
 * toc.js —— 期刊录用目录(TOC)解析 + 主题画像引擎
 *
 *  解析：期次识别支持
 *      · 2021年第3期 / 2021年 第3期
 *      · Vol.15 No.3 / Vol 15, No 3
 *      · 2021,3 / 2021-3 / 2021年第3期
 *      · 第3期（沿用上方年份）
 *      · 纯年份顺推期次（同一年的多个"年"标题依次累加期次）
 *  画像：中文 2~4 字 n-gram → 停用词过滤 → cleanTerms 去碎片 → 按"年/期"切分
 *        → 聚合词频权重 {term: 0~1}
 * ========================================================================= */
(function (global) {
  'use strict';

  var U = global.Util;

  /* ------------------------------------------------------------------ */
  /* 一、期次识别                                                        */
  /* ------------------------------------------------------------------ */

  // 顺序敏感：越具体的模式越靠前
  var ISSUE_PATTERNS = [
    { name: 'cn-full', re: /((?:19|20)\d{2})\s*年\s*第?\s*(\d{1,3})(?![0-9])\s*期/, y: 1, i: 2 },
    { name: 'vol-no', re: /vol\.?\s*(\d{1,4})\s*[,，]?\s*no\.?\s*(\d{1,3})(?![0-9-])/i, y: 1, i: 2, vol: true },
    { name: 'dash', re: /((?:19|20)\d{2})\s*[-–—/]\s*(\d{1,3})(?![0-9])/, y: 1, i: 2 },
    { name: 'comma', re: /((?:19|20)\d{2})\s*[,，]\s*(\d{1,3})(?![0-9])/, y: 1, i: 2 },
    { name: 'cn-issue', re: /第\s*(\d{1,3})(?![0-9])\s*期/, y: null, i: 1 },
    { name: 'year-only', re: /((?:19|20)\d{2})\s*年?\s*(?:第\s*([0-9]{1,3})\s*卷)?$/, y: 1, i: 2, yearOnly: true }
  ];

  /**
   * 从一行文本里识别期次信息。
   * @returns {null|{year, issue, rest, raw, vol, yearOnly}}
   */
  function detectIssue(line) {
    var s = String(line || '').trim();
    if (!s) return null;
    var best = null;
    for (var k = 0; k < ISSUE_PATTERNS.length; k++) {
      var p = ISSUE_PATTERNS[k];
      var m = p.re.exec(s);
      if (!m) continue;
      // year-only 模式要求匹配到行尾（避免把正文里的年份当标题行）
      var year = p.y ? m[p.y] : '';
      var issue = (p.i && m[p.i]) ? m[p.i] : '';
      if (p.name === 'year-only') {
        var tail = s.slice(m.index + m[0].length).trim();
        if (tail) continue;                       // 后面还有内容 → 交给其它模式/当标题
      }
      var hit = {
        year: p.vol ? '' : (year || ''),
        vol: p.vol ? year : '',
        issue: issue,
        raw: m[0],
        rest: (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).trim(),
        yearOnly: !!p.yearOnly,
        pattern: p.name
      };
      // 优先选择"消耗了更长前缀"的匹配
      if (!best || hit.raw.length > best.raw.length) best = hit;
      if (!p.yearOnly) break;
    }
    return best;
  }

  var RE_LEAD_NOISE = /^[\s\u3000]*(?:[（(]?\s*\d{1,3}\s*[)）]?[\.、,，:：\-–—]|[-–—*·•。.]|\d{1,3}\s*[）)])\s*/;
  var HEADER_WORDS = /^(目录|目次|总目|期刊|录用|年|年份|期|期号|期次|标题|题名|篇名|文章|作者|关键词|year|issue|no\.?|title|author|keywords?|vol\.?)$/i;

  function stripNoise(s) {
    var prev = null, t = String(s || '').trim();
    while (prev !== t) { prev = t; t = t.replace(RE_LEAD_NOISE, '').trim(); }
    return t.replace(/[\s\u3000]+/g, ' ').trim();
  }

  function isTitleLike(s) {
    var t = stripNoise(s);
    if (!t || t.length < 4) return false;
    if (HEADER_WORDS.test(t)) return false;
    if (/^[\d\s\-–—.,，、:：/]+$/.test(t)) return false;
    var zh = (t.match(/[\u4e00-\u9fff]/g) || []).length;
    var en = (t.match(/[A-Za-z][A-Za-z0-9-]{1,}/g) || []).length;
    if (zh >= 4) return true;
    if (zh >= 2 && en >= 1) return true;
    if (en >= 3 && t.length >= 10) return true;
    return false;
  }

  function issueKey(e) {
    var y = e.year || (e.vol ? 'v' + e.vol : '');
    var i = e.issue || '';
    return (y && i) ? (y + '-' + i) : (y || i || '未分期');
  }

  function groupByIssue(entries) {
    var map = {}, order = [];
    entries.forEach(function (e) {
      var key = issueKey(e);
      if (!map[key]) { map[key] = { key: key, year: e.year || '', vol: e.vol || '', issue: e.issue || '', titles: [] }; order.push(key); }
      map[key].titles.push(e.title);
    });
    return order.map(function (k) { return map[k]; });
  }

  /* ------------------------------------------------------------------ */
  /* 二、文本模式解析                                                    */
  /* ------------------------------------------------------------------ */

  function newState() { return { year: '', vol: '', issue: '', autoSeq: {} }; }

  /**
   * 逐行解析（可复用：文本模式 / 表格自由格式降级）
   * @param {string[]} lines
   * @param {object} [state] 传入可持续的状态（表格解析时保持期次顺延）
   * @returns {{entries: Array, warnings: string[]}}
   */
  function parseLines(lines, state) {
    var st = state || newState();
    var entries = [], warnings = [];
    for (var i = 0; i < lines.length; i++) {
      var raw = String(lines[i] || '').replace(/\r/g, '').trim();
      if (!raw) continue;
      var hit = detectIssue(raw);
      var body = raw;
      if (hit) {
        if (hit.yearOnly) {
          st.year = hit.year; st.vol = '';
          st.autoSeq[hit.year] = (st.autoSeq[hit.year] || 0) + 1;   // 纯年份 → 顺推期次
          st.issue = String(st.autoSeq[hit.year]);
        } else {
          if (hit.year) { st.year = hit.year; st.vol = ''; }
          if (hit.vol) { st.vol = hit.vol; }
          if (hit.issue) { st.issue = String(hit.issue); if (st.year) st.autoSeq[st.year] = Math.max(st.autoSeq[st.year] || 0, +hit.issue || 0); }
        }
        body = hit.rest;
      }
      body = stripNoise(body);
      if (!body) continue;
      if (!isTitleLike(body)) { continue; }        // 作者行/单位行/页码等噪声丢弃
      entries.push({
        year: st.year || '',
        vol: st.vol || '',
        issue: st.issue || '',
        title: body
      });
    }
    if (!entries.length) warnings.push('未识别到任何文章标题，请检查是否为"年/期 + 标题"结构的录用目录。');
    return { entries: entries, warnings: warnings, state: st };
  }

  function parseTOCText(text) {
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    var r = parseLines(lines, newState());
    return {
      mode: 'text',
      entries: r.entries,
      issues: groupByIssue(r.entries),
      warnings: r.warnings
    };
  }

  /* ------------------------------------------------------------------ */
  /* 三、表格模式解析                                                    */
  /* ------------------------------------------------------------------ */

  var COL_PATTERNS = {
    year: /^(发表)?\s*(年|年份|year|年度)$/i,
    issue: /^(期|期号|期次|卷期|issue|no\.?|number|num)$/i,
    title: /(标题|题名|篇名|题目|文章名称|论文名称|文章|title)/i,
    author: /(作者|author)/i,
    keywords: /(关键词|关键字|keyword)/i,
    yearIssue: /(年\s*[\/、,和]\s*期|年\-期|卷期|年-期)/i
  };

  function headerCols(row) {
    var cols = { year: -1, issue: -1, title: -1, author: -1, keywords: -1, yearIssue: -1 };
    var hits = 0;
    for (var c = 0; c < row.length; c++) {
      var cell = String(row[c] || '').trim();
      if (!cell) continue;
      if (COL_PATTERNS.yearIssue.test(cell)) { if (cols.yearIssue < 0) cols.yearIssue = c; hits++; continue; }
      if (COL_PATTERNS.title.test(cell)) { if (cols.title < 0) cols.title = c; hits++; continue; }
      if (COL_PATTERNS.year.test(cell)) { if (cols.year < 0) cols.year = c; hits++; continue; }
      if (COL_PATTERNS.issue.test(cell)) { if (cols.issue < 0) cols.issue = c; hits++; continue; }
      if (COL_PATTERNS.author.test(cell)) { if (cols.author < 0) cols.author = c; hits++; continue; }
      if (COL_PATTERNS.keywords.test(cell)) { if (cols.keywords < 0) cols.keywords = c; hits++; continue; }
    }
    return hits >= 2 ? cols : null;      // 至少命中两列才认为首行是表头
  }

  /**
   * 二维数组解析（Excel / CSV 走这条路径，避免 CSV 引号歧义）
   */
  function parseTOCTable(rows) {
    var table = (global.Importer && Importer.tidyRows ? Importer.tidyRows(rows) : (rows || []))
      .map(function (r) { return (r || []).map(function (c) { return String(c === null || c === undefined ? '' : c).trim(); }); })
      .filter(function (r) { return r.some(function (c) { return c !== ''; }); });

    if (!table.length) return { mode: 'table', entries: [], issues: [], warnings: ['表格为空。'] };

    var warnings = [];
    var cols = null, headerIdx = -1;
    for (var i = 0; i < Math.min(5, table.length); i++) {
      var hc = headerCols(table[i]);
      if (hc && hc.title >= 0) { cols = hc; headerIdx = i; break; }
      if (hc && hc.yearIssue >= 0) { cols = hc; headerIdx = i; break; }
    }

    var entries = [], st = newState();

    /* --- 情况 A：识别到表头 --- */
    if (cols) {
      if (cols.title < 0) {                     // 只有"年/期"列，没有标题列 → 自由格式
        var lines = [];
        for (var r0 = headerIdx + 1; r0 < table.length; r0++) lines.push(table[r0].join(' '));
        warnings.push('表头未包含"标题"列，已按自由文本格式解析首行内容。');
        var fr = parseLines(lines, st);
        entries = fr.entries;
      } else {
        for (var r = headerIdx + 1; r < table.length; r++) {
          var row = table[r];
          var y = cols.year >= 0 ? String(row[cols.year] || '').trim() : '';
          var is = cols.issue >= 0 ? String(row[cols.issue] || '').trim() : '';
          var title = String(row[cols.title] || '').trim();
          if (cols.yearIssue >= 0) {            // "年/期"合列
            var yi = detectIssue(String(row[cols.yearIssue] || ''));
            if (yi) { if (yi.year) y = yi.year; if (yi.vol) y = y || ('v' + yi.vol); if (yi.issue) is = yi.issue; }
          }
          // 年份可能是 2021 / 2021年 / 2021-01-01
          var ym = /((?:19|20)\d{2})/.exec(y);
          y = ym ? ym[1] : '';
          var im = /(\d{1,3})/.exec(is);
          is = im ? im[1] : '';
          if (y) st.year = y;
          if (is) st.issue = is;
          if (!title) continue;
          if (!isTitleLike(title)) continue;
          entries.push({ year: y || st.year, vol: st.vol, issue: is || st.issue, title: stripNoise(title) });
        }
      }
    } else {
      /* --- 情况 B：没有表头 --- */
      var width = table.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
      var looksStructured =
        width >= 3 &&
        table.slice(0, 8).every(function (r) {
          var a = String(r[0] || ''), b = String(r[1] || ''), c = String(r[2] || '');
          return /(?:19|20)\d{2}|年|期|vol/i.test(a + b) && (c || '').length >= 4;
        });

      if (looksStructured) {                     // 按列序 0=年 1=期 2=标题
        warnings.push('未检测到表头，已按列序解析（第1列=年，第2列=期，第3列=标题）。');
        for (var r2 = 0; r2 < table.length; r2++) {
          var rr = table[r2];
          var ys = String(rr[0] || ''), iss = String(rr[1] || ''), tt = String(rr[2] || '');
          var ym2 = /((?:19|20)\d{2})/.exec(ys); if (ym2) st.year = ym2[1];
          var im2 = /(\d{1,3})/.exec(iss); if (im2) st.issue = im2[1];
          // 第2列可能整列是标题（无期次列）
          if (!isTitleLike(tt)) { continue; }
          if (isTitleLike(iss) && !/^\d{1,3}$/.test(iss)) {   // 第2列其实是标题
            entries.push({ year: st.year, vol: st.vol, issue: st.issue, title: stripNoise(iss) });
          }
          entries.push({ year: st.year, vol: st.vol, issue: st.issue, title: stripNoise(tt) });
        }
      } else {                                   // 完全无标题列 → 每个单元格当一行文本
        warnings.push('未检测到行列结构，已按自由文本解析全部单元格。');
        var flatLines = [];
        table.forEach(function (r) { r.forEach(function (c) { if (c) flatLines.push(c); }); });
        entries = parseLines(flatLines, st).entries;
      }
    }

    if (!entries.length) warnings.push('未识别到任何文章标题。');
    return { mode: 'table', entries: entries, issues: groupByIssue(entries), warnings: warnings };
  }

  /** 统一入口：自动判断二维数组 / 文本 */
  function parse(input, opts) {
    var res;
    if (Array.isArray(input)) res = parseTOCTable(input);
    else if (typeof input === 'string') res = parseTOCText(input);
    else res = { mode: 'text', entries: [], issues: [], warnings: ['输入格式不支持'] };
    res.count = res.entries.length;
    if (res.count) res.warnings = res.warnings.filter(function (w) { return !/未识别到/.test(w); });
    return res;
  }

  /* ------------------------------------------------------------------ */
  /* 四、画像引擎                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * 构建主题偏好画像
   * @param {Array<{year,issue,title}>} entries
   * @param {{maxTerms?:number, minCount?:number, ratio?:number}} [opts]
   * @returns {{terms:Object, counts:Object, top:Array, byIssue:Array, totalTitles:number, builtAt:number}}
   */
  function buildProfile(entries, opts) {
    var o = opts || {};
    var list = (entries || []).filter(function (e) { return e && e.title; });
    var minCount = o.minCount || (list.length >= 60 ? 2 : 1);
    var maxTerms = o.maxTerms || 1200;
    var ratio = (o.ratio === undefined ? 0.5 : o.ratio);
    var minSupport = (o.minSupport === undefined ? 2 : o.minSupport);

    // 逐条标题分词（不跨标题拼接，避免产生跨条 n-gram）
    var freq = {};
    list.forEach(function (e) {
      var f = U.termFreq(U.tokenize(e.title));
      for (var k in f) freq[k] = (freq[k] || 0) + f[k];
    });

    // 停用/碎片清理
    var cleaned = U.cleanTerms(freq, { ratio: ratio, minSupport: minSupport });
    var counts = {};
    Object.keys(cleaned).forEach(function (t) {
      if (cleaned[t] >= minCount) counts[t] = cleaned[t];
    });

    // 词频 → 权重（0~1）
    var weights = U.normalizeWeight(counts);
    var terms = {};
    U.topTerms(weights, maxTerms).forEach(function (it) { terms[it.term] = it.count; });

    // 按"年/期"切片，形成期次级画像
    var byIssue = groupByIssue(list).map(function (g) {
      var f2 = {};
      g.titles.forEach(function (t) {
        var f = U.termFreq(U.tokenize(t));
        for (var k in f) f2[k] = (f2[k] || 0) + f[k];
      });
      var c2 = U.cleanTerms(f2, { ratio: 0.5, minSupport: 1 });
      var sorted = U.topTerms(U.normalizeWeight(c2), 8);
      return { key: g.key, year: g.year, issue: g.issue, titles: g.titles.length, top: sorted };
    });

    return {
      terms: terms,
      counts: counts,
      top: U.topTerms(terms, 30).map(function (it) { return { term: it.term, weight: it.count, count: counts[it.term] || 0 }; }),
      byIssue: byIssue,
      totalTitles: list.length,
      builtAt: Date.now()
    };
  }

  /* ------------------------------------------------------------------ */
  /* 五、内置示例数据（医学影像 / 深度学习方向，2021–2023 共 6 期 15 篇） */
  /* ------------------------------------------------------------------ */

  var SAMPLE_MAIN = {
    name: '医学影像与智能诊断学报',
    field: '医学影像 / 人工智能',
    note: '示例期刊：偏向深度学习 + 医学图像分析（分割、检测、配准）',
    entries: [
      { year: '2021', issue: '1', title: '基于深度学习的肺结节自动检测方法研究' },
      { year: '2021', issue: '1', title: '卷积神经网络在胸部X线图像分类中的应用' },
      { year: '2021', issue: '1', title: '医学图像分割中的注意力机制综述' },
      { year: '2021', issue: '2', title: 'U-Net改进模型在肝脏肿瘤分割中的应用' },
      { year: '2021', issue: '2', title: '基于Transformer的医学图像配准方法' },
      { year: '2021', issue: '2', title: '低剂量CT图像去噪的生成对抗网络方法' },
      { year: '2022', issue: '1', title: '多模态MRI影像组学在脑胶质瘤分级中的价值' },
      { year: '2022', issue: '1', title: '医学影像三维重建技术研究进展' },
      { year: '2022', issue: '2', title: '自监督学习在稀缺标注医学图像分割中的应用' },
      { year: '2022', issue: '2', title: '基于注意力U-Net的视网膜血管分割方法' },
      { year: '2023', issue: '1', title: 'Transformer与CNN融合的肺结节检测算法' },
      { year: '2023', issue: '1', title: '肺结节良恶性鉴别的深度学习模型构建' },
      { year: '2023', issue: '1', title: '深度学习在乳腺癌钼靶筛查中的应用' },
      { year: '2023', issue: '2', title: '弱监督学习用于病理全切片图像分割' },
      { year: '2023', issue: '2', title: '联邦学习下的多中心医学影像模型训练' }
    ]
  };

  var SAMPLE_CTRL = {
    name: '中国生物医学工程学报（对照示例）',
    field: '生物医学工程 / 生物材料',
    note: '对照期刊：偏向生物力学、生物材料与器械，用于观察选刊排序差异',
    entries: [
      { year: '2021', issue: '1', title: '可降解镁合金血管支架的力学性能研究' },
      { year: '2021', issue: '1', title: '血管支架植入后血流动力学数值模拟' },
      { year: '2022', issue: '1', title: '基于水凝胶的软骨组织工程支架制备与评价' },
      { year: '2022', issue: '1', title: '生物传感器在连续血糖监测中的应用' },
      { year: '2023', issue: '1', title: '聚乳酸骨修复材料的降解行为研究' },
      { year: '2023', issue: '1', title: '人工心脏瓣膜力学特性实验研究' }
    ]
  };

  /* ------------------------------------------------------------------ */

  var Toc = {
    detectIssue: detectIssue,
    parseLines: parseLines,
    parseTOCText: parseTOCText,
    parseTOCTable: parseTOCTable,
    parse: parse,
    buildProfile: buildProfile,
    groupByIssue: groupByIssue,
    issueKey: issueKey,
    isTitleLike: isTitleLike,
    SAMPLE: [SAMPLE_MAIN, SAMPLE_CTRL]
  };

  global.Toc = Toc;
  if (typeof module !== 'undefined' && module.exports) module.exports = Toc;
})(typeof window !== 'undefined' ? window : globalThis);
