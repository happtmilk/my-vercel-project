/* =========================================================================
 * store.js —— localStorage 持久层
 *  · 所有键统一前缀 paperwb_ ，避免污染同域其它应用
 *  · 纯前端存储，数据只存在用户自己的浏览器里
 * ========================================================================= */
(function (global) {
  'use strict';

  var PREFIX = 'paperwb_';

  // 统一键名表
  var KEYS = {
    journals: 'journals',        // 期刊库（含 TOC 条目与画像）
    drafts: 'drafts',            // 论文草稿
    metrics: 'metrics_data',     // 计量分析数据集
    tasks: 'tasks',              // 研究进度看板
    library: 'library',          // 资料库
    settings: 'settings',        // 偏好设置
    analyzeSeed: 'analyze_seed', // 写作 → 选刊 的临时投喂数据
    lastAnalysis: 'last_analysis',
    lastPage: 'last_page'
  };

  var memoryFallback = {};       // localStorage 不可用时的降级（如隐私模式）

  function _ls() {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return null;
      localStorage.setItem(PREFIX + '__probe', '1');
      localStorage.removeItem(PREFIX + '__probe');
      return localStorage;
    } catch (e) { return null; }
  }

  function fullKey(k) { return PREFIX + k; }

  function get(key, def) {
    var ls = _ls();
    if (!ls) return key in memoryFallback ? memoryFallback[key] : def;
    try {
      var raw = ls.getItem(fullKey(key));
      if (raw === null || raw === undefined) return def;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('[store] 读取失败:', key, e);
      return def;
    }
  }

  function set(key, value) {
    var ls = _ls();
    if (!ls) { memoryFallback[key] = value; return value; }
    try {
      ls.setItem(fullKey(key), JSON.stringify(value));
    } catch (e) {
      console.warn('[store] 写入失败(可能超出配额):', key, e);
      if (global.Util && Util.toast) Util.toast('本地存储写入失败：可能超出浏览器配额', 'error');
    }
    return value;
  }

  function remove(key) {
    var ls = _ls();
    if (!ls) { delete memoryFallback[key]; return; }
    try { ls.removeItem(fullKey(key)); } catch (e) { /* ignore */ }
  }

  /** 清空本应用的所有数据（不触碰其他前缀的键） */
  function clearAll() {
    var ls = _ls();
    if (!ls) { memoryFallback = {}; return; }
    var victims = [];
    for (var i = 0; i < ls.length; i++) {
      var k = ls.key(i);
      if (k && k.indexOf(PREFIX) === 0) victims.push(k);
    }
    victims.forEach(function (k) { ls.removeItem(k); });
  }

  /** 估算已占用空间（字节） */
  function usage() {
    var ls = _ls();
    if (!ls) return 0;
    var total = 0;
    for (var i = 0; i < ls.length; i++) {
      var k = ls.key(i);
      if (k && k.indexOf(PREFIX) === 0) total += (k.length + (ls.getItem(k) || '').length) * 2;
    }
    return total;
  }

  /** 导入 / 导出整站数据（纯本地 JSON，便于用户自己备份） */
  function exportAll() {
    var data = { _app: 'paper-workbench', _version: 1, _exportedAt: new Date().toISOString() };
    Object.keys(KEYS).forEach(function (name) { data[name] = get(KEYS[name], null); });
    return data;
  }

  function importAll(data) {
    if (!data || typeof data !== 'object') throw new Error('数据格式不正确');
    Object.keys(KEYS).forEach(function (name) {
      if (Object.prototype.hasOwnProperty.call(data, name) && data[name] !== null) set(KEYS[name], data[name]);
    });
  }

  var Store = {
    PREFIX: PREFIX, KEYS: KEYS,
    get: get, set: set, remove: remove, clearAll: clearAll,
    usage: usage, exportAll: exportAll, importAll: importAll
  };

  global.Store = Store;
  if (typeof module !== 'undefined' && module.exports) module.exports = Store;
})(typeof window !== 'undefined' ? window : globalThis);
