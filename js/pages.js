/* =========================================================================
 * pages.js —— 各业务页面
 * 统一约定：function XxxPage(root, param) { ... }，由 app.js 的 PAGES 路由调用。
 * 每个页面自行负责渲染与事件绑定，数据全部通过 Store 读写 localStorage。
 * ========================================================================= */
(function (global) {
  'use strict';

  var U = global.Util, h = U.h, esc = U.esc;

  /* ===================================================================== */
  /* 0. 通用 UI 组件                                                       */
  /* ===================================================================== */

  function btn(text, cls, onclick) {
    return h('button', { class: 'btn ' + (cls || ''), type: 'button', onclick: onclick }, text);
  }

  function pageHead(title, desc, actions) {
    return h('div', { class: 'page-head' },
      h('div', { class: 'ph-left' },
        h('h2', { text: title }),
        desc ? h('p', { class: 'muted', text: desc }) : null),
      h('div', { class: 'head-actions' }, actions || null));
  }

  function panel(title, extra, body) {
    return h('section', { class: 'panel' },
      title ? h('div', { class: 'panel-head' },
        h('h3', { text: title }),
        h('div', { class: 'panel-extra' }, extra || null)) : null,
      h('div', { class: 'panel-body' }, body));
  }

  function emptyBox(text, action) {
    return h('div', { class: 'empty' }, h('div', { class: 'empty-ico', text: '◌' }), h('p', { text: text }), action || null);
  }

  function field(label, control, hint) {
    return h('label', { class: 'field' },
      h('span', { class: 'field-label', text: label }),
      control,
      hint ? h('span', { class: 'field-hint', text: hint }) : null);
  }

  /** 标签页：所有面板常驻 DOM（非活动面板加 hidden），便于切换保留状态与表单值 */
  function tabs(items) {
    var wrap = h('div', { class: 'tabs' });
    var body = h('div', { class: 'tab-body' });
    var buttons = [], panes = [];
    items.forEach(function (it, i) {
      var pane = h('div', { class: 'tab-pane' });
      U.append(pane, it.content());
      panes.push(pane); body.appendChild(pane);
      var b = h('button', { class: 'tab' + (i === 0 ? ' active' : ''), type: 'button', onclick: function () { select(i); } }, it.label);
      buttons.push(b); wrap.appendChild(b);
    });
    function select(i) {
      buttons.forEach(function (b, j) { b.classList.toggle('active', i === j); });
      panes.forEach(function (p, j) { p.classList.toggle('hidden', i !== j); });
    }
    if (items.length) select(0);
    return h('div', {}, wrap, body);
  }

  /** 通用弹窗：modal({title, body, footer, wide}) → {close, el} */
  function modal(opts) {
    var overlay = h('div', { class: 'modal-overlay' });
    var box = h('div', { class: 'modal' + (opts.wide ? ' wide' : '') });
    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    box.appendChild(h('div', { class: 'modal-head' },
      h('h3', { text: opts.title }),
      h('button', { class: 'icon-btn', type: 'button', title: '关闭', onclick: close }, '✕')));
    box.appendChild(h('div', { class: 'modal-body' }, opts.body));
    if (opts.footer) box.appendChild(h('div', { class: 'modal-foot' }, opts.footer));
    overlay.appendChild(box);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    return { close: close, el: box, setFooter: function (n) { U.clear(box.querySelector('.modal-foot')); U.append(box.querySelector('.modal-foot'), n); } };
  }

  function confirmBox(title, message, onOk, okText) {
    var m = modal({
      title: title,
      body: h('p', { class: 'confirm-msg', text: message }),
      footer: [
        btn('取消', 'ghost', function () { m.close(); }),
        btn(okText || '确认', 'danger', function () { m.close(); onOk(); })
      ]
    });
    return m;
  }

  function chips(items, cls) {
    return h('div', { class: 'chips' }, items.map(function (t) {
      return h('span', { class: 'chip ' + (cls || ''), text: typeof t === 'string' ? t : t.text, title: t.title || '' });
    }));
  }

  function miniStat(label, value) {
    return h('div', { class: 'mini-stat' }, h('div', { class: 'ms-val', text: value }), h('div', { class: 'ms-lab', text: label }));
  }

  /* ===================================================================== */
  /* 1. 写作模块                                                           */
  /* ===================================================================== */

  function WritePage(root, param) {
    var KEY = 'drafts';
    var drafts = Store.get(KEY, []);
    var currentId = param || (drafts[0] ? drafts[0].id : null);
    var el = h('div', { class: 'page' });
    root.appendChild(el);

    function save() { Store.set(KEY, drafts); }
    function find(id) { for (var i = 0; i < drafts.length; i++) if (drafts[i].id === id) return drafts[i]; return null; }
    function draftText(d) { return (d.sections || []).map(function (s) { return s.text || ''; }).join('\n'); }
    function newDraft() {
      var d = {
        id: U.uid('draft'), title: '未命名论文', author: '', keywords: '',
        sections: [{ id: U.uid('sec'), name: '摘要', text: '' }, { id: U.uid('sec'), name: '引言', text: '' }, { id: U.uid('sec'), name: '方法', text: '' }],
        createdAt: Date.now(), updatedAt: Date.now()
      };
      drafts.unshift(d); currentId = d.id; save(); render();
    }

    function render() {
      U.clear(el);
      var d = find(currentId);

      el.appendChild(pageHead('论文写作', '章节化管理 + 实时字数统计（中文字符 + 英文单词），全部保存在本机浏览器。',
        [btn('新建草稿', 'primary', newDraft)]));

      var layout = h('div', { class: 'two-col' });
      /* ---- 左：草稿列表 ---- */
      var listBody = h('div', { class: 'draft-list' });
      if (!drafts.length) listBody.appendChild(emptyBox('还没有草稿，点右上「新建草稿」开始。'));
      drafts.forEach(function (dd) {
        var wc = U.countWords(draftText(dd));
        listBody.appendChild(h('div', { class: 'draft-item' + (dd.id === currentId ? ' active' : ''), onclick: function () { currentId = dd.id; render(); } },
          h('div', { class: 'di-main' },
            h('div', { class: 'di-title', text: dd.title || '未命名论文' }),
            h('div', { class: 'di-meta', text: (dd.sections || []).length + ' 章节 · ' + wc.total + ' 字 · ' + U.fmtDate(dd.updatedAt).slice(5) })),
          h('button', {
            class: 'icon-btn', type: 'button', title: '删除草稿',
            onclick: function (e) {
              e.stopPropagation();
              confirmBox('删除草稿', '确定删除《' + (dd.title || '未命名论文') + '》？此操作不可撤销。', function () {
                drafts = drafts.filter(function (x) { return x.id !== dd.id; });
                if (currentId === dd.id) currentId = drafts[0] ? drafts[0].id : null;
                save(); render();
              });
            }
          }, '✕')));
      });
      layout.appendChild(panel('草稿（' + drafts.length + '）', null, listBody));

      /* ---- 右：编辑器 ---- */
      if (!d) {
        layout.appendChild(panel('编辑器', null, emptyBox('选择或新建一份草稿开始写作。', btn('新建草稿', 'primary', newDraft))));
      } else {
        var totalEl = h('span', { class: 'word-badge', text: U.countFmt(draftText(d)) });
        var secWrap = h('div', {});

        var titleInput = h('input', {
          class: 'input title-input', value: d.title || '', placeholder: '论文标题',
          oninput: function () { d.title = this.value; d.updatedAt = Date.now(); save(); refreshList(); }
        });
        var kwInput = h('input', {
          class: 'input', value: d.keywords || '', placeholder: '关键词（逗号分隔，可一键送到选刊分析）',
          oninput: function () { d.keywords = this.value; d.updatedAt = Date.now(); save(); }
        });

        function refreshCounter() { totalEl.textContent = U.countFmt(draftText(d)); }
        var refreshList = U.debounce(function () {
          // 只刷新左侧当前项的标题与右侧总字数，避免输入过程中丢失焦点
          var items = el.querySelectorAll('.draft-item');
          for (var i = 0; i < items.length; i++) {
            if (items[i].classList.contains('active')) {
              var t = items[i].querySelector('.di-title');
              if (t) t.textContent = d.title || '未命名论文';
              break;
            }
          }
          refreshCounter();
        }, 400);

        function renderSections() {
          U.clear(secWrap);
          (d.sections || []).forEach(function (s, i) {
            var ta = h('textarea', {
              class: 'editor', rows: '8', placeholder: '在此撰写「' + s.name + '」…',
              oninput: function () { s.text = this.value; d.updatedAt = Date.now(); save(); refreshCounter(); }
            });
            ta.value = s.text || '';
            var wc = h('span', { class: 'muted small', text: U.countFmt(s.text || '') });
            ta.addEventListener('input', function () { wc.textContent = U.countFmt(this.value); });

            secWrap.appendChild(h('div', { class: 'section-card' },
              h('div', { class: 'section-head' },
                h('input', {
                  class: 'sec-name', value: s.name,
                  oninput: function () { s.name = this.value; d.updatedAt = Date.now(); save(); ta.placeholder = '在此撰写「' + s.name + '」…'; }
                }),
                wc,
                h('div', { class: 'sec-actions' },
                  btn('↑', 'mini ghost', function () { move(i, -1); }),
                  btn('↓', 'mini ghost', function () { move(i, 1); }),
                  btn('删除', 'mini danger-ghost', function () {
                    if ((d.sections || []).length <= 1) { U.toast('至少保留一个章节', 'warn'); return; }
                    d.sections.splice(i, 1); d.updatedAt = Date.now(); save(); renderSections(); refreshCounter();
                  }))),
              ta));
          });
        }
        function move(i, dir) {
          var j = i + dir;
          if (j < 0 || j >= d.sections.length) return;
          var t = d.sections[i]; d.sections[i] = d.sections[j]; d.sections[j] = t;
          d.updatedAt = Date.now(); save(); renderSections();
        }
        renderSections();

        var editorBody = h('div', { class: 'editor-body' },
          field('标题', titleInput),
          field('关键词', kwInput),
          h('div', { class: 'sections-head' },
            h('h4', { text: '章节' }),
            h('div', {},
              btn('+ 添加章节', 'mini', function () {
                d.sections.push({ id: U.uid('sec'), name: '新章节', text: '' });
                save(); renderSections(); refreshCounter();
              }))),
          secWrap,
          h('div', { class: 'editor-foot' },
            h('div', { class: 'foot-left' }, h('span', { class: 'muted small', text: '自动保存 · 最后更新 ' }), h('span', { class: 'muted small', text: U.fmtDate(d.updatedAt) })),
            h('div', { class: 'foot-actions' },
              btn('复制全文', 'ghost', function () {
                navigator.clipboard && navigator.clipboard.writeText('# ' + (d.title || '') + '\n\n' + (d.sections || []).map(function (s) { return '## ' + s.name + '\n' + (s.text || ''); }).join('\n\n') + '\n');
                U.toast('已复制到剪贴板', 'ok');
              }),
              btn('导出 Markdown', 'ghost', function () {
                U.download((d.title || 'draft') + '.md', '# ' + (d.title || '') + '\n\n关键词：' + (d.keywords || '') + '\n\n' + (d.sections || []).map(function (s) { return '## ' + s.name + '\n\n' + (s.text || ''); }).join('\n\n'), 'text/markdown');
              }),
              btn('送到选刊分析', 'primary', function () {
                Store.set('analyze_seed', { title: d.title || '', keywords: d.keywords || '', abstract: (d.sections || []).filter(function (s) { return /摘要/.test(s.name); }).map(function (s) { return s.text; }).join('\n') || draftText(d).slice(0, 1200) });
                location.hash = '#/analyze';
              }))));

        layout.appendChild(panel('编辑器', h('div', { class: 'panel-extra-row' }, totalEl), editorBody));
      }

      el.appendChild(layout);
    }

    render();
  }

  /* ===================================================================== */
  /* 2. 期刊库模块（重点）                                                  */
  /* ===================================================================== */

  function JournalsPage(root) {
    var KEY = 'journals';
    var journals = Store.get(KEY, []);
    var selected = {};
    var el = h('div', { class: 'page' });
    root.appendChild(el);

    function save() { Store.set(KEY, journals); }
    function find(id) { for (var i = 0; i < journals.length; i++) if (journals[i].id === id) return journals[i]; return null; }
    function selIds() { return Object.keys(selected).filter(function (k) { return selected[k]; }); }

    /* ---------- 新增 / 编辑期刊 ---------- */
    function editJournal(j) {
      var isNew = !j;
      var data = j ? JSON.parse(JSON.stringify(j)) : { id: U.uid('j'), name: '', field: '', note: '', entries: [], profile: null };
      var nameI = h('input', { class: 'input', value: data.name, placeholder: '例如：医学影像与智能诊断学报' });
      var fieldI = h('input', { class: 'input', value: data.field, placeholder: '例如：医学影像 / 人工智能' });
      var noteI = h('textarea', { class: 'input', rows: '3', placeholder: '备注：审稿偏好、投稿要求等' });
      noteI.value = data.note || '';
      var m = modal({
        title: isNew ? '新增期刊' : '编辑期刊',
        body: [field('期刊名称', nameI), field('研究领域', fieldI), field('备注', noteI)],
        footer: [
          btn('取消', 'ghost', function () { m.close(); }),
          btn('保存', 'primary', function () {
            if (!nameI.value.trim()) { U.toast('请填写期刊名称', 'warn'); return; }
            data.name = nameI.value.trim();
            data.field = fieldI.value.trim();
            data.note = noteI.value.trim();
            if (isNew) { data.createdAt = Date.now(); journals.unshift(data); }
            else { data.updatedAt = Date.now(); for (var i = 0; i < journals.length; i++) if (journals[i].id === data.id) journals[i] = data; }
            save(); m.close(); render();
            U.toast(isNew ? '期刊已新增' : '期刊已更新', 'ok');
          })
        ]
      });
    }

    /* ---------- 导入录用目录（双模式） ---------- */
    function importTOC(journalId) {
      var parsed = null, sourceName = '';
      var selectEl = h('select', { class: 'input' },
        [h('option', { value: '', text: '— 请选择要导入的目标期刊 —' })].concat(
          journals.map(function (j) { return h('option', { value: j.id, text: j.name }); }),
          [h('option', { value: '__new__', text: '＋ 新建期刊后导入' })]
        ));
      selectEl.value = journalId || '';

      var newName = h('input', { class: 'input', placeholder: '新期刊名称' });
      var newField = h('input', { class: 'input', placeholder: '新期刊领域（可选）' });
      var newRow = h('div', { class: 'grid-2 hidden' }, field('名称', newName), field('领域', newField));
      selectEl.addEventListener('change', function () { newRow.classList.toggle('hidden', selectEl.value !== '__new__'); });

      var fileInput = h('input', { type: 'file', accept: global.Importer.ACCEPT, class: 'input' });
      var pasteArea = h('textarea', { class: 'input mono', rows: '10', placeholder: '在此粘贴录用目录，例如：\n\n2021年第1期\n1. 基于深度学习的肺结节自动检测方法研究\n2. 卷积神经网络在胸部X线图像分类中的应用\n\nVol.15 No.2\n基于Transformer的医学图像配准方法\n\n或直接粘贴带表头的表格（年\\t期\\t标题），支持从 Excel 里复制粘贴。' });
      var preview = h('div', { class: 'preview' });
      var modeSel = h('select', { class: 'input' }, [
        h('option', { value: 'append', text: '追加到现有目录' }),
        h('option', { value: 'replace', text: '覆盖（清空后重建）' })
      ]);
      var infoBar = h('div', { class: 'muted small', text: '尚未解析内容。' });

      function showPreview(res, srcName) {
        parsed = res; sourceName = srcName || '';
        U.clear(preview);
        if (!res || !res.entries.length) {
          infoBar.textContent = '解析结果：0 条' + (res && res.warnings.length ? '（' + res.warnings.join('；') + '）' : '');
          preview.appendChild(h('p', { class: 'muted', text: '没有识别到条目。请检查内容是否为「年/期 + 文章标题」结构。' }));
          return;
        }
        infoBar.textContent = '解析结果：' + res.entries.length + ' 条（' + res.issues.length + ' 个期次 · ' + (res.mode === 'table' ? '表格模式' : '文本模式') + '）' + (sourceName ? ' · 来源：' + sourceName : '');
        U.clear(preview);
        preview.appendChild(h('table', { class: 'table compact' },
          h('thead', {}, h('tr', {}, h('th', { text: '年' }), h('th', { text: '期' }), h('th', { text: '标题' }))),
          h('tbody', {}, res.entries.slice(0, 8).map(function (e) {
            return h('tr', {}, h('td', { text: e.year || (e.vol ? 'Vol.' + e.vol : '—') }), h('td', { text: e.issue || '—' }), h('td', { text: e.title }));
          }))));
        if (res.entries.length > 8) preview.appendChild(h('p', { class: 'muted small', text: '… 其余 ' + (res.entries.length - 8) + ' 条已省略' }));
      }

      function parsePaste() {
        var txt = pasteArea.value;
        if (!txt.trim()) { U.toast('请先粘贴目录内容', 'warn'); return; }
        // 支持从 Excel 直接粘贴的制表符表格
        var res = (txt.indexOf('\t') >= 0)
          ? Toc.parse(U.parseDelimited(txt, '\t'))
          : Toc.parse(txt);
        showPreview(res, '粘贴文本');
      }

      fileInput.addEventListener('change', function () {
        var f = fileInput.files && fileInput.files[0];
        if (!f) return;
        global.Importer.readImportedFile(f, 'table').then(function (r) {
          if (!r.ok) { U.toast(r.message, 'error'); showPreview({ entries: [], issues: [], warnings: [r.message], mode: 'text' }, f.name); return; }
          var res = Toc.parse(r.rows && r.rows.length ? r.rows : r.text);
          showPreview(res, f.name);
        });
      });

      var body = h('div', {},
        field('目标期刊', selectEl),
        newRow,
        tabs([
          {
            label: '① 粘贴文本', content: function () {
              return h('div', {}, field('目录内容', pasteArea, '支持「YYYY年第N期」「Vol.15 No.3」「YYYY,N」「纯年份顺推」等期次写法，也支持从 Excel 复制的制表符表格。'),
                h('div', { class: 'row' }, btn('解析预览', 'mini', parsePaste), btn('清空', 'mini ghost', function () { pasteArea.value = ''; parsed = null; showPreview(null); })));
            }
          },
          {
            label: '② 上传文件', content: function () {
              return h('div', {}, field('选择文件（.xlsx / .xls / .docx / .csv / .tsv / .txt）', fileInput, 'Excel 取第一张工作表；Word 提取正文；旧版 .doc 请先另存为 .docx。'), infoBar);
            }
          }
        ]),
        h('div', { class: 'preview-head' }, infoBar, field('导入方式', modeSel)),
        preview);

      var m = modal({
        title: '导入录用目录 → 构建期刊画像', wide: true,
        body: body,
        footer: [
          btn('取消', 'ghost', function () { m.close(); }),
          btn('确认导入并重建画像', 'primary', function () {
            if (!parsed || !parsed.entries.length) { U.toast('请先解析目录，且至少 1 条有效记录', 'warn'); return; }
            var targetId = selectEl.value;
            var target;
            if (targetId === '__new__') {
              if (!newName.value.trim()) { U.toast('请填写新期刊名称', 'warn'); return; }
              target = { id: U.uid('j'), name: newName.value.trim(), field: newField.value.trim(), note: '', entries: [], createdAt: Date.now() };
              journals.unshift(target);
              targetId = target.id;
            } else {
              target = find(targetId);
              if (!target) { U.toast('请选择目标期刊', 'warn'); return; }
            }
            if (modeSel.value === 'replace') target.entries = [];
            var seen = {};
            (target.entries || []).forEach(function (e) { seen[e.year + '|' + e.issue + '|' + e.title] = 1; });
            var added = 0;
            parsed.entries.forEach(function (e) {
              var k = e.year + '|' + e.issue + '|' + e.title;
              if (seen[k]) return;
              seen[k] = 1; target.entries.push(e); added++;
            });
            target.profile = Toc.buildProfile(target.entries);
            target.updatedAt = Date.now();
            save(); m.close(); render();
            U.toast('已导入 ' + added + ' 条（去重后），画像已重建', 'ok');
          })
        ]
      });
      setTimeout(function () { if (selectEl.value === '__new__') newRow.classList.remove('hidden'); }, 0);
    }

    /* ---------- 画像详情 ---------- */
    function showProfile(j) {
      var p = j.profile;
      var body = h('div', {});
      if (!p || !p.terms || !Object.keys(p.terms).length) {
        body.appendChild(emptyBox('该期刊还没有画像，请先导入录用目录。'));
      } else {
        body.appendChild(h('div', { class: 'stat-row' },
          miniStat('目录文章', p.totalTitles + ' 篇'),
          miniStat('期次', (p.byIssue || []).length + ' 期'),
          miniStat('画像词条', Object.keys(p.terms).length + ' 个'),
          miniStat('构建时间', U.fmtDate(p.builtAt).slice(5))));
        body.appendChild(h('h4', { class: 'sub-title', text: '主题偏好关键词（权重 Top 30）' }));
        var maxW = p.top.length ? p.top[0].weight : 1;
        body.appendChild(h('div', { class: 'weight-list' }, p.top.map(function (t) {
          return h('div', { class: 'weight-item' },
            h('span', { class: 'w-term', text: t.term }),
            h('span', { class: 'w-bar' }, h('i', { style: { width: (t.weight / maxW * 100).toFixed(1) + '%' } })),
            h('span', { class: 'w-val', text: '权重 ' + t.weight.toFixed(2) + ' · ' + t.count + ' 次' }));
        })));
        body.appendChild(h('h4', { class: 'sub-title', text: '按年/期切分的目录画像' }));
        body.appendChild(h('div', { class: 'issue-cards' }, (p.byIssue || []).map(function (g) {
          return h('div', { class: 'issue-card' },
            h('div', { class: 'ic-head', text: (g.year || '—') + ' 年第 ' + (g.issue || '—') + ' 期 · ' + g.titles + ' 篇' }),
            chips(g.top.map(function (t) { return t.term + '(' + t.count + ')'; })));
        })));
      }
      var m = modal({
        title: '画像 · ' + j.name, wide: true, body: body,
        footer: [btn('关闭', 'ghost', function () { m.close(); }),
          btn('重新构建画像', 'primary', function () {
            j.profile = Toc.buildProfile(j.entries || []);
            save(); m.close(); render(); U.toast('画像已重建', 'ok');
          })]
      });
    }

    /* ---------- 载入示例 ---------- */
    function loadSample() {
      confirmBox('载入示例数据', '将载入 2 本示例期刊（医学影像/深度学习方向 6 期 15 篇 + 生物医学工程对照期刊）。已存在的同名期刊会被跳过。', function () {
        var added = 0;
        Toc.SAMPLE.forEach(function (s) {
          if (journals.some(function (j) { return j.name === s.name; })) return;
          var j = {
            id: U.uid('j'), name: s.name, field: s.field, note: s.note,
            entries: JSON.parse(JSON.stringify(s.entries)),
            createdAt: Date.now(), updatedAt: Date.now()
          };
          j.profile = Toc.buildProfile(j.entries);
          journals.push(j); added++;
        });
        save(); render();
        U.toast(added ? '已载入 ' + added + ' 本示例期刊' : '示例期刊已存在，未重复添加', added ? 'ok' : 'warn');
      }, '载入示例');
    }

    /* ---------- 渲染 ---------- */
    function render() {
      U.clear(el);
      var sel = selIds();
      el.appendChild(pageHead('期刊库', '维护投稿目标期刊；导入历年录用目录即可自动生成"主题偏好画像"，供选刊分析打分。',
        [btn('全选', 'ghost', function () {
          var allOn = journals.length > 0 && journals.every(function (j) { return selected[j.id]; });
          journals.forEach(function (j) { selected[j.id] = !allOn; });
          render();
        }),
        btn('批量删除' + (sel.length ? '（' + sel.length + '）' : ''), sel.length ? 'danger' : 'ghost', function () {
          if (!sel.length) { U.toast('请先勾选要删除的期刊', 'warn'); return; }
          confirmBox('批量删除', '确定删除选中的 ' + sel.length + ' 本期刊及其目录/画像？', function () {
            journals = journals.filter(function (j) { return !selected[j.id]; });
            selected = {}; save(); render(); U.toast('已删除', 'ok');
          });
        }),
        btn('导入录用目录', 'ghost', function () {
          if (!journals.length) { U.toast('请先新增期刊，或直接选择"新建期刊后导入"', 'warn'); }
          importTOC(sel.length === 1 ? sel[0] : '');
        }),
        btn('载入示例', 'ghost', loadSample),
        btn('新增期刊', 'primary', function () { editJournal(null); })]));

      if (!journals.length) {
        el.appendChild(panel(null, null, emptyBox('期刊库还是空的。点「载入示例」一键体验画像与选刊，或「新增期刊」手动维护。',
          h('div', { class: 'row center' }, btn('载入示例', 'primary', loadSample), btn('新增期刊', 'ghost', function () { editJournal(null); })))));
        return;
      }

      var listBody = h('div', { class: 'journal-list' });
      journals.forEach(function (j) {
        var p = j.profile;
        var cnt = (j.entries || []).length;
        listBody.appendChild(h('div', { class: 'journal-card' + (selected[j.id] ? ' selected' : '') },
          h('div', { class: 'jc-left' },
            h('input', {
              type: 'checkbox', class: 'checkbox', checked: !!selected[j.id],
              onchange: function () { selected[j.id] = this.checked; render(); }
            })),
          h('div', { class: 'jc-main' },
            h('div', { class: 'jc-title' }, h('strong', { text: j.name }), j.field ? h('span', { class: 'tag', text: j.field }) : null),
            j.note ? h('div', { class: 'muted small', text: j.note }) : null,
            h('div', { class: 'jc-meta' },
              h('span', { text: '目录 ' + cnt + ' 篇' }),
              h('span', { text: '期次 ' + (p && p.byIssue ? p.byIssue.length : 0) }),
              h('span', { text: '画像词条 ' + (p && p.terms ? Object.keys(p.terms).length : 0) }),
              p && p.builtAt ? h('span', { text: '画像更新 ' + U.fmtDate(p.builtAt).slice(5) }) : h('span', { class: 'warn-text', text: '未构建画像' })),
            (p && p.top && p.top.length) ? chips(p.top.slice(0, 8).map(function (t) { return t.term; })) : null),
          h('div', { class: 'jc-actions' },
            btn('导入目录', 'mini', function () { importTOC(j.id); }),
            btn('画像', 'mini ghost', function () { showProfile(j); }),
            btn('编辑', 'mini ghost', function () { editJournal(j); }),
            btn('删除', 'mini danger-ghost', function () {
              confirmBox('删除期刊', '确定删除《' + j.name + '》？其目录与画像会一起删除。', function () {
                journals = journals.filter(function (x) { return x.id !== j.id; });
                save(); render(); U.toast('已删除', 'ok');
              });
            }))));
      });
      el.appendChild(panel('期刊列表（' + journals.length + '）', null, listBody));
    }

    render();
  }

  /* ===================================================================== */
  /* 3. 选刊分析                                                           */
  /* ===================================================================== */

  function AnalyzePage(root) {
    var seed = Store.get('analyze_seed', null);
    var journals = Store.get('journals', []);
    var el = h('div', { class: 'page' });
    root.appendChild(el);

    var titleI = h('input', { class: 'input', value: (seed && seed.title) || '', placeholder: '论文标题，例如：基于 Transformer 与 CNN 融合的肺结节检测与分割' });
    var kwI = h('input', { class: 'input', value: (seed && seed.keywords) || '', placeholder: '关键词（逗号/分号分隔），例如：肺结节, 深度学习, 图像分割, Transformer' });
    var absI = h('textarea', { class: 'input', rows: '7', placeholder: '摘要正文（可选，粘贴越多匹配越稳）' });
    absI.value = (seed && seed.abstract) || '';
    var wBase = h('input', { type: 'range', min: '0', max: '100', value: '50', class: 'range' });
    var wLab = h('span', { class: 'muted small', text: '基础匹配分 50% ／ 画像相似度 50%' });
    var resultWrap = h('div', { class: 'result-wrap' });

    function run() {
      U.clear(resultWrap);
      var paper = { title: titleI.value.trim(), keywords: kwI.value.trim(), abstract: absI.value.trim() };
      if (!paper.title && !paper.keywords && !paper.abstract) { U.toast('请至少填写标题、关键词或摘要', 'warn'); return; }
      if (!journals.length) {
        resultWrap.appendChild(panel('分析结果', null, emptyBox('期刊库为空。请先到「期刊库」载入示例或导入录用目录。',
          btn('去期刊库', 'primary', function () { location.hash = '#/journals'; }))));
        return;
      }
      var wb = +wBase.value / 100;
      var ranked = Match.rankJournals(paper, journals, { wBase: wb, wSim: 1 - wb });
      Store.set('analyze_seed', paper);
      Store.set('last_analysis', { paper: paper, at: Date.now(), ranked: ranked.map(function (r) { return { name: r.name, fit: r.fit }; }) });

      if (!ranked.some(function (r) { return !r.empty; })) {
        resultWrap.appendChild(panel('分析结果', null, emptyBox('所有期刊都还没有画像，请先导入录用目录。')));
        return;
      }

      var parts = [];
      ranked.forEach(function (r, i) {
        var lv = Match.fitLevel(r.fit);
        var card = h('div', { class: 'rank-card' + (i === 0 ? ' top' : '') + (r.empty ? ' dim' : '') },
          h('div', { class: 'rank-no', text: '#' + (i + 1) }),
          h('div', { class: 'rank-score' },
            h('div', { class: 'score-num', text: String(r.fit) }),
            h('div', { class: 'score-lab', text: 'fit' })),
          h('div', { class: 'rank-main' },
            h('div', { class: 'rank-title' }, h('strong', { text: r.name }), h('span', { class: 'level ' + lv.cls, text: lv.text }), r.field ? h('span', { class: 'tag', text: r.field }) : null),
            r.empty ? h('div', { class: 'muted small', text: '该期刊尚未建立画像，无法参与打分。' }) : null,
            h('div', { class: 'rank-bars' },
              bar('基础匹配分', r.base), bar('画像相似度', r.sim),
              h('span', { class: 'muted small', text: '命中画像词 ' + r.hitCount + ' 个 · 目录 ' + r.totalTitles + ' 篇' })),
            (r.hits && r.hits.length) ? chips(r.hits.map(function (x) { return { text: x.term, title: '权重 ' + x.weight.toFixed(2) }; }), 'hit') : h('div', { class: 'muted small', text: '没有命中任何画像关键词' }),
            r.bestIssue ? h('div', { class: 'muted small', text: '最接近的历史期次：' + (r.bestIssue.year || '—') + ' 年第 ' + (r.bestIssue.issue || '—') + ' 期（相似 ' + r.bestIssue.score + '%）' + (r.bestIssue.hits.length ? ' · ' + r.bestIssue.hits.slice(0, 5).join('、') : '') }) : null));
        parts.push(card);
      });

      var m = { ranked: ranked, paper: paper };
      resultWrap.appendChild(pageHead('推荐结果', '按 fit 分从高到低排序，fit = 100 ×（基础匹配分 × ' + Math.round(wb * 100) + '% + 画像相似度 × ' + Math.round((1 - wb) * 100) + '%）',
        [btn('导出结果 CSV', 'ghost', function () {
          var rows = [['排名', '期刊', '领域', 'fit', '基础匹配分', '画像相似度', '命中词', '目录篇数']];
          m.ranked.forEach(function (r, i) {
            rows.push([i + 1, r.name, r.field || '', r.fit, r.base, r.sim, r.hits.map(function (x) { return x.term; }).join(' '), r.totalTitles]);
          });
          U.download('选刊分析结果.csv', U.toCSV(rows), 'text/csv');
        })]));
      resultWrap.appendChild(parts.length ? h('div', { class: 'rank-list' }, parts) : emptyBox('无结果'));
    }

    function bar(label, val) {
      var v = Math.max(0, Math.min(100, +val || 0));
      return h('div', { class: 'hbar' },
        h('span', { class: 'hbar-lab', text: label }),
        h('span', { class: 'hbar-track' }, h('i', { style: { width: v + '%' } })),
        h('span', { class: 'hbar-val', text: v.toFixed ? v.toFixed(1) : v }));
    }

    el.appendChild(pageHead('选刊分析', '输入论文标题/关键词/摘要，与各期刊"历年录用目录画像"比对，输出 0–100 的契合度 fit 分。'));
    el.appendChild(h('div', { class: 'two-col wide-right' },
      panel('论文信息', null, h('div', { class: 'editor-body' },
        field('标题', titleI),
        field('关键词', kwI),
        field('摘要', absI),
        field('融合权重（基础匹配分 ↔ 画像相似度）', h('div', { class: 'row' }, wBase, wLab)),
        h('div', { class: 'row' },
          btn('开始分析', 'primary', run),
          btn('清空', 'ghost', function () { titleI.value = ''; kwI.value = ''; absI.value = ''; U.clear(resultWrap); })))),
      h('div', {}, resultWrap)));

    wBase.addEventListener('input', function () {
      var w = +wBase.value;
      wLab.textContent = '基础匹配分 ' + w + '% ／ 画像相似度 ' + (100 - w) + '%';
    });

    if (seed && (seed.title || seed.abstract || seed.keywords)) run();
    else U.clear(resultWrap), resultWrap.appendChild(panel('分析结果', null, emptyBox('填写左侧论文信息后点「开始分析」。')));
  }

  /* ===================================================================== */
  /* 4. 计量分析                                                           */
  /* ===================================================================== */

  function MetricsPage(root) {
    var KEY = 'metrics_data';
    var ds = Store.get(KEY, null);            // {headers, data, name}
    var el = h('div', { class: 'page' });
    root.appendChild(el);
    var minCount = 8;

    function applyRows(rows, name) {
      var d = Stats.toDataset(rows);
      if (!d.headers.length || !d.data.length) { U.toast('没有解析到有效数据行', 'warn'); return; }
      ds = { headers: d.headers, data: d.data, hasHeader: d.hasHeader, name: name || '数据集', updatedAt: Date.now() };
      ds.numIdx = Stats.numericColumnIndexes(d);
      Store.set(KEY, ds); render();
      U.toast('已载入 ' + ds.data.length + ' 行 × ' + ds.headers.length + ' 列', 'ok');
    }

    function sampleData() {
      /* 确定性伪随机（LCG）：示例数据可复现，且各列相互独立、不存在精确共线关系，
         保证回归建模一定可解（真实关系 y ≈ 30 + 0.8·剂量 + 1.6·疗程 - 0.12·年龄 + 2·特征 + 噪声）。 */
      var seed = 20240501;
      function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
      var rows = [['样本', '年龄', '剂量mg', '疗程周', '疗效评分', '影像组学特征值']];
      for (var i = 1; i <= 24; i++) {
        var age = 40 + Math.round(rnd() * 34);
        var dose = 20 + Math.round(rnd() * 30);
        var week = 2 + Math.round(rnd() * 10);
        var feat = +((rnd() * 4 - 1.5).toFixed(3));
        var score = 30 + dose * 0.8 + week * 1.6 - age * 0.12 + feat * 2 + (rnd() * 4 - 2);
        rows.push(['P' + (i < 10 ? '0' + i : i), age, dose, week, +score.toFixed(2), feat]);
      }
      applyRows(rows, '示例：疗效影响因素');
    }

    function render() {
      U.clear(el);
      el.appendChild(pageHead('计量分析', '导入表格数据 → 描述统计 → 相关分析 → 回归建模 → 导出 CSV。全部在本机计算。',
        [btn('载入示例数据', 'ghost', sampleData),
        ds ? btn('导出原始数据 CSV', 'ghost', function () {
          U.download((ds.name || 'data') + '.csv', U.toCSV([ds.headers].concat(ds.data)), 'text/csv');
        }) : null,
        ds ? btn('清空数据', 'danger-ghost', function () {
          confirmBox('清空数据', '确定清除当前数据集？', function () { Store.remove(KEY); ds = null; render(); });
        }) : null]));

      /* 导入区 */
      var fileInput = h('input', { type: 'file', accept: global.Importer.ACCEPT, class: 'input' });
      fileInput.addEventListener('change', function () {
        var f = this.files && this.files[0];
        if (!f) return;
        global.Importer.readImportedFile(f, 'table').then(function (r) {
          if (!r.ok) { U.toast(r.message, 'error'); return; }
          if (r.rows && r.rows.length) applyRows(r.rows, f.name);
          else { U.toast('该文件里没有表格结构，请改用 CSV/Excel', 'warn'); }
        });
      });
      var pasteArea = h('textarea', { class: 'input mono', rows: '4', placeholder: '或直接粘贴表格数据（首行为表头，可用逗号/制表符分隔）' });

      el.appendChild(panel('数据导入', null, h('div', { class: 'grid-2' },
        field('上传文件（Excel / CSV / TSV / TXT）', fileInput, 'Excel 自动取第一张工作表。'),
        h('div', {}, field('粘贴数据', pasteArea),
          h('div', { class: 'row' }, btn('解析粘贴内容', 'mini', function () {
            if (!pasteArea.value.trim()) { U.toast('请先粘贴数据', 'warn'); return; }
            var sep = pasteArea.value.indexOf('\t') >= 0 ? '\t' : undefined;
            applyRows(U.parseDelimited(pasteArea.value, sep), '粘贴数据');
          }))))));

      if (!ds) {
        el.appendChild(panel(null, null, emptyBox('还没有数据集。上传文件、粘贴数据，或点「载入示例数据」快速体验。',
          btn('载入示例数据', 'primary', sampleData))));
        return;
      }

      /* 数据预览 */
      el.appendChild(panel('数据预览 · ' + ds.name, h('span', { class: 'muted small', text: ds.data.length + ' 行 × ' + ds.headers.length + ' 列' }),
        h('div', { class: 'table-scroll' }, h('table', { class: 'table compact' },
          h('thead', {}, h('tr', {}, ds.headers.map(function (hname, i) {
            var isNum = (ds.numIdx || []).indexOf(i) >= 0;
            return h('th', { class: isNum ? 'num' : '' }, hname + (isNum ? ' ▸数值' : ''));
          }))),
          h('tbody', {}, ds.data.slice(0, 10).map(function (r) {
            return h('tr', {}, ds.headers.map(function (_, i) { return h('td', { class: 'mono', text: r[i] }); }));
          }))))));

      var numIdx = (ds.numIdx && ds.numIdx.length ? ds.numIdx : Stats.numericColumnIndexes(ds)).slice();
      if (numIdx.length < 1) {
        el.appendChild(panel('分析', null, emptyBox('没有检测到数值列，无法进行统计分析。')));
        return;
      }

      el.appendChild(tabs([
        {
          label: '描述统计', content: function () {
            var rows = [['变量', 'n', '缺失', '均值', '标准差', '变异系数', '最小值', 'Q1', '中位数', 'Q3', '最大值', '极差']];
            numIdx.forEach(function (i) {
              var col = ds.data.map(function (r) { return Stats.toNumber(r[i]); });
              var vals = col.filter(function (v) { return !isNaN(v); });
              var d = Stats.describe(vals);
              rows.push([ds.headers[i], d.n, col.length - d.n,
                Stats.fmt(d.mean), Stats.fmt(d.sd), isNaN(d.cv) ? '—' : Stats.fmt(d.cv),
                Stats.fmt(d.min), Stats.fmt(d.q1), Stats.fmt(d.median), Stats.fmt(d.q3), Stats.fmt(d.max), Stats.fmt(d.range)]);
            });
            return h('div', {},
              h('div', { class: 'table-scroll' }, h('table', { class: 'table' },
                h('thead', {}, h('tr', {}, rows[0].map(function (c) { return h('th', { text: c }); }))),
                h('tbody', {}, rows.slice(1).map(function (r) { return h('tr', {}, r.map(function (c) { return h('td', { class: 'mono', text: String(c) }); })); })))),
              h('div', { class: 'row' }, btn('导出描述统计 CSV', 'mini', function () {
                U.download('描述统计.csv', U.toCSV(rows), 'text/csv');
              })));
          }
        },
        {
          label: '相关分析', content: function () {
            var cm = Stats.corrMatrix(ds, numIdx);
            var head = h('tr', {}, h('th', { text: '' }), cm.names.map(function (n) { return h('th', { text: n }); }));
            var body = cm.matrix.map(function (row, i) {
              return h('tr', {}, h('th', { text: cm.names[i] }),
                row.map(function (c) {
                  var v = c.r;
                  var bg = isNaN(v) ? '#f3f4f6'
                    : (v > 0 ? 'rgba(220,38,38,' + (Math.abs(v) * 0.55).toFixed(2) + ')'
                      : 'rgba(22,120,220,' + (Math.abs(v) * 0.55).toFixed(2) + ')');
                  var txt = i === 0 ? '1.000' : (isNaN(v) ? '—' : v.toFixed(3) + (c.sig ? c.sig : ''));
                  return h('td', { class: 'mono cell-corr', style: { background: bg }, title: 'n=' + c.n + ', p=' + (isNaN(c.p) ? '—' : c.p.toFixed(4)), text: txt });
                }));
            });
            return h('div', {},
              h('p', { class: 'muted small', text: 'Pearson 相关系数（成对剔除缺失）。显著性标记：* p<0.05，** p<0.01，*** p<0.001。' }),
              h('div', { class: 'table-scroll' }, h('table', { class: 'table corr' }, h('thead', {}, head), h('tbody', {}, body))),
              h('div', { class: 'row' }, btn('导出相关系数矩阵 CSV', 'mini', function () {
                var rows = [['变量'].concat(cm.names)];
                cm.matrix.forEach(function (row, i) {
                  rows.push([cm.names[i]].concat(row.map(function (c) { return isNaN(c.r) ? '' : c.r.toFixed(4); })));
                });
                U.download('相关系数矩阵.csv', U.toCSV(rows), 'text/csv');
              })));
          }
        },
        {
          label: '回归建模', content: function () {
            var ySel = h('select', { class: 'input' }, numIdx.map(function (i) { return h('option', { value: i, text: ds.headers[i] }); }));
            var xWrap = h('div', { class: 'checkbox-grid' }, numIdx.map(function (i, k) {
              var cb = h('input', { type: 'checkbox', class: 'checkbox', checked: k !== 0 && k <= 3 });
              return h('label', { class: 'cb-item' }, cb, h('span', { text: ds.headers[i] }));
            }));
            var out = h('div', { class: 'model-out' });
            var xBoxes = xWrap.querySelectorAll('input[type=checkbox]');

            function runModel() {
              var yIdx = +ySel.value;
              var xs = [];
              for (var i = 0; i < xBoxes.length; i++) if (xBoxes[i].checked) xs.push(numIdx[i]);
              if (!xs.length) { U.toast('请至少勾选一个自变量', 'warn'); return; }
              if (xs.indexOf(yIdx) >= 0) { U.toast('自变量与因变量不能相同', 'warn'); return; }
              var y = ds.data.map(function (r) { return Stats.toNumber(r[yIdx]); });
              var X = xs.map(function (i) { return ds.data.map(function (r) { return Stats.toNumber(r[i]); }); });
              var names = xs.map(function (i) { return ds.headers[i]; });
              var res = Stats.ols(y, X, names);
              U.clear(out);
              if (!res.ok) { out.appendChild(h('p', { class: 'warn-text', text: res.message })); return; }
              var rows = [['变量', '系数 β', '标准误', 't 值', 'p 值', '显著性']];
              res.names.forEach(function (n, i) {
                rows.push([n, Stats.fmt(res.beta[i]), Stats.fmt(res.se[i]), Stats.fmt(res.t[i], 3),
                  isNaN(res.p[i]) ? '—' : res.p[i].toFixed(4), res.sig[i] || '']);
              });
              var eq = ds.headers[yIdx] + ' = ' + res.beta.map(function (b, i) {
                return (i === 0 ? Stats.fmt(b, 3) : (b >= 0 ? ' + ' : ' - ') + Math.abs(+b.toFixed(4)) + '·' + res.names[i]);
              }).join('');
              out.appendChild(h('div', { class: 'eq-box', text: eq }));
              out.appendChild(h('div', { class: 'stat-row' },
                miniStat('样本量 n', String(res.n)),
                miniStat('R²', Stats.fmt(res.r2, 4)),
                miniStat('调整 R²', Stats.fmt(res.adjR2, 4)),
                miniStat('F 检验 p', isNaN(res.f) ? '—' : (Math.abs(res.f) > 1e6 ? '≈0' : Stats.fmt(res.f, 3)) ),
                miniStat('RMSE', Stats.fmt(res.rmse, 4))));
              out.appendChild(h('div', { class: 'table-scroll' }, h('table', { class: 'table' },
                h('thead', {}, h('tr', {}, rows[0].map(function (c) { return h('th', { text: c }); }))),
                h('tbody', {}, rows.slice(1).map(function (r) { return h('tr', {}, r.map(function (c) { return h('td', { class: 'mono', text: String(c) }); })); })))));
              out.appendChild(h('div', { class: 'row' }, btn('导出回归结果 CSV', 'mini', function () {
                U.download('回归模型结果.csv', U.toCSV(rows.concat([[], ['R²', res.r2], ['调整 R²', res.adjR2], ['n', res.n]])), 'text/csv');
              })));
              // 保存到资料库
              out.appendChild(h('div', { class: 'row' }, btn('保存结论到资料库', 'mini ghost', function () {
                var lib = Store.get('library', []);
                lib.unshift({ id: U.uid('lib'), type: '分析', title: '回归模型：' + ds.headers[yIdx], content: eq + '\n\nR²=' + Stats.fmt(res.r2, 4) + '，调整 R²=' + Stats.fmt(res.adjR2, 4) + '，n=' + res.n, tags: '计量分析,回归', createdAt: Date.now() });
                Store.set('library', lib); U.toast('已保存到资料库', 'ok');
              })));
            }

            return h('div', {},
              h('div', { class: 'grid-2' },
                field('因变量 Y', ySel),
                field('自变量 X（可多选）', xWrap)),
              h('div', { class: 'row' }, btn('运行回归', 'primary', runModel)),
              out);
          }
        }
      ]));
    }

    render();
  }

  /* ===================================================================== */
  /* 5. 研究进度看板                                                       */
  /* ===================================================================== */

  function DashPage(root) {
    var KEY = 'tasks';
    var tasks = Store.get(KEY, []);
    var el = h('div', { class: 'page' });
    root.appendChild(el);
    var STATUS = [
      { k: 'todo', label: '待开始', cls: 'st-todo' },
      { k: 'doing', label: '进行中', cls: 'st-doing' },
      { k: 'done', label: '已完成', cls: 'st-done' },
      { k: 'block', label: '阻塞', cls: 'st-block' }
    ];

    function save() { Store.set(KEY, tasks); }

    function addTask() {
      var tI = h('input', { class: 'input', placeholder: '任务名称，例如：完成实验数据收集' });
      var dI = h('input', { type: 'date', class: 'input' });
      var sI = h('select', { class: 'input' }, STATUS.map(function (s) { return h('option', { value: s.k, text: s.label }); }));
      var nI = h('textarea', { class: 'input', rows: '2', placeholder: '备注（可选）' });
      var m = modal({
        title: '新增任务', body: [field('任务', tI), field('截止日期', dI), field('状态', sI), field('备注', nI)],
        footer: [btn('取消', 'ghost', function () { m.close(); }), btn('添加', 'primary', function () {
          if (!tI.value.trim()) { U.toast('请填写任务名称', 'warn'); return; }
          tasks.unshift({ id: U.uid('t'), title: tI.value.trim(), due: dI.value, status: sI.value, note: nI.value.trim(), createdAt: Date.now() });
          save(); m.close(); render(); U.toast('已添加', 'ok');
        })]
      });
    }

    function render() {
      U.clear(el);
      var done = tasks.filter(function (t) { return t.status === 'done'; }).length;
      var pct = tasks.length ? Math.round(done / tasks.length * 100) : 0;
      el.appendChild(pageHead('研究进度看板', '把论文工作拆成任务，按状态推进。',
        [btn('新增任务', 'primary', addTask), tasks.length ? btn('导出 CSV', 'ghost', function () {
          U.download('研究进度.csv', U.toCSV([['任务', '状态', '截止日期', '备注']].concat(tasks.map(function (t) {
            return [t.title, (STATUS.filter(function (s) { return s.k === t.status; })[0] || {}).label || t.status, t.due || '', t.note || ''];
          }))), 'text/csv');
        }) : null]));

      el.appendChild(h('div', { class: 'progress-panel' },
        h('div', { class: 'pp-row' }, h('strong', { text: '总体进度' }), h('span', { text: done + ' / ' + tasks.length + ' 已完成' })),
        h('div', { class: 'progress-track' }, h('i', { style: { width: pct + '%' } })),
        h('div', { class: 'muted small', text: pct + '%' })));

      if (!tasks.length) {
        el.appendChild(panel(null, null, emptyBox('还没有任务。点「新增任务」开始规划，例如：文献综述 / 数据收集 / 初稿 / 投稿。',
          btn('新增任务', 'primary', addTask))));
        return;
      }

      var grid = h('div', { class: 'kanban' });
      STATUS.forEach(function (s) {
        var items = tasks.filter(function (t) { return t.status === s.k; });
        var col = h('div', { class: 'kanban-col ' + s.cls },
          h('div', { class: 'kb-head' }, h('strong', { text: s.label }), h('span', { class: 'count', text: String(items.length) })));
        items.forEach(function (t) {
          var overdue = t.due && t.status !== 'done' && t.due < new Date().toISOString().slice(0, 10);
          col.appendChild(h('div', { class: 'task-card' },
            h('div', { class: 'task-title', text: t.title }),
            t.note ? h('div', { class: 'muted small', text: t.note }) : null,
            h('div', { class: 'task-meta' },
              t.due ? h('span', { class: overdue ? 'warn-text' : 'muted small', text: (overdue ? '逾期 ' : '截止 ') + t.due }) : h('span', { class: 'muted small', text: '无截止日期' })),
            h('div', { class: 'task-actions' },
              h('select', {
                class: 'input mini-select', value: t.status,
                onchange: function () { t.status = this.value; save(); render(); }
              }, STATUS.map(function (x) { return h('option', { value: x.k, text: x.label, selected: x.k === t.status }); })),
              btn('删除', 'mini danger-ghost', function () {
                tasks = tasks.filter(function (x) { return x.id !== t.id; });
                save(); render();
              }))));
        });
        if (!items.length) col.appendChild(h('div', { class: 'muted small pad', text: '暂无' }));
        grid.appendChild(col);
      });
      el.appendChild(grid);
    }

    render();
  }

  /* ===================================================================== */
  /* 6. 资料库                                                             */
  /* ===================================================================== */

  function LibraryPage(root) {
    var KEY = 'library';
    var items = Store.get(KEY, []);
    var q = '';
    var el = h('div', { class: 'page' });
    root.appendChild(el);

    function save() { Store.set(KEY, items); }
    function filtered() {
      var s = q.trim().toLowerCase();
      if (!s) return items;
      return items.filter(function (it) {
        return ((it.title || '') + ' ' + (it.content || '') + ' ' + (it.tags || '') + ' ' + (it.type || '')).toLowerCase().indexOf(s) >= 0;
      });
    }

    function edit(it) {
      var isNew = !it;
      var data = it || { id: U.uid('lib'), type: '文献', title: '', content: '', tags: '' };
      var tI = h('input', { class: 'input', value: data.title, placeholder: '标题' });
      var tyI = h('select', { class: 'input' }, ['文献', '笔记', '链接', '数据', '分析'].map(function (t) {
        return h('option', { value: t, text: t, selected: t === data.type });
      }));
      var tagI = h('input', { class: 'input', value: data.tags, placeholder: '标签，逗号分隔' });
      var cI = h('textarea', { class: 'input', rows: '6', placeholder: '内容 / 摘要 / 链接' });
      cI.value = data.content || '';
      var m = modal({
        title: isNew ? '新增资料' : '编辑资料',
        body: [field('标题', tI), h('div', { class: 'grid-2' }, field('类型', tyI), field('标签', tagI)), field('内容', cI)],
        footer: [btn('取消', 'ghost', function () { m.close(); }), btn('保存', 'primary', function () {
          if (!tI.value.trim()) { U.toast('请填写标题', 'warn'); return; }
          data.title = tI.value.trim(); data.type = tyI.value; data.tags = tagI.value.trim(); data.content = cI.value;
          data.updatedAt = Date.now();
          if (isNew) { data.createdAt = Date.now(); items.unshift(data); }
          else { for (var i = 0; i < items.length; i++) if (items[i].id === data.id) items[i] = data; }
          save(); m.close(); render(); U.toast('已保存', 'ok');
        })]
      });
    }

    function render() {
      U.clear(el);
      el.appendChild(pageHead('资料库', '收纳文献、链接、笔记与分析结论，支持关键词检索与 JSON 备份。',
        [btn('导出 JSON', 'ghost', function () {
          U.download('资料库.json', JSON.stringify(items, null, 2), 'application/json');
        }),
        btn('新增资料', 'primary', function () { edit(null); })]));

      var searchI = h('input', { class: 'input', value: q, placeholder: '搜索标题 / 内容 / 标签…' });
      searchI.addEventListener('input', U.debounce(function () { q = searchI.value; render(); }, 250));

      var list = filtered();
      el.appendChild(panel('检索', null, h('div', { class: 'row' }, searchI, h('span', { class: 'muted small', text: '共 ' + items.length + ' 条，命中 ' + list.length + ' 条' }))));

      if (!list.length) {
        el.appendChild(panel(null, null, emptyBox(items.length ? '没有匹配的资料。' : '资料库还是空的，点「新增资料」录入第一条。', btn('新增资料', 'primary', function () { edit(null); }))));
        return;
      }
      el.appendChild(panel('清单', null, h('div', { class: 'lib-list' }, list.map(function (it) {
        return h('div', { class: 'lib-item' },
          h('div', { class: 'li-head' }, h('strong', { text: it.title }), h('span', { class: 'tag', text: it.type || '笔记' })),
          it.content ? h('div', { class: 'li-content', text: it.content.length > 220 ? it.content.slice(0, 220) + '…' : it.content }) : null,
          h('div', { class: 'li-meta' },
            h('span', { class: 'muted small', text: U.fmtDate(it.updatedAt || it.createdAt) }),
            it.tags ? chips(String(it.tags).split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean)) : null,
            h('div', { class: 'li-actions' }, btn('编辑', 'mini ghost', function () { edit(it); }),
              btn('删除', 'mini danger-ghost', function () {
                items = items.filter(function (x) { return x.id !== it.id; }); save(); render();
              }))));
      }))));
    }
    render();
  }

  /* ===================================================================== */
  /* 7. 文献检索（纯链接跳转，不做跨域请求）                                */
  /* ===================================================================== */

  function SearchPage(root) {
    var el = h('div', { class: 'page' });
    root.appendChild(el);
    var ENGINES = [
      { name: 'Google Scholar', url: 'https://scholar.google.com/scholar?q=', hint: '全球学术搜索' },
      { name: '中国知网 CNKI', url: 'https://kns.cnki.net/kns8s/defaultresult/index?kw=', hint: '中文文献' },
      { name: 'PubMed', url: 'https://pubmed.ncbi.nlm.nih.gov/?term=', hint: '生物医学' },
      { name: 'arXiv', url: 'https://arxiv.org/abs/', hint: '预印本（请填 arXiv ID）' },
      { name: 'Semantic Scholar', url: 'https://www.semanticscholar.org/search?q=', hint: 'AI 语义检索' },
      { name: '万方数据', url: 'https://s.wanfangdata.com.cn/paper?q=', hint: '中文期刊/学位论文' }
    ];
    var qI = h('input', { class: 'input', placeholder: '输入关键词或论文标题' });
    var resBox = h('div', {});

    function doSearch(engine) {
      var q = qI.value.trim();
      if (!q) { U.toast('请输入检索词', 'warn'); return; }
      window.open(engine.url + encodeURIComponent(q), '_blank', 'noopener');
    }
    function localSearch() {
      var q = qI.value.trim().toLowerCase();
      U.clear(resBox);
      if (!q) { U.toast('请输入检索词', 'warn'); return; }
      var lib = Store.get('library', []), journals = Store.get('journals', []);
      var libHits = lib.filter(function (it) { return ((it.title || '') + (it.content || '') + (it.tags || '')).toLowerCase().indexOf(q) >= 0; });
      var tocHits = [];
      journals.forEach(function (j) {
        (j.entries || []).forEach(function (e) {
          if ((e.title || '').toLowerCase().indexOf(q) >= 0) tocHits.push({ journal: j.name, year: e.year, issue: e.issue, title: e.title });
        });
      });
      resBox.appendChild(panel('本地资料命中（' + libHits.length + '）', null,
        libHits.length ? h('div', { class: 'lib-list' }, libHits.map(function (it) {
          return h('div', { class: 'lib-item' }, h('div', { class: 'li-head' }, h('strong', { text: it.title }), h('span', { class: 'tag', text: it.type || '' })),
            h('div', { class: 'li-content', text: (it.content || '').slice(0, 160) }));
        })) : emptyBox('资料库中没有匹配项。')));
      resBox.appendChild(panel('期刊目录命中（' + tocHits.length + '）', null,
        tocHits.length ? h('table', { class: 'table compact' },
          h('thead', {}, h('tr', {}, h('th', { text: '期刊' }), h('th', { text: '年' }), h('th', { text: '期' }), h('th', { text: '标题' }))),
          h('tbody', {}, tocHits.slice(0, 40).map(function (t) {
            return h('tr', {}, h('td', { text: t.journal }), h('td', { text: t.year }), h('td', { text: t.issue }), h('td', { text: t.title }));
          }))) : emptyBox('期刊目录中没有匹配项。')));
    }

    el.appendChild(pageHead('文献检索', '点击按钮会新开标签页到对应学术站点检索（纯链接跳转，本应用不发起任何后台请求）；同时支持在本机资料库与期刊目录里检索。'));
    el.appendChild(panel('检索', null, h('div', {},
      field('检索词', qI),
      h('div', { class: 'row wrap' }, ENGINES.map(function (e) {
        return btn(e.name, 'ghost', function () { doSearch(e); });
      }), btn('在本机检索', 'primary', localSearch)),
      h('p', { class: 'muted small', text: '提示：外部站点需要联网；论文工作台本身离线可用。' }))));
    el.appendChild(resBox);
  }

  /* ===================================================================== */
  /* 8. 设置 / 关于                                                        */
  /* ===================================================================== */

  function AboutPage(root) {
    var el = h('div', { class: 'page' });
    root.appendChild(el);
    var fileInput = h('input', { type: 'file', accept: '.json', class: 'input' });
    fileInput.addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          // 兼容用户手工修改/Excel 另存导致的前导 BOM
          Store.importAll(JSON.parse(String(fr.result).replace(/^\ufeff/, '')));
          U.toast('数据已导入并刷新', 'ok');
          setTimeout(function () { location.reload(); }, 600);
        } catch (e) { U.toast('导入失败：' + e.message, 'error'); }
      };
      fr.readAsText(f, 'utf-8');
    });

    el.appendChild(pageHead('数据与关于', '所有数据都保存在你自己的浏览器（localStorage 前缀 paperwb_），不上传任何服务器。'));
    el.appendChild(panel('存储占用', null, h('div', {},
      h('p', { text: '当前占用约 ' + (Store.usage() / 1024).toFixed(1) + ' KB。浏览器 localStorage 通常上限 5MB，请留意记录量。' }),
      h('p', { class: 'muted small', text: '键名：paperwb_journals / paperwb_drafts / paperwb_metrics_data / paperwb_tasks / paperwb_library / paperwb_settings' }))));
    el.appendChild(panel('备份与恢复', null, h('div', {},
      h('div', { class: 'row' }, btn('导出全部数据 JSON', 'primary', function () {
        U.download('paperwb-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(Store.exportAll(), null, 2), 'application/json');
      })),
      h('div', { class: 'mt' }, field('导入备份 JSON', fileInput)))));
    el.appendChild(panel('危险操作', null, h('div', { class: 'row' }, btn('清空本应用全部数据', 'danger', function () {
      confirmBox('清空全部数据', '将删除本应用中所有期刊、草稿、数据集、任务与资料（不影响其它站点数据）。确定继续？', function () {
        Store.clearAll(); U.toast('已清空', 'ok'); setTimeout(function () { location.reload(); }, 500);
      }, '全部清空');
    }))));
    el.appendChild(panel('关于', null, h('div', {},
      h('p', { text: '论文写作与选刊工作台 · 纯前端 SPA（原生 HTML/CSS/JS，零运行时依赖，可静态部署）。' }),
      h('p', { class: 'muted small', text: '内置本地解析库：SheetJS（Excel）、mammoth（Word .docx）。画像引擎：中文 2~4 字 n-gram → 停用词过滤 → cleanTerms 去碎片 → 按年/期聚合词频权重。选刊打分：加权词重叠 + 饱和函数（1-exp(-k·x)）5:5 融合。' }))));
  }

  /* ===================================================================== */

  global.PAGES = global.PAGES || {};
  global.PAGES.WritePage = WritePage;
  global.PAGES.JournalsPage = JournalsPage;
  global.PAGES.AnalyzePage = AnalyzePage;
  global.PAGES.MetricsPage = MetricsPage;
  global.PAGES.DashPage = DashPage;
  global.PAGES.LibraryPage = LibraryPage;
  global.PAGES.SearchPage = SearchPage;
  global.PAGES.AboutPage = AboutPage;

  /* 同时把每个页面函数挂到全局（函数对象模式：function XxxPage(root, param)），
   * 这样 app.js 的 PAGES 映射既可用名字解析，也可直接用引用解析。 */
  global.WritePage = WritePage;
  global.JournalsPage = JournalsPage;
  global.AnalyzePage = AnalyzePage;
  global.MetricsPage = MetricsPage;
  global.DashPage = DashPage;
  global.LibraryPage = LibraryPage;
  global.SearchPage = SearchPage;
  global.AboutPage = AboutPage;

  // 供其它模块复用
  global.UI = { btn: btn, pageHead: pageHead, panel: panel, emptyBox: emptyBox, field: field, modal: modal, confirmBox: confirmBox, chips: chips, tabs: tabs };
})(typeof window !== 'undefined' ? window : globalThis);
