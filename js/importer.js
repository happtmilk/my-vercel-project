/* =========================================================================
 * importer.js —— 统一文件导入入口
 *   readImportedFile(file, mode)  →  浏览器端（FileReader）
 *   Importer.parseCore(name, data) →  纯函数内核，Node 测试可直接调用
 *
 *   支持：.xlsx/.xls（SheetJS 取第一张表 → 二维数组）
 *         .docx（mammoth 提取正文文本）
 *         .csv/.tsv/.txt（文本，同时给出二维数组）
 *         .doc（友好提示另存为 .docx）
 *   全部本地解析，不发起任何网络请求。
 * ========================================================================= */
(function (global) {
  'use strict';

  var libs = {
    XLSX: (typeof global.XLSX !== 'undefined' ? global.XLSX : null),
    mammoth: (typeof global.mammoth !== 'undefined' ? global.mammoth : null)
  };

  /** 允许外部注入解析库（Node 测试用） */
  function configure(opts) {
    if (opts && opts.XLSX) libs.XLSX = opts.XLSX;
    if (opts && opts.mammoth) libs.mammoth = opts.mammoth;
  }

  function extOf(name) {
    var m = /\.([A-Za-z0-9]+)\s*$/.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  }

  /** 单元格数组 → 干净二维数组（去全空行、去尾部空列、统一转字符串） */
  function tidyRows(rows) {
    var out = [];
    (rows || []).forEach(function (row) {
      var r = (row || []).map(function (c) {
        if (c === null || c === undefined) return '';
        if (c instanceof Date) return c.getFullYear() + ''; // 年份被识别成日期时取年份
        return String(c).replace(/\s+/g, ' ').trim();
      });
      while (r.length && r[r.length - 1] === '') r.pop();
      if (r.some(function (c) { return c !== ''; })) out.push(r);
    });
    return out;
  }

  function rowsToText(rows) {
    return tidyRows(rows).map(function (r) {
      return r.filter(function (c) { return c !== ''; }).join('\t');
    }).join('\n');
  }

  function readXlsx(buf) {
    if (!libs.XLSX) throw new Error('SheetJS 未加载（js/vendor/xlsx.full.min.js）');
    var wb = libs.XLSX.read(new Uint8Array(buf), { type: 'array' });
    var sheetName = wb.SheetNames && wb.SheetNames[0];
    if (!sheetName) throw new Error('Excel 中没有可读的工作表');
    var ws = wb.Sheets[sheetName];
    var aoa = libs.XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false });
    return { rows: tidyRows(aoa), sheetName: sheetName };
  }

  function readDocx(buf) {
    if (!libs.mammoth) throw new Error('mammoth 未加载（js/vendor/mammoth.browser.min.js）');
    return libs.mammoth.extractRawText({ arrayBuffer: buf }).then(function (res) {
      return (res && res.value ? res.value : '').replace(/\r\n?/g, '\n');
    });
  }

  function explainError(err) {
    var msg = (err && err.message) ? err.message : String(err);
    if (/password|encrypt/i.test(msg)) return '文件已加密，请先取消密码保护再导入。';
    if (/CFB|End of data|Bad|corrupt|zip/i.test(msg)) return '文件内容无法解析，可能已损坏或格式不符。';
    return '解析失败：' + msg;
  }

  /**
   * 纯函数内核：按扩展名解析，返回统一结构。
   * @param {string} name 文件名（决定扩展名）
   * @param {ArrayBuffer|string} data 二进制或文本
   * @param {string} [mode] 'auto' | 'table' | 'text'
   * @returns {Promise<{ok, kind, rows, text, name, ext, message}>}
   */
  function parseCore(name, data, mode) {
    var ext = extOf(name);
    var m = mode || 'auto';
    return Promise.resolve().then(function () {
      if (ext === 'doc') {
        return {
          ok: false, kind: 'error', rows: null, text: '', name: name, ext: ext,
          message: '检测到旧版 .doc 格式，浏览器无法直接解析：请在 Word 中「另存为 .docx」后重新上传，或改用「粘贴文本」方式导入。'
        };
      }
      if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') {
        var r = readXlsx(data);
        return {
          ok: true, kind: 'table', rows: r.rows, text: rowsToText(r.rows),
          name: name, ext: ext, sheetName: r.sheetName,
          message: '已解析 Excel「' + r.sheetName + '」，共 ' + r.rows.length + ' 行。'
        };
      }
      if (ext === 'docx') {
        return readDocx(data).then(function (text) {
          if (!text.trim()) throw new Error('文档正文为空');
          return { ok: true, kind: 'text', rows: null, text: text, name: name, ext: ext, message: '已提取 Word 正文，共 ' + text.length + ' 字符。' };
        });
      }
      if (ext === 'csv' || ext === 'tsv' || ext === 'txt' || ext === 'text' || ext === '') {
        var txt = typeof data === 'string' ? data : new TextDecoder('utf-8').decode(data);
        var sep = (ext === 'tsv') ? '\t' : undefined;
        var rows = (Util.parseDelimited(txt, sep));
        return {
          ok: true, kind: (m === 'text' ? 'text' : 'table'), rows: rows, text: txt,
          name: name, ext: ext || 'txt',
          message: '已读取文本文件，共 ' + rows.length + ' 行。'
        };
      }
      return { ok: false, kind: 'error', rows: null, text: '', name: name, ext: ext, message: '不支持的文件类型 .' + ext + '（支持 xlsx/xls/docx/csv/tsv/txt）' };
    }).catch(function (err) {
      return { ok: false, kind: 'error', rows: null, text: '', name: name, ext: ext, message: explainError(err) };
    });
  }

  /**
   * 浏览器统一入口。
   * @param {File} file
   * @param {string} [mode] 'auto' | 'table' | 'text'
   */
  function readImportedFile(file, mode) {
    return new Promise(function (resolve) {
      if (!file) { resolve({ ok: false, kind: 'error', message: '没有选择文件' }); return; }
      var ext = extOf(file.name);
      if (ext === 'doc') { resolve(parseCore(file.name, '', 'auto')); return; }
      var needBinary = (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm' || ext === 'docx');
      if (typeof FileReader === 'undefined') {   // 极端降级：直接拿 file 内容
        resolve({ ok: false, kind: 'error', message: '当前环境不支持文件读取' }); return;
      }
      var fr = new FileReader();
      fr.onerror = function () { resolve({ ok: false, kind: 'error', message: '文件读取失败' }); };
      fr.onload = function () { resolve(parseCore(file.name, fr.result, mode)); };
      if (needBinary) fr.readAsArrayBuffer(file);
      else fr.readAsText(file, 'utf-8');
    });
  }

  var Importer = {
    configure: configure, extOf: extOf, tidyRows: tidyRows, rowsToText: rowsToText,
    parseCore: parseCore, readImportedFile: readImportedFile,
    ACCEPT: '.xlsx,.xls,.xlsm,.docx,.csv,.tsv,.txt'
  };

  global.Importer = Importer;
  if (typeof module !== 'undefined' && module.exports) module.exports = Importer;
})(typeof window !== 'undefined' ? window : globalThis);
