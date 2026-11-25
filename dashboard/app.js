// Token Launch Radar dashboard. Reads window.RADAR (data.js, written by main.ts beside this page).
// No network, no imports: every figure on the page is in data.js.
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) { document.getElementById('board').textContent = 'data.js did not load.'; return; }
  var M = D.model;
  var $ = function (id) { return document.getElementById(id); };
  var st = { tab: 'pre', q: '', cat: '', chain: '', sort: 'implied', dir: -1, detail: '' };

  // ---- formatting
  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function full(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(n) { return n === null || n === undefined ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function age(d) { return d === null || d === undefined ? 'unknown' : d >= 365 ? (d / 365).toFixed(1) + ' y' : d + ' d'; }
  function x(n) { return n.toFixed(4) + 'x'; }

  // ---- the model, recomputed from the snapshot figures (the same arithmetic as lib/model.ts)
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function catMult(category) {
    var c = category === null ? undefined : D.categories[category];
    if (!c || c.n < M.category_min_protocols || D.all_median_tvl <= 0) return 1;
    return clamp(Math.pow(c.median_tvl / D.all_median_tvl, M.category_exponent), M.category_floor, M.category_cap);
  }
  function model(r) {
    var g = clamp(r.change_7d === null ? 0 : r.change_7d, M.growth_floor, M.growth_cap);
    var growth = 1 + (g / 100) * M.growth_weight;
    var a = r.age_days === null ? M.unknown_age_days : r.age_days;
    var mat = M.maturity_floor + (Math.min(Math.max(a, 0), M.maturity_days) / M.maturity_days) * M.maturity_range;
    var chain = 1 + M.chain_step * Math.min(Math.max(r.chains.length - 1, 0), M.chain_extra_max);
    var cat = catMult(r.category);
    var implied = Math.max(1, Math.round(r.tvl_usd * M.base_multiple * growth * mat * chain * cat));
    return { g: g, growth: growth, mat: mat, chain: chain, cat: cat, implied: implied, age: a };
  }
  var bad = 0;
  D.rows.forEach(function (r) { if (model(r).implied !== r.implied_value_usd) bad++; });

  // ---- dom helper
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; }

  // ---- hash state: #detail=<slug>&category=<name>&chain=<name>
  function readHash() {
    var o = {};
    location.hash.replace(/^#/, '').split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('=');
      var k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? '' : kv.slice(i + 1);
      try { o[k] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { o[k] = v; }
    });
    st.detail = o.detail || '';
    st.cat = o.category || '';
    st.chain = o.chain || '';
    // Derive the tab entirely from this hash: no tab is inherited from the previous hash.
    if (st.detail) {
      // A detail link opens the drawer on the tab its protocol belongs to, and that becomes the tab.
      var inPre = false, inLive = false;
      for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === st.detail) inPre = true;
      for (var j = 0; j < D.live.length; j++) if (D.live[j].slug === st.detail) inLive = true;
      if (inPre) st.tab = 'pre';
      else if (inLive) st.tab = 'live';
      else if (o.tab === 'live') st.tab = 'live';
      else st.tab = 'pre';
    } else if (o.tab === 'live') st.tab = 'live';
    else st.tab = 'pre';
  }
  function writeHash() {
    var p = [];
    if (st.tab === 'live') p.push('tab=live');
    if (st.detail) p.push('detail=' + encodeURIComponent(st.detail));
    if (st.cat) p.push('category=' + encodeURIComponent(st.cat));
    if (st.chain) p.push('chain=' + encodeURIComponent(st.chain));
    var h = p.join('&');
    if (h === location.hash.replace(/^#/, '')) return;
    history.replaceState(null, '', h ? '#' + h : location.pathname + location.search);
  }

  // ---- static parts: summary, methodology
  function tiles() {
    var top = D.rows[0];
    var data = [
      ['Protocols in snapshot', String(D.protocol_count), 'DefiLlama, TVL of $5M or more'],
      ['Watchlist', String(D.watchlist_size), 'pre-token, TVL of ' + usd(D.floor_usd) + ' or more'],
      ['Board size', String(D.board_size), D.watchlist_size + ' watchlist + ' + D.early_size + ' early below the floor'],
      ['Board TVL', usd(D.board_tvl_usd), 'sum of the ' + D.board_size + ' ranked rows'],
      ['Top by implied value', top.name, full(top.implied_value_usd) + ' implied, rank 1', true]
    ];
    var box = $('tiles');
    data.forEach(function (t) {
      var d = el('div', 'tile' + (t[3] ? ' hero' : ''));
      add(d, el('div', 'k', t[0]), el('div', 'v', t[1]), el('div', 's', t[2]));
      box.appendChild(d);
    });
  }
  function method() {
    $('formula').textContent =
      'implied = max(1, round( TVL x ' + M.base_multiple + ' x growthMult x maturityMult x chainMult x categoryMult ))\n\n' +
      'growthMult   = 1 + clamp(change_7d, ' + M.growth_floor + ', ' + M.growth_cap + ') / 100 x ' + M.growth_weight + '\n' +
      '               (change_7d unknown: 0)\n' +
      'maturityMult = ' + M.maturity_floor + ' + min(max(age_days, 0), ' + M.maturity_days + ') / ' + M.maturity_days + ' x ' + M.maturity_range + '\n' +
      '               (age unknown: ' + M.unknown_age_days + ' days; listed_at unknown: age unknown)\n' +
      'chainMult    = 1 + ' + M.chain_step + ' x min(max(chains - 1, 0), ' + M.chain_extra_max + ')\n' +
      'categoryMult = clamp( (category median TVL / all-protocol median TVL) ^ ' + M.category_exponent + ', ' + M.category_floor + ', ' + M.category_cap + ' )\n' +
      '               1.0 when no category, or fewer than ' + M.category_min_protocols + ' protocols, or the median ratio is 1';
    var rows = [
      ['Base multiple', M.base_multiple], ['Growth weight', M.growth_weight], ['Growth clamp (%)', M.growth_floor + ' to ' + M.growth_cap],
      ['Maturity floor / range', M.maturity_floor + ' / ' + M.maturity_range], ['Maturity full at (days)', M.maturity_days], ['Unknown age (days)', M.unknown_age_days],
      ['Chain step / max extra', M.chain_step + ' / ' + M.chain_extra_max], ['Category exponent', M.category_exponent], ['Category clamp', M.category_floor + ' to ' + M.category_cap],
      ['Category minimum size', M.category_min_protocols], ['All-protocol median TVL', usd(D.all_median_tvl)]
    ];
    var dl = $('consts');
    rows.forEach(function (r) { add(dl, el('dt', '', r[0]), el('dd', '', String(r[1]))); });
    var ul = $('srcs');
    [
      'Source: ' + D.source + '.',
      'As of ' + D.as_of + '. The snapshot is sealed; nothing on this page is fetched.',
      'Board: every watchlist slug, then pre-token protocols below ' + usd(D.floor_usd) + ' by TVL until ' + D.board_size + ' rows. Ranked by implied value, slug on ties.',
      'Category medians for categoryMult are computed over all protocols in the snapshot, pre-token and live-token alike, because they measure sector size on DefiLlama.',
      'Live tokens: the top ' + D.live_size + ' protocols with a token, by market cap. Shown apart, never ranked with the board.',
      'Check: ' + (D.rows.length - bad) + ' of ' + D.rows.length + ' rows recompute in this page to the board value.'
    ].forEach(function (t) { add(ul, el('li', '', t)); });
    $('asof').textContent = 'snapshot ' + D.as_of + ' · ' + D.model_version;
  }

  // ---- filters
  function fillSelect(sel, label, values, cur) {
    sel.textContent = '';
    var vs = values.slice();
    if (cur && vs.indexOf(cur) < 0) vs.push(cur);
    add(sel, new Option(label, ''));
    vs.forEach(function (v) { sel.appendChild(new Option(v, v)); });
    sel.value = cur;
  }
  function options() {
    var cats = {}, chs = {};
    D.rows.concat(D.live).forEach(function (r) {
      if (r.category) cats[r.category] = (cats[r.category] || 0) + 1;
      r.chains.forEach(function (c) { chs[c] = (chs[c] || 0) + 1; });
    });
    var byCount = function (o) { return Object.keys(o).sort(function (a, b) { return o[b] - o[a] || (a < b ? -1 : 1); }); };
    fillSelect($('cat'), 'All categories', byCount(cats), st.cat);
    fillSelect($('chain'), 'All chains', byCount(chs), st.chain);
  }
  function visible() {
    var q = st.q.trim().toLowerCase();
    var src = st.tab === 'pre' ? D.rows : D.live;
    var out = src.filter(function (r) {
      if (st.cat && r.category !== st.cat) return false;
      if (st.chain && r.chains.indexOf(st.chain) < 0) return false;
      return !q || r.name.toLowerCase().indexOf(q) >= 0 || r.slug.toLowerCase().indexOf(q) >= 0;
    });
    var key = st.sort;
    var val = function (r) {
      if (key === 'implied') return r.implied_value_usd;
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'change') return r.change_7d;
      if (key === 'age') return r.age_days;
      if (key === 'mcap') return r.mcap_usd;
      return r.rank;
    };
    out.sort(function (a, b) {
      var va = val(a), vb = val(b);
      var ma = va === null || va === undefined, mb = vb === null || vb === undefined;
      if (ma && mb) return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
      if (ma) return 1;
      if (mb) return -1;
      if (va !== vb) return (va - vb) * st.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
    return out;
  }

  // ---- table
  var COLS = {
    pre: [['rank', '#', null], ['name', 'Protocol', null], ['cat', 'Category', null], ['chains', 'Chains', null], ['tvl', 'TVL', 'num'], ['change', '7d', 'num'], ['age', 'Age', 'num'], ['implied', 'Implied value', 'num']],
    live: [['name', 'Protocol', null], ['cat', 'Category', null], ['chains', 'Chains', null], ['mcap', 'Market cap', 'num'], ['tvl', 'TVL', 'num'], ['change', '7d', 'num']]
  };
  var SORTABLE = { tvl: 1, change: 1, age: 1, implied: 1, mcap: 1 };
  function setSort(k) {
    if (st.sort === k) st.dir = -st.dir; else { st.sort = k; st.dir = -1; }
    renderTable();
  }
  function chgCell(v) { return el('td', 'num ' + (v === null || v === undefined ? 'na' : v < 0 ? 'down' : 'up'), pct(v)); }
  function catCell(r) {
    var td = el('td');
    if (!r.category) { td.textContent = 'none'; td.className = 'na'; return td; }
    var b = el('button', 'catlink', r.category);
    b.type = 'button';
    b.title = 'Filter by ' + r.category;
    b.addEventListener('click', function (e) { e.stopPropagation(); st.cat = r.category; $('cat').value = r.category; sync(); });
    return add(td, b);
  }
  function chainCell(r) {
    var td = el('td', '', r.chains.length === 0 ? 'none' : r.chains[0] + (r.chains.length > 1 ? ' +' + (r.chains.length - 1) : ''));
    td.title = r.chains.join(', ');
    return td;
  }
  function renderTable() {
    var list = visible();
    var cols = COLS[st.tab];
    var wrap = $('board');
    wrap.textContent = '';
    $('count').textContent = list.length + ' of ' + (st.tab === 'pre' ? D.rows.length : D.live.length) + ' shown';
    $('note').textContent = st.tab === 'pre'
      ? 'Click a row for its model inputs and farm plan. Click a column header to sort. Implied value is this entry\'s own claim, not a price.'
      : 'Tokens that already trade. These are the market\'s own market caps, not model values, and they are not on the ranked board.';
    if (!list.length) { wrap.appendChild(el('p', 'empty', 'No protocol matches these filters.')); return; }
    var t = el('table'), cap = el('caption', 'sr', st.tab === 'pre' ? 'Pre-token protocols ranked by implied value' : 'Live-token protocols by market cap');
    var head = el('tr');
    cols.forEach(function (c) {
      var th = el('th', c[2] || '');
      th.scope = 'col';
      var key = c[0];
      if (SORTABLE[key]) {
        var b = el('button', '', c[1]);
        b.type = 'button';
        b.addEventListener('click', function () { setSort(key); });
        th.appendChild(b);
        if (st.sort === key) th.setAttribute('aria-sort', st.dir < 0 ? 'descending' : 'ascending');
      } else th.textContent = c[1];
      head.appendChild(th);
    });
    var tb = el('tbody');
    var max = D.rows[0].implied_value_usd;
    list.forEach(function (r) {
      var tr = el('tr');
      if (st.tab === 'pre') {
        tr.tabIndex = 0;
        tr.setAttribute('data-slug', r.slug);
        if (r.slug === st.detail) tr.className = 'sel';
        var open = function () { st.detail = r.slug; sync(); };
        tr.addEventListener('click', open);
        tr.addEventListener('keydown', function (e) { if (e.target !== tr) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
        tr.setAttribute('aria-label', 'Open ' + r.name);
        var nm = el('td', 'nm'), b = el('b', '', r.name);
        add(nm, b, r.watchlist ? el('span', 'badge', 'watchlist') : null, el('small', '', r.slug));
        var imp = el('td', 'num'), box = el('div', 'imp'), bar = el('span', 'bar'), fill = el('i');
        fill.style.width = Math.max(2, Math.round(r.implied_value_usd / max * 100)) + '%';
        add(box, bar, el('span', '', full(r.implied_value_usd)));
        bar.appendChild(fill);
        imp.appendChild(box);
        add(tr, el('td', 'rk', String(r.rank)), nm, catCell(r), chainCell(r), el('td', 'num', usd(r.tvl_usd)), chgCell(r.change_7d), el('td', 'num', age(r.age_days)), imp);
      } else {
        var n2 = el('td', 'nm');
        add(n2, el('b', '', r.name), el('small', '', r.slug));
        add(tr, n2, catCell(r), chainCell(r), el('td', 'num', usd(r.mcap_usd)), el('td', 'num', usd(r.tvl_usd)), chgCell(r.change_7d));
      }
      tb.appendChild(tr);
    });
    add(t, cap, add(el('thead'), head), tb);
    wrap.appendChild(t);
  }

  // ---- detail drawer
  var lastFocus = null;
  var lastFocusSlug = '';
  function restoreFocus(slug) {
    var row = null;
    if (slug) {
      try { row = document.querySelector('tr[data-slug="' + slug + '"]'); } catch (e) { row = null; }
    }
    if (row) { row.focus(); return; }
    var board = $('board');
    if (board) board.focus();
  }
  function stepParts(s) {
    var ti = s.lastIndexOf(' Time: '), ci = s.lastIndexOf(' Cost: ', ti);
    if (ti < 0 || ci < 0) return { text: s, cost: '', time: '' };
    return { text: s.slice(0, ci), cost: s.slice(ci + 7, ti).replace(/\.$/, ''), time: s.slice(ti + 7).replace(/\.$/, '') };
  }
  function renderDrawer() {
    var d = $('drawer');
    var wasHidden = d.hidden;
    var hadFocus = d.contains(document.activeElement);
    var r = null;
    for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === st.detail) r = D.rows[i];
    if (!r) { d.hidden = true; d.setAttribute('aria-hidden', 'true'); d.textContent = ''; return; }
    var m = model(r), ok = m.implied === r.implied_value_usd;
    d.textContent = '';
    var close = el('button', 'close', 'Close');
    close.type = 'button';
    close.addEventListener('click', function () { var slug = st.detail; st.detail = ''; sync(); restoreFocus(slug || lastFocusSlug); });
    var title = el('h2', '', r.name);
    title.id = 'd-title';
    var head = el('div', 'dh');
    add(head, add(el('div'), title, el('div', 'sub', r.slug + ' · rank ' + r.rank + ' of ' + D.board_size + (r.watchlist ? ' · watchlist' : ' · early, below the floor'))), close);
    var big = el('div', 'big');
    add(big, el('b', '', full(r.implied_value_usd)), el('span', '', 'implied value, this entry\'s own claim'), el('span', 'chk' + (ok ? '' : ' bad'), ok ? 'recomputed here: matches board' : 'recomputed here: ' + full(m.implied)));
    var kv = el('div', 'kv');
    [['TVL', usd(r.tvl_usd)], ['7d change', pct(r.change_7d)], ['Age', age(r.age_days)], ['Category', r.category || 'none'], ['Chains', String(r.chains.length)], ['Listed', r.listed_at || 'unknown']].forEach(function (p) {
      add(kv, add(el('div'), el('span', '', p[0]), el('b', '', p[1])));
    });
    var tbl = el('table', 'mt');
    var cn = D.categories[r.category];
    var catNote;
    if (r.category === null) catNote = 'no category: 1.0';
    else if (cn && cn.n < M.category_min_protocols) catNote = 'under ' + M.category_min_protocols + ' protocols: 1.0';
    else if (cn && cn.median_tvl === D.all_median_tvl) catNote = 'median ratio is 1: 1.0';
    else catNote = '(median / ' + usd(D.all_median_tvl) + ')^' + M.category_exponent;
    [
      ['TVL x base', full(r.tvl_usd) + ' x ' + M.base_multiple, full(r.tvl_usd * M.base_multiple), ''],
      ['Growth multiplier', 'growth ' + m.g.toFixed(2) + '% (clamped ' + M.growth_floor + ' to ' + M.growth_cap + ')' + (r.change_7d === null ? ' (unknown, counted as 0%)' : ''), x(m.growth), '1 + g/100 x ' + M.growth_weight],
      ['Maturity multiplier', 'age ' + m.age + ' days' + (r.age_days === null ? ' (unknown, counted as ' + M.unknown_age_days + ')' : ''), x(m.mat), M.maturity_floor + ' + min(max(age, 0), ' + M.maturity_days + ')/' + M.maturity_days + ' x ' + M.maturity_range],
      ['Chain multiplier', r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's'), x(m.chain), '1 + ' + M.chain_step + ' x min(max(chains - 1, 0), ' + M.chain_extra_max + ')'],
      ['Category multiplier', r.category === null ? 'no category' : (cn ? cn.n + ' protocols, median TVL ' + usd(cn.median_tvl) : 'no category data'), x(m.cat), catNote],
      ['Implied value', 'max(1, round(TVL x ' + M.base_multiple + ' x growth x maturity x chain x category))', full(m.implied), '']
    ].forEach(function (c) {
      var td1 = el('td', '', c[0]);
      add(td1, el('small', '', c[1] + (c[3] ? ' · ' + c[3] : '')));
      add(tbl, add(el('tr'), td1, el('td', '', c[2])));
    });
    var plan = el('ol', 'plan');
    r.farm_steps.forEach(function (s) {
      var p = stepParts(s), li = el('li', '', p.text), meta = el('div', 'meta');
      if (p.cost) add(meta, add(el('em', '', 'Cost '), el('b', '', p.cost)));
      if (p.time) add(meta, add(el('em', '', 'Time '), el('b', '', p.time)));
      li.appendChild(meta);
      plan.appendChild(li);
    });
    add(d, head, big, kv, el('h3', '', 'How the model got there'), tbl, el('h3', '', 'Farm plan, 6 steps'), plan,
      el('p', 'src', 'Source: ' + D.source + '. As of ' + D.as_of + '. The implied value is this entry\'s own claim; it does not predict whether or when a token is issued.'));
    d.hidden = false;
    d.setAttribute('aria-hidden', 'false');
    d.scrollTop = 0;
    if (wasHidden || hadFocus) close.focus();
  }

  // ---- wiring
  function sync() { writeHash(); renderTabs(); renderTable(); renderDrawer(); }
  function renderTabs() {
    ['pre', 'live'].forEach(function (t) { $('tab-' + t).setAttribute('aria-selected', String(st.tab === t)); });
    if (st.tab === 'live' && (st.sort === 'implied' || st.sort === 'age')) { st.sort = 'mcap'; st.dir = -1; }
    if (st.tab === 'pre' && st.sort === 'mcap') { st.sort = 'implied'; st.dir = -1; }
  }
  function init() {
    tiles(); method(); readHash(); options(); renderTabs(); renderTable(); renderDrawer();
    $('q').addEventListener('input', function (e) { st.q = e.target.value; renderTable(); });
    $('cat').addEventListener('change', function (e) { st.cat = e.target.value; sync(); });
    $('chain').addEventListener('change', function (e) { st.chain = e.target.value; sync(); });
    $('reset').addEventListener('click', function () { st.q = ''; st.cat = ''; st.chain = ''; st.detail = ''; $('q').value = ''; $('cat').value = ''; $('chain').value = ''; sync(); });
    document.querySelectorAll('[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () { st.tab = b.getAttribute('data-tab'); st.detail = ''; sync(); });
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && st.detail) { var slug = st.detail; st.detail = ''; sync(); restoreFocus(slug || lastFocusSlug); } });
    window.addEventListener('hashchange', function () { readHash(); options(); renderTabs(); renderTable(); renderDrawer(); });
    document.addEventListener('focusin', function (e) { if (e.target && e.target.tagName === 'TR') { lastFocus = e.target; lastFocusSlug = e.target.getAttribute('data-slug') || ''; } });
  }
  init();
})();
