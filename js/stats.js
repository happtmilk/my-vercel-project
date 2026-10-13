/* =========================================================================
 * stats.js —— 计量分析引擎（纯函数，无依赖）
 *   · toDataset(rows)      二维数组 → {headers, data}
 *   · describe(values)     描述统计
 *   · pearson / corrMatrix 相关性
 *   · ols(y, X, names)     多元线性回归（正规方程 + 高斯消元）
 * ========================================================================= */
(function (global) {
  'use strict';

  var U = global.Util;

  /* ------------------------- 数据整理 ------------------------- */

  function toNumber(v) {
    if (v === null || v === undefined) return NaN;
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    var s = String(v).trim().replace(/,/g, '').replace(/[¥$￥\s]/g, '');
    if (s === '' || s === '-' || s === '—' || /^(na|nan|null|none|缺失)$/i.test(s)) return NaN;
    var pct = /%$/.test(s);
    if (pct) s = s.replace(/%$/, '');
    var n = Number(s);
    if (!isFinite(n)) return NaN;
    return pct ? n : n;
  }

  function isNumericLike(v) {
    if (v === null || v === undefined || v === '') return false;
    return !isNaN(toNumber(v));
  }

  /**
   * 二维数组 → 数据集。首行若含非数值单元格、且次行含数值，则视为表头。
   * @returns {{headers:string[], data:Array<Array<string>>, hasHeader:boolean}}
   */
  function toDataset(rows) {
    var table = (rows || []).filter(function (r) { return r && r.some(function (c) { return String(c === null || c === undefined ? '' : c).trim() !== ''; }); })
      .map(function (r) { return (r || []).map(function (c) { return String(c === null || c === undefined ? '' : c).trim(); }); });
    if (!table.length) return { headers: [], data: [], hasHeader: false };

    var width = table.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    table = table.map(function (r) { var c = r.slice(); while (c.length < width) c.push(''); return c; });

    var first = table[0];
    var nonNumFirst = first.filter(function (c) { return c !== '' && !isNumericLike(c); }).length;
    var second = table[1] || [];
    var numSecond = second.filter(isNumericLike).length;
    var hasHeader = nonNumFirst > 0 && (table.length === 1 || numSecond >= Math.max(1, Math.floor(width / 2)));

    var headers, data;
    if (hasHeader) {
      headers = first.map(function (c, i) { return c || ('列' + (i + 1)); });
      data = table.slice(1);
    } else {
      headers = first.map(function (_, i) { return '列' + String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : ''); });
      data = table;
    }
    headers = uniqueHeaders(headers);
    return { headers: headers, data: data, hasHeader: hasHeader };
  }

  function uniqueHeaders(hs) {
    var seen = {};
    return hs.map(function (h, i) {
      var base = String(h || ('列' + (i + 1))).trim() || ('列' + (i + 1));
      if (seen[base] === undefined) { seen[base] = 1; return base; }
      seen[base] += 1;
      return base + '_' + seen[base];
    });
  }

  /** 找出数值列索引 */
  function numericColumnIndexes(dataset) {
    return dataset.headers.map(function (_, i) {
      var vals = dataset.data.map(function (r) { return toNumber(r[i]); }).filter(function (v) { return !isNaN(v); });
      return vals.length >= Math.max(2, Math.ceil(dataset.data.length * 0.5)) ? i : -1;
    }).filter(function (i) { return i >= 0; });
  }

  function column(dataset, idx) {
    return dataset.data.map(function (r) { return toNumber(r[idx]); }).filter(function (v) { return !isNaN(v); });
  }

  /* ------------------------- 描述统计 ------------------------- */

  function quantile(sorted, p) {
    if (!sorted.length) return NaN;
    var pos = (sorted.length - 1) * p, base = Math.floor(pos), rest = pos - base;
    if (sorted[base + 1] !== undefined) return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    return sorted[base];
  }

  function describe(values) {
    var v = (values || []).filter(function (x) { return typeof x === 'number' && !isNaN(x); });
    var n = v.length;
    if (!n) return { n: 0, mean: NaN, sd: NaN, min: NaN, q1: NaN, median: NaN, q3: NaN, max: NaN, range: NaN, sum: NaN };
    var sum = v.reduce(function (a, b) { return a + b; }, 0);
    var mean = sum / n;
    var varp = n > 1 ? v.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / (n - 1) : 0;
    var s = v.slice().sort(function (a, b) { return a - b; });
    return {
      n: n, sum: sum, mean: mean, sd: Math.sqrt(varp),
      min: s[0], q1: quantile(s, 0.25), median: quantile(s, 0.5), q3: quantile(s, 0.75),
      max: s[n - 1], range: s[n - 1] - s[0],
      cv: mean !== 0 ? Math.sqrt(varp) / Math.abs(mean) : NaN
    };
  }

  /* ------------------------- 相关分析 ------------------------- */

  /** Pearson 相关系数（成对剔除缺失） */
  function pearson(x, y) {
    var n = Math.min(x.length, y.length), xs = [], ys = [];
    for (var i = 0; i < n; i++) {
      var a = x[i], b = y[i];
      if (typeof a === 'number' && typeof b === 'number' && !isNaN(a) && !isNaN(b)) { xs.push(a); ys.push(b); }
    }
    var m = xs.length;
    if (m < 3) return { r: NaN, n: m };
    var mx = xs.reduce(function (s, v) { return s + v; }, 0) / m;
    var my = ys.reduce(function (s, v) { return s + v; }, 0) / m;
    var sxy = 0, sxx = 0, syy = 0;
    for (var j = 0; j < m; j++) {
      var dx = xs[j] - mx, dy = ys[j] - my;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    if (sxx === 0 || syy === 0) return { r: NaN, n: m };
    return { r: sxy / Math.sqrt(sxx * syy), n: m };
  }

  /** 相关系数矩阵（含 p 值近似与显著性标记） */
  function corrMatrix(dataset, idxs) {
    var cols = idxs.map(function (i) { return dataset.data.map(function (r) { return toNumber(r[i]); }); });
    var names = idxs.map(function (i) { return dataset.headers[i]; });
    var m = [];
    for (var a = 0; a < cols.length; a++) {
      m.push([]);
      for (var b = 0; b < cols.length; b++) {
        var r = pearson(cols[a], cols[b]);
        m[a].push({ r: r.r, n: r.n, p: pValueFromR(r.r, r.n), sig: sigMark(pValueFromR(r.r, r.n)) });
      }
    }
    return { names: names, matrix: m };
  }

  /** t 检验 p 值（two-sided），用不完全 beta 的连分式近似 */
  function pValueFromR(r, n) {
    if (isNaN(r) || n < 3) return NaN;
    var df = n - 2;
    var t = Math.abs(r) * Math.sqrt(df / Math.max(1e-12, 1 - r * r));
    return betai(df / (df + t * t), df / 2, 0.5);
  }

  function betai(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    var lbeta = logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
    var bt = Math.exp(lbeta);
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(x, a, b) / a;
    return 1 - bt * betacf(1 - x, b, a) / b;
  }

  function betacf(x, a, b) {
    var MAXIT = 200, EPS = 3e-9, FPMIN = 1e-30;
    var qab = a + b, qap = a + 1, qam = a - 1;
    var c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    var h = d;
    for (var m = 1; m <= MAXIT; m++) {
      var m2 = 2 * m;
      var aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      var del = d * c;
      h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }

  function logGamma(x) {
    var c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    var y = x, tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    var ser = 1.000000000190015;
    for (var j = 0; j < 6; j++) { y += 1; ser += c[j] / y; }
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }

  function sigMark(p) {
    if (isNaN(p)) return '';
    if (p < 0.001) return '***';
    if (p < 0.01) return '**';
    if (p < 0.05) return '*';
    if (p < 0.1) return '.';
    return '';
  }

  /* ------------------------- 回归建模 ------------------------- */

  /** 解线性方程组 A·x = b（高斯消元 + 部分选主元）；A 为 n×n 数组 */
  function solveLinear(A, b) {
    var n = b.length;
    var M = A.map(function (row, i) { return row.concat([b[i]]); });
    for (var col = 0; col < n; col++) {
      var piv = col;
      for (var r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      if (Math.abs(M[piv][col]) < 1e-12) return null;         // 奇异矩阵（多重共线）
      var t = M[col]; M[col] = M[piv]; M[piv] = t;
      for (var r2 = col + 1; r2 < n; r2++) {
        var f = M[r2][col] / M[col][col];
        if (f === 0) continue;
        for (var c2 = col; c2 <= n; c2++) M[r2][c2] -= f * M[col][c2];
      }
    }
    var x = new Array(n);
    for (var i = n - 1; i >= 0; i--) {
      var s = M[i][n];
      for (var j = i + 1; j < n; j++) s -= M[i][j] * x[j];
      x[i] = s / M[i][i];
    }
    return x;
  }

  function invert(A) {
    var n = A.length;
    var M = A.map(function (row, i) {
      var r = row.slice();
      for (var j = 0; j < n; j++) r.push(i === j ? 1 : 0);
      return r;
    });
    for (var col = 0; col < n; col++) {
      var piv = col;
      for (var r2 = col + 1; r2 < n; r2++) if (Math.abs(M[r2][col]) > Math.abs(M[piv][col])) piv = r2;
      if (Math.abs(M[piv][col]) < 1e-12) return null;
      var t = M[col]; M[col] = M[piv]; M[piv] = t;
      var pv = M[col][col];
      for (var c2 = 0; c2 < 2 * n; c2++) M[col][c2] /= pv;
      for (var r3 = 0; r3 < n; r3++) {
        if (r3 === col) continue;
        var f = M[r3][col];
        if (f === 0) continue;
        for (var c3 = 0; c3 < 2 * n; c3++) M[r3][c3] -= f * M[col][c3];
      }
    }
    return M.map(function (row) { return row.slice(n); });
  }

  /**
   * 多元线性回归（最小二乘，含常数项）
   * @param {string[]} yVals 因变量（已转数值，可含 NaN 表示缺失）
   * @param {Array<string[]>} xCols 自变量列
   * @param {string[]} xNames
   */
  function ols(yVals, xCols, xNames) {
    var rows = [];
    for (var i = 0; i < yVals.length; i++) {
      var y = yVals[i];
      if (typeof y !== 'number' || isNaN(y)) continue;
      var xs = [], ok = true;
      for (var c = 0; c < xCols.length; c++) {
        var v = xCols[c][i];
        if (typeof v !== 'number' || isNaN(v)) { ok = false; break; }
        xs.push(v);
      }
      if (!ok) continue;
      rows.push({ y: y, x: xs });
    }
    var n = rows.length, p = xCols.length;
    if (n < p + 3) return { ok: false, message: '有效样本不足（需 n ≥ 自变量个数 + 3，以保证残差自由度 ≥ 2），当前 n=' + n + '，自变量 ' + p + ' 个。' };

    // 设计矩阵 X = [1, x...]
    var X = rows.map(function (r) { return [1].concat(r.x); });
    var Y = rows.map(function (r) { return r.y; });
    var k = p + 1;

    var XtX = [], XtY = [];
    for (var a = 0; a < k; a++) {
      XtX.push(new Array(k).fill(0));
      var s = 0;
      for (var r2 = 0; r2 < n; r2++) { s += X[r2][a] * Y[r2]; }
      XtY.push(s);
      for (var b = 0; b < k; b++) {
        var s2 = 0;
        for (var r3 = 0; r3 < n; r3++) s2 += X[r3][a] * X[r3][b];
        XtX[a][b] = s2;
      }
    }

    var beta = solveLinear(XtX, XtY);
    if (!beta) return { ok: false, message: '自变量之间存在完全共线性，无法求解。请去掉冗余变量。' };

    // 残差与拟合优度
    var ybar = Y.reduce(function (s, v) { return s + v; }, 0) / n;
    var sse = 0, sst = 0;
    var preds = [];
    for (var r4 = 0; r4 < n; r4++) {
      var yh = 0;
      for (var j = 0; j < k; j++) yh += beta[j] * X[r4][j];
      preds.push(yh);
      sse += (Y[r4] - yh) * (Y[r4] - yh);
      sst += (Y[r4] - ybar) * (Y[r4] - ybar);
    }
    var r2 = sst > 0 ? 1 - sse / sst : NaN;
    var dfRes = n - k;
    var mse = dfRes > 0 ? sse / dfRes : NaN;
    var adjR2 = (dfRes > 0 && !isNaN(r2)) ? 1 - (1 - r2) * (n - 1) / dfRes : NaN;

    // 标准误 / t 值 / p 值
    var XtXinv = invert(XtX);
    var names = ['(常数项)'].concat(xNames || []);
    var se = [], t = [], pv = [];
    for (var g = 0; g < k; g++) {
      var varb = XtXinv ? XtXinv[g][g] * mse : NaN;
      var s = Math.sqrt(Math.max(0, varb));
      se.push(s);
      var tv = s > 0 ? beta[g] / s : NaN;
      t.push(tv);
      pv.push(isNaN(tv) || dfRes <= 0 ? NaN : betai(dfRes / (dfRes + tv * tv), dfRes / 2, 0.5));
    }

    // F 统计量
    var msr = (sst - sse) / Math.max(1, p);
    var f = p > 0 && mse > 0 ? msr / mse : NaN;
    var fP = (isNaN(f) || p <= 0 || dfRes <= 0) ? NaN : betai(dfRes / (dfRes + p * f), dfRes / 2, p / 2);

    return {
      ok: true, n: n, p: p,
      names: names, beta: beta, se: se, t: t, p: pv, sig: pv.map(sigMark),
      r2: r2, adjR2: adjR2, sse: sse, sst: sst, mse: mse, rmse: Math.sqrt(mse),
      f: f, dfRes: dfRes, preds: preds, y: Y
    };
  }

  function fmt(v, d) {
    if (typeof v !== 'number' || isNaN(v)) return '—';
    var dd = d === undefined ? 4 : d;
    if (Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-4 && v !== 0)) return v.toExponential(3);
    return Number(v.toFixed(dd)).toString();
  }

  var Stats = {
    toNumber: toNumber, isNumericLike: isNumericLike, toDataset: toDataset,
    numericColumnIndexes: numericColumnIndexes, column: column,
    describe: describe, quantile: quantile, pearson: pearson, corrMatrix: corrMatrix,
    ols: ols, sigMark: sigMark, pValueFromR: pValueFromR, fmt: fmt
  };

  global.Stats = Stats;
  if (typeof module !== 'undefined' && module.exports) module.exports = Stats;
})(typeof window !== 'undefined' ? window : globalThis);
