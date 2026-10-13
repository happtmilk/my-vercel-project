/* =========================================================================
 * app.js —— 单页应用壳：导航 + 哈希路由 + 启动
 *   PAGES 映射：路由 key → function XxxPage(root, param)
 * ========================================================================= */
(function (global) {
  'use strict';

  var U = global.Util, h = U.h;

  /** 路由表：key → 页面函数（函数对象模式，签名统一为 (root, param)） */
  var PAGES = {
    write: { title: '写作', icon: '✎', fn: 'WritePage', desc: '草稿 · 章节 · 字数' },
    journals: { title: '期刊库', icon: '▤', fn: 'JournalsPage', desc: '录用目录 · 画像' },
    analyze: { title: '选刊分析', icon: '◎', fn: 'AnalyzePage', desc: 'fit 匹配打分' },
    metrics: { title: '计量分析', icon: '∑', fn: 'MetricsPage', desc: '统计 · 相关 · 回归' },
    dash: { title: '进度看板', icon: '✓', fn: 'DashPage', desc: '任务与里程碑' },
    library: { title: '资料库', icon: '❐', fn: 'LibraryPage', desc: '文献 · 笔记 · 链接' },
    search: { title: '文献检索', icon: '⌕', fn: 'SearchPage', desc: '外链检索 + 本机检索' },
    about: { title: '数据与关于', icon: 'ⓘ', fn: 'AboutPage', desc: '备份 · 清空 · 说明' }
  };

  var DEFAULT_ROUTE = 'write';

  /** 页面函数解析：优先全局同名函数，其次 PAGES 注册表，最后允许直接写函数引用 */
  function resolvePage(nameOrFn) {
    if (typeof nameOrFn === 'function') return nameOrFn;
    if (typeof nameOrFn !== 'string') return null;
    if (typeof global[nameOrFn] === 'function') return global[nameOrFn];
    if (global.PAGES && typeof global.PAGES[nameOrFn] === 'function') return global.PAGES[nameOrFn];
    return null;
  }

  function parseHash() {
    var raw = String(location.hash || '').replace(/^#\/?/, '');
    var parts = raw.split('/');
    var key = parts.shift() || '';
    return { key: key, param: parts.join('/') ? decodeURIComponent(parts.join('/')) : null };
  }

  function buildNav() {
    var nav = h('nav', { class: 'nav' });
    Object.keys(PAGES).forEach(function (k) {
      var p = PAGES[k];
      nav.appendChild(h('a', {
        class: 'nav-item', href: '#/' + k, dataset: { route: k },
        title: p.title + ' · ' + p.desc
      }, h('span', { class: 'nav-ico', text: p.icon }), h('span', { class: 'nav-text', text: p.title })));
    });
    return nav;
  }

  function markActive(key) {
    U.$$('.nav-item').forEach(function (a) {
      a.classList.toggle('active', a.dataset.route === key);
    });
  }

  function render(key, param) {
    var route = PAGES[key] ? key : DEFAULT_ROUTE;
    var def = PAGES[route];
    var fn = resolvePage(def.fn);
    var root = U.$('#view');
    if (!root) return;
    U.clear(root);
    document.title = def.title + ' · 论文写作与选刊工作台';
    if (typeof fn !== 'function') {
      root.appendChild(h('div', { class: 'page' }, h('p', { class: 'warn-text', text: '页面模块未加载：' + def.fn })));
      return;
    }
    try {
      fn(root, param);
    } catch (err) {
      console.error('[app] 页面渲染失败:', err);
      root.appendChild(h('div', { class: 'page' },
        h('p', { class: 'warn-text', text: '页面渲染出错：' + (err && err.message) }),
        h('pre', { class: 'code', text: String(err && err.stack || err) })));
    }
    markActive(route);
    Store.set('last_page', route);
  }

  function boot() {
    var layout = U.$('#app');
    var current = parseHash();
    // 顶栏 + 侧栏骨架
    var shell = h('div', { class: 'shell' },
      h('aside', { class: 'sidebar' },
        h('div', { class: 'brand' },
          h('div', { class: 'brand-mark', text: 'PW' }),
          h('div', { class: 'brand-text' },
            h('strong', { text: '论文工作台' }),
            h('span', { class: 'muted small', text: '写作 · 选刊 · 计量' }))),
        buildNav(),
        h('div', { class: 'sidebar-foot' },
          h('p', { class: 'muted small', text: '数据仅存本机浏览器' }),
          h('p', { class: 'muted small', text: 'v1.0 · 纯前端零依赖' }))),
      h('main', { class: 'main' }, h('div', { id: 'view', class: 'view' })));
    U.clear(layout);
    layout.appendChild(shell);

    window.addEventListener('hashchange', function () {
      var r = parseHash();
      render(r.key, r.param);
      U.$('.main').scrollTop = 0;
    });

    if (!current.key) {
      var last = Store.get('last_page', DEFAULT_ROUTE);
      if (!PAGES[last]) last = DEFAULT_ROUTE;
      location.hash = '#/' + last;
    }
    render(current.key, current.param);

    // 全局错误兜底：保证控制台干净、用户看得到提示
    window.addEventListener('error', function (e) {
      console.error('[window error]', e.message);
    });
    console.log('%c论文写作与选刊工作台 已启动', 'color:#2563eb;font-weight:bold');
    console.log('可用模块：' + Object.keys(PAGES).join(' / '));
  }

  global.App = { PAGES: PAGES, boot: boot, render: render, parseHash: parseHash };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
