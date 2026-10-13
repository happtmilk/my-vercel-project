/* =========================================================================
 * match.js —— 选刊相似度算法
 *
 *  fit = 100 × ( 0.5 × 基础匹配分 + 0.5 × 画像相似度 )   （默认 5:5 融合）
 *
 *   · 基础匹配分 base = 1 - exp(-Kb × pCover)     饱和函数映射
 *       pCover = 命中词权重之和 / 画像权重总       （画像被覆盖率）
 *   · 画像相似度 sim  = 1 - exp(-Kp × pPrec)
 *       pPrec  = Σ 论文高频词归一权重 × 画像中该词权重 （论文视角加权精确率）
 *   · 两路都经饱和函数压缩，天然落在 0~1，再乘 100 得 fit 分。
 * ========================================================================= */
(function (global) {
  'use strict';

  var U = global.Util;

  var DEFAULT_OPTS = {
    Kb: 25,          // 基础匹配分饱和系数
    Kp: 4,           // 画像相似度饱和系数
    wBase: 0.5,      // 融合权重（基础匹配分）
    wSim: 0.5,       // 融合权重（画像相似度）
    paperTopN: 25,   // 论文侧参与打分的高频词数量
    maxHits: 20      // 最多返回的命中词数量
  };

  /** 组装待分析的论文文本（标题/关键词各加权一次，用重复来提高词频权重） */
  function buildPaperText(paper) {
    var p = paper || {};
    var title = (p.title || '').trim();
    var kw = (p.keywords || '').trim();
    var abs = (p.abstract || '').trim();
    return [title, title, kw, kw, abs].filter(Boolean).join(' \n ');
  }

  /**
   * 计算论文与某个期刊画像的 fit 分
   * @param {string|object} paper 文本或 {title, abstract, keywords}
   * @param {object} profile Toc.buildProfile 产物
   * @param {object} [opts]
   */
  function fitScore(paper, profile, opts) {
    var o = Object.assign({}, DEFAULT_OPTS, opts || {});
    var text = (typeof paper === 'string') ? paper : buildPaperText(paper);
    var weights = (profile && profile.terms) ? profile.terms : {};

    var totalW = 0, hitW = 0, hits = [];
    for (var t in weights) totalW += weights[t];

    // 论文分词 → 精确判定命中（避免"子串巧合"）
    var freq = U.termFreq(U.tokenize(text));
    var hasTerm = {};
    for (var k in freq) hasTerm[k] = true;

    for (var t2 in weights) {
      if (hasTerm[t2]) { hitW += weights[t2]; hits.push({ term: t2, weight: weights[t2] }); }
    }

    var pCover = totalW > 0 ? hitW / totalW : 0;
    var base = 1 - Math.exp(-o.Kb * pCover);

    // 论文视角：高频词权重归一后与画像权重相乘
    var paperTop = U.topTerms(U.normalizeWeight(freq), o.paperTopN);
    var wpSum = paperTop.reduce(function (s, it) { return s + it.count; }, 0);
    var pPrec = 0;
    if (wpSum > 0) {
      paperTop.forEach(function (it) {
        var pw = weights[it.term] || 0;
        if (pw > 0) pPrec += (it.count / wpSum) * pw;
      });
    }
    var sim = 1 - Math.exp(-o.Kp * pPrec);

    var fit = Math.round(100 * (o.wBase * base + o.wSim * sim));
    fit = U.clamp(fit, 0, 100);

    hits.sort(function (a, b) { return b.weight - a.weight || (b.term.length - a.term.length) || (a.term < b.term ? -1 : 1); });

    return {
      fit: fit,
      base: +(base * 100).toFixed(1),
      sim: +(sim * 100).toFixed(1),
      pCover: +(pCover * 100).toFixed(2),
      pPrec: +(pPrec * 100).toFixed(2),
      hits: hits.slice(0, o.maxHits),
      hitCount: hits.length,
      // 最像的历史期次（按期次画像再算一次相似度）
      bestIssue: bestIssueOf(hasTerm, profile, o)
    };
  }

  /** 按期次切片的"最像期次" */
  function bestIssueOf(hasTerm, profile, o) {
    if (!profile || !profile.byIssue || !profile.byIssue.length) return null;
    var best = null;
    profile.byIssue.forEach(function (g) {
      var sum = 0, hit = [];
      (g.top || []).forEach(function (it) {
        if (hasTerm[it.term]) { sum += it.count; hit.push(it.term); }
      });
      var denom = (g.top || []).reduce(function (s, it) { return s + it.count; }, 0) || 1;
      var score = sum / denom;
      if (!best || score > best.score) best = { score: score, key: g.key, year: g.year, issue: g.issue, hits: hit };
    });
    if (!best || best.score <= 0) return null;
    return { key: best.key, year: best.year, issue: best.issue, score: +(best.score * 100).toFixed(1), hits: best.hits };
  }

  /**
   * 期刊排序推荐
   * @param {object|string} paper
   * @param {Array} journals [{name, field, note, profile}]
   * @returns {Array} 按 fit 降序，附带 journal 信息与命中词
   */
  function rankJournals(paper, journals, opts) {
    var list = (journals || []).map(function (j) {
      var res = (j.profile && j.profile.terms && Object.keys(j.profile.terms).length)
        ? fitScore(paper, j.profile, opts)
        : { fit: 0, base: 0, sim: 0, hits: [], hitCount: 0, bestIssue: null, pCover: 0, pPrec: 0, empty: true };
      return {
        id: j.id, name: j.name, field: j.field, note: j.note,
        totalTitles: j.profile ? j.profile.totalTitles : 0,
        builtAt: j.profile ? j.profile.builtAt : 0,
        fit: res.fit, base: res.base, sim: res.sim, hits: res.hits, hitCount: res.hitCount,
        bestIssue: res.bestIssue, empty: !!res.empty
      };
    });
    list.sort(function (a, b) {
      return b.fit - a.fit || b.hitCount - a.hitCount || (a.name < b.name ? -1 : 1);
    });
    return list;
  }

  /** 匹配等级文案 */
  function fitLevel(fit) {
    if (fit >= 70) return { text: '高度契合', cls: 'lv-high' };
    if (fit >= 45) return { text: '较为契合', cls: 'lv-mid' };
    if (fit >= 20) return { text: '方向相关', cls: 'lv-low' };
    return { text: '契合度低', cls: 'lv-bad' };
  }

  var Match = {
    buildPaperText: buildPaperText,
    fitScore: fitScore,
    rankJournals: rankJournals,
    fitLevel: fitLevel,
    DEFAULT_OPTS: DEFAULT_OPTS
  };

  global.Match = Match;
  if (typeof module !== 'undefined' && module.exports) module.exports = Match;
})(typeof window !== 'undefined' ? window : globalThis);
