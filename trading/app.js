/* Calendario de trading — lógica de la app.
   Datos en localStorage bajo una sola clave con formato versionado:
   { version: 1, trades: [{ id, date: "YYYY-MM-DD", asset, entry, exit, pnl, note }], lastExport }
   pnl se guarda con signo (positivo = ganancia, negativo = pérdida). */
(function () {
  'use strict';

  var STORAGE_KEY = 'trading-cal';
  var DATA_VERSION = 1;
  var MAX_ABS = 1e11;
  var MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var MINUS = '−';

  function $(id) { return document.getElementById(id); }

  /* ================= Fechas (siempre en hora local) ================= */

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toKey(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function parseKey(k) { var p = k.split('-'); return { y: +p[0], m: +p[1] - 1, d: +p[2] }; }
  function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
  function todayKey() { var t = new Date(); return toKey(t.getFullYear(), t.getMonth(), t.getDate()); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function isValidKey(k) {
    if (typeof k !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(k)) return false;
    var p = parseKey(k);
    return p.y >= 1900 && p.y <= 2999 && p.m >= 0 && p.m < 12 && p.d >= 1 && p.d <= daysInMonth(p.y, p.m);
  }

  function longDate(k) {
    var p = parseKey(k);
    var wd = new Date(p.y, p.m, p.d).getDay();
    var s = cap(WEEKDAYS[wd]) + ', ' + p.d + ' de ' + MONTHS[p.m];
    if (p.y !== new Date().getFullYear()) s += ' de ' + p.y;
    return s;
  }

  function shortDate(k) {
    var p = parseKey(k);
    return p.d + ' ' + MONTHS_SHORT[p.m];
  }

  /* ================= Números y dinero ================= */

  function toCents(n) { return Math.round(n * 100); }
  function round2(n) { var r = Math.round(n * 100) / 100; return r === 0 ? 0 : r; }
  function groupInt(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

  function signOf(n) { return n > 0 ? '+' : (n < 0 ? MINUS : ''); }

  // 1234.5 -> "+$1.234,50"
  function fmtMoney(n) {
    var c = Math.round(Math.abs(n) * 100);
    var intPart = Math.floor(c / 100);
    var dec = c % 100;
    var sign = c === 0 ? '' : signOf(n);
    return sign + '$' + groupInt(String(intPart)) + ',' + pad(dec);
  }

  function oneDec(x) { return x.toFixed(1).replace(/\.0$/, '').replace('.', ','); }

  // Formato compacto para las celdas: +120, −45, +45,5, +1,2k, +12k, +1,2M (máx. 5 caracteres)
  function fmtCompact(n) {
    var a = Math.abs(n);
    var s;
    if (a < 99.95) s = oneDec(Math.round(a * 10) / 10);
    else if (a < 999.5) s = String(Math.round(a));
    else if (a < 9950) s = oneDec(Math.round(a / 100) / 10) + 'k';
    else if (a < 999500) s = Math.round(a / 1000) + 'k';
    else if (a < 9950000) s = oneDec(Math.round(a / 100000) / 10) + 'M';
    else if (a < 999500000) s = Math.round(a / 1e6) + 'M';
    else s = oneDec(Math.round(a / 1e8) / 10) + 'B';
    if (s === '0') return '0';
    return signOf(n) + s;
  }

  // Precio: hasta 6 decimales, sin ceros sobrantes. 21500.25 -> "21.500,25"
  function fmtPrice(n) {
    var s = Math.abs(n).toFixed(6).replace(/\.?0+$/, '');
    var parts = s.split('.');
    return (n < 0 ? MINUS : '') + groupInt(parts[0]) + (parts[1] ? ',' + parts[1] : '');
  }

  // Número para rellenar un input (con coma decimal y sin separador de miles)
  function numToInput(n) {
    return (Math.round(n * 1e8) / 1e8).toFixed(8).replace(/\.?0+$/, '').replace('.', ',');
  }

  // Acepta "1234,5", "1234.5", "1.234,5", "+12". Vacío -> null. Inválido -> NaN.
  function parseNum(str) {
    var s = String(str == null ? '' : str).replace(/[\s $]/g, '').replace(/^\+/, '').replace(MINUS, '-');
    if (!s) return null;
    var hasComma = s.indexOf(',') > -1;
    var hasDot = s.indexOf('.') > -1;
    if (hasComma && hasDot) s = s.replace(/\./g, '').replace(',', '.');
    else if (hasComma) s = s.replace(',', '.');
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
    var n = parseFloat(s);
    return isFinite(n) ? n : NaN;
  }

  /* ================= Datos ================= */

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function emptyData() { return { version: DATA_VERSION, trades: [], lastExport: null }; }

  function optNum(v) {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
    var n = Number(v);
    return isFinite(n) && Math.abs(n) <= MAX_ABS ? n : null;
  }

  function cleanTrade(t) {
    if (!t || typeof t !== 'object') return null;
    if (!isValidKey(t.date)) return null;
    var asset = typeof t.asset === 'string' ? t.asset.trim().slice(0, 24) : '';
    if (!asset) return null;
    if (t.pnl === null || t.pnl === '' || typeof t.pnl === 'boolean') return null;
    var pnl = Number(t.pnl);
    if (!isFinite(pnl) || Math.abs(pnl) > MAX_ABS) return null;
    return {
      id: typeof t.id === 'string' && t.id ? t.id.slice(0, 40) : uid(),
      date: t.date,
      asset: asset,
      entry: optNum(t.entry),
      exit: optNum(t.exit),
      pnl: round2(pnl),
      note: typeof t.note === 'string' ? t.note.slice(0, 1000) : ''
    };
  }

  // Convierte cualquier versión conocida (o un array suelto) al formato actual.
  function normalize(obj) {
    var list;
    if (Array.isArray(obj)) list = obj;
    else if (obj && typeof obj === 'object' && Array.isArray(obj.trades)) list = obj.trades;
    else return null;
    var out = [];
    var seen = {};
    var skipped = 0;
    list.forEach(function (t) {
      var c = cleanTrade(t);
      if (!c) { skipped++; return; }
      if (seen[c.id]) c.id = uid();
      seen[c.id] = true;
      out.push(c);
    });
    var lastExport = obj && typeof obj.lastExport === 'string' ? obj.lastExport : null;
    return { data: { version: DATA_VERSION, trades: out, lastExport: lastExport }, skipped: skipped };
  }

  var loadProblem = false;

  function loadData() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { loadProblem = true; return emptyData(); }
    if (!raw) return emptyData();
    try {
      var res = normalize(JSON.parse(raw));
      if (res) return res.data;
    } catch (e) { /* JSON corrupto */ }
    loadProblem = true;
    return emptyData();
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
      return true;
    } catch (e) {
      toast('No se pudo guardar. Revisa el espacio disponible.');
      return false;
    }
  }

  // Aplica un cambio y lo guarda; si falla el guardado, deshace el cambio.
  function commit(mutator) {
    var before = JSON.stringify(state.data);
    mutator(state.data);
    if (save()) return true;
    state.data = JSON.parse(before);
    return false;
  }

  function dayIndex() {
    var map = {};
    state.data.trades.forEach(function (t) {
      var d = map[t.date] || (map[t.date] = { trades: [], cents: 0 });
      d.trades.push(t);
      d.cents += toCents(t.pnl);
    });
    return map;
  }

  function findTrade(id) {
    for (var i = 0; i < state.data.trades.length; i++) {
      if (state.data.trades[i].id === id) return state.data.trades[i];
    }
    return null;
  }

  /* ================= Estado ================= */

  var now = new Date();
  var state = {
    data: loadData(),
    y: now.getFullYear(),
    m: now.getMonth(),
    sheetOpen: false,
    sheetDate: null,
    view: 'list',
    editId: null,
    kind: 'win'
  };

  var el = {
    title: $('month-title'),
    grid: $('grid'),
    calendar: $('calendar'),
    sumNet: $('sum-net'),
    ratio: $('ratio'),
    ratioG: $('ratio-g'),
    ratioR: $('ratio-r'),
    stCount: $('st-count'),
    stWin: $('st-winrate'),
    stDays: $('st-days'),
    stBest: $('st-best'),
    stWorst: $('st-worst'),
    backupLast: $('backup-last'),
    backdrop: $('backdrop'),
    sheet: $('sheet'),
    viewList: $('view-list'),
    viewForm: $('view-form'),
    sheetTitle: $('sheet-title'),
    sheetSub: $('sheet-sub'),
    trades: $('trades'),
    emptyMsg: $('empty-msg'),
    formTitle: $('form-title'),
    formBody: $('form-body'),
    fAsset: $('f-asset'),
    fAmount: $('f-amount'),
    fEntry: $('f-entry'),
    fExit: $('f-exit'),
    fNote: $('f-note'),
    fDate: $('f-date'),
    kindWin: $('kind-win'),
    kindLoss: $('kind-loss'),
    deleteBtn: $('delete-btn'),
    assetList: $('asset-list'),
    importFile: $('import-file'),
    dialog: $('dialog'),
    dTitle: $('dialog-title'),
    dMsg: $('dialog-msg'),
    dOk: $('dialog-ok'),
    dCancel: $('dialog-cancel'),
    toast: $('toast')
  };

  /* ================= Render ================= */

  function render(dir) {
    var idx = dayIndex();
    el.title.textContent = cap(MONTHS[state.m]) + ' ' + state.y;
    renderSummary(idx);
    renderGrid(idx, dir);
    renderBackup();
    if (state.sheetOpen && state.view === 'list') renderList(idx);
  }

  function setSigned(node, cents) {
    node.classList.remove('pos', 'neg');
    if (cents > 0) node.classList.add('pos');
    else if (cents < 0) node.classList.add('neg');
  }

  function renderSummary(idx) {
    var prefix = state.y + '-' + pad(state.m + 1) + '-';
    var keys = Object.keys(idx).filter(function (k) { return k.indexOf(prefix) === 0; }).sort();
    var net = 0, count = 0, wins = 0, green = 0, red = 0, best = null, worst = null;

    keys.forEach(function (k) {
      var d = idx[k];
      net += d.cents;
      count += d.trades.length;
      d.trades.forEach(function (t) { if (t.pnl > 0) wins++; });
      if (d.cents > 0) green++;
      else if (d.cents < 0) red++;
      if (!best || d.cents > best.c) best = { k: k, c: d.cents };
      if (!worst || d.cents < worst.c) worst = { k: k, c: d.cents };
    });

    var netText = fmtMoney(net / 100);
    el.sumNet.textContent = netText;
    setSigned(el.sumNet, net);
    el.sumNet.classList.toggle('long', netText.length > 13 && netText.length <= 16);
    el.sumNet.classList.toggle('xlong', netText.length > 16);
    el.sumNet.setAttribute('aria-label', 'Resultado neto de ' + MONTHS[state.m] + ': ' + netText);

    el.stCount.textContent = String(count);
    el.stWin.textContent = count ? Math.round(wins / count * 100) + ' %' : '—';

    if (green + red) {
      el.stDays.innerHTML = '<span class="pos">' + green + '</span><span class="sep"> / </span><span class="neg">' + red + '</span>';
    } else {
      el.stDays.textContent = '—';
    }

    fillDayStat(el.stBest, best);
    fillDayStat(el.stWorst, worst);

    var total = green + red;
    el.ratioG.style.width = total ? (green / total * 100) + '%' : '0';
    el.ratioR.style.width = total ? (red / total * 100) + '%' : '0';
    el.ratio.classList.toggle('single', !green || !red);
  }

  function fillDayStat(node, item) {
    node.textContent = '';
    if (!item) { node.textContent = '—'; return; }
    var v = document.createElement('span');
    v.textContent = fmtMoney(item.c / 100);
    setSigned(v, item.c);
    var d = document.createElement('span');
    d.className = 'muted';
    d.textContent = ' · ' + shortDate(item.k);
    node.appendChild(v);
    node.appendChild(d);
  }

  function renderGrid(idx, dir) {
    var y = state.y, m = state.m;
    var offset = (new Date(y, m, 1).getDay() + 6) % 7; // semana empieza en lunes
    var dim = daysInMonth(y, m);
    var total = Math.ceil((offset + dim) / 7) * 7;
    var tk = todayKey();
    var frag = document.createDocumentFragment();

    for (var i = 0; i < total; i++) {
      var d = i - offset + 1;
      if (d < 1 || d > dim) {
        var e = document.createElement('div');
        e.className = 'day empty';
        e.setAttribute('aria-hidden', 'true');
        frag.appendChild(e);
        continue;
      }
      var k = toKey(y, m, d);
      var info = idx[k];
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'day';
      b.dataset.date = k;
      var label = d + ' de ' + MONTHS[m];

      var num = document.createElement('span');
      num.className = 'day-num';
      num.textContent = d;
      b.appendChild(num);

      if (info) {
        var c = info.cents;
        b.classList.add(c > 0 ? 'pos' : (c < 0 ? 'neg' : 'flat'));
        var v = document.createElement('span');
        v.className = 'day-val';
        v.textContent = fmtCompact(c / 100);
        b.appendChild(v);
        label += ', ' + info.trades.length + (info.trades.length === 1 ? ' operación, ' : ' operaciones, ') + fmtMoney(c / 100);
      }
      if (k === tk) {
        b.classList.add('today');
        b.setAttribute('aria-current', 'date');
        label += ', hoy';
      }
      b.setAttribute('aria-label', label);
      frag.appendChild(b);
    }

    el.grid.textContent = '';
    el.grid.appendChild(frag);

    if (dir) {
      el.grid.classList.remove('in-next', 'in-prev');
      void el.grid.offsetWidth; // reinicia la animación
      el.grid.classList.add(dir === 'next' ? 'in-next' : 'in-prev');
    }
  }

  function renderBackup() {
    var n = state.data.trades.length;
    var txt;
    if (!state.data.lastExport) {
      txt = n ? 'Aún no has exportado ninguna copia.' : '';
    } else {
      var days = Math.floor((Date.now() - new Date(state.data.lastExport).getTime()) / 86400000);
      txt = 'Última copia: ' + (days <= 0 ? 'hoy' : days === 1 ? 'ayer' : 'hace ' + days + ' días') + '.';
    }
    el.backupLast.textContent = txt;
    el.backupLast.hidden = !txt;
  }

  /* ================= Hoja inferior ================= */

  var lastFocus = null;

  function openSheet(date) {
    state.sheetDate = date;
    showList();
    if (state.sheetOpen) return;
    state.sheetOpen = true;
    lastFocus = document.activeElement;
    el.backdrop.classList.add('open');
    el.sheet.classList.add('open');
    el.sheet.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lock');
    syncViewport();
    setTimeout(function () { $('sheet-close').focus({ preventScroll: true }); }, 0);
  }

  function closeSheet() {
    if (!state.sheetOpen) return;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    state.sheetOpen = false;
    state.editId = null;
    el.backdrop.classList.remove('open');
    el.sheet.classList.remove('open');
    el.sheet.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lock');
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  }

  function showList() {
    state.view = 'list';
    state.editId = null;
    el.viewForm.hidden = true;
    el.viewList.hidden = false;
    renderList(dayIndex());
  }

  function renderList(idx) {
    var info = idx[state.sheetDate];
    var trades = info ? info.trades : [];
    el.sheetTitle.textContent = longDate(state.sheetDate);

    el.sheetSub.textContent = '';
    if (trades.length) {
      el.sheetSub.appendChild(document.createTextNode(
        trades.length + (trades.length === 1 ? ' operación · ' : ' operaciones · ')));
      var net = document.createElement('span');
      net.textContent = fmtMoney(info.cents / 100);
      setSigned(net, info.cents);
      el.sheetSub.appendChild(net);
    } else {
      el.sheetSub.textContent = 'Sin operaciones';
    }

    el.trades.textContent = '';
    trades.forEach(function (t) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'trade';
      b.dataset.id = t.id;

      var main = document.createElement('span');
      main.className = 'trade-main';
      var asset = document.createElement('span');
      asset.className = 'trade-asset';
      asset.textContent = t.asset;
      main.appendChild(asset);

      var meta = priceLine(t);
      if (meta) {
        var m = document.createElement('span');
        m.className = 'trade-meta';
        m.textContent = meta;
        main.appendChild(m);
      }
      if (t.note) {
        var n = document.createElement('span');
        n.className = 'trade-note';
        n.textContent = t.note;
        main.appendChild(n);
      }

      var pnl = document.createElement('span');
      pnl.className = 'trade-pnl';
      pnl.textContent = fmtMoney(t.pnl);
      setSigned(pnl, toCents(t.pnl));

      b.appendChild(main);
      b.appendChild(pnl);
      b.setAttribute('aria-label', 'Editar ' + t.asset + ', ' + fmtMoney(t.pnl));
      li.appendChild(b);
      el.trades.appendChild(li);
    });
    el.emptyMsg.hidden = trades.length > 0;
  }

  function priceLine(t) {
    if (t.entry != null && t.exit != null) return fmtPrice(t.entry) + ' → ' + fmtPrice(t.exit);
    if (t.entry != null) return 'Entrada ' + fmtPrice(t.entry);
    if (t.exit != null) return 'Salida ' + fmtPrice(t.exit);
    return '';
  }

  /* ================= Formulario ================= */

  function setKind(kind) {
    state.kind = kind;
    el.kindWin.setAttribute('aria-pressed', String(kind === 'win'));
    el.kindLoss.setAttribute('aria-pressed', String(kind === 'loss'));
  }

  function refreshAssetList() {
    var freq = {};
    state.data.trades.forEach(function (t) { freq[t.asset] = (freq[t.asset] || 0) + 1; });
    var assets = Object.keys(freq).sort(function (a, b) { return freq[b] - freq[a]; }).slice(0, 20);
    el.assetList.textContent = '';
    assets.forEach(function (a) {
      var o = document.createElement('option');
      o.value = a;
      el.assetList.appendChild(o);
    });
  }

  function showForm(trade) {
    state.view = 'form';
    state.editId = trade ? trade.id : null;
    el.viewList.hidden = true;
    el.viewForm.hidden = false;
    el.formTitle.textContent = trade ? 'Editar operación' : 'Nueva operación';
    el.fAsset.value = trade ? trade.asset : '';
    el.fAmount.value = trade ? numToInput(Math.abs(trade.pnl)) : '';
    setKind(trade && trade.pnl < 0 ? 'loss' : 'win');
    el.fEntry.value = trade && trade.entry != null ? numToInput(trade.entry) : '';
    el.fExit.value = trade && trade.exit != null ? numToInput(trade.exit) : '';
    el.fNote.value = trade ? trade.note : '';
    el.fDate.value = trade ? trade.date : state.sheetDate;
    el.deleteBtn.hidden = !trade;
    clearErrors();
    refreshAssetList();
    el.formBody.scrollTop = 0;
  }

  var ERR_FIELDS = [
    ['asset', 'f-asset'], ['amount', 'f-amount'], ['entry', 'f-entry'], ['exit', 'f-exit'], ['date', 'f-date']
  ];

  function clearErrors() {
    ERR_FIELDS.forEach(function (p) {
      var e = $('err-' + p[0]);
      e.hidden = true;
      e.textContent = '';
      $(p[1]).removeAttribute('aria-invalid');
    });
  }

  function fieldError(name, inputId, msg) {
    var e = $('err-' + name);
    e.textContent = msg;
    e.hidden = false;
    $(inputId).setAttribute('aria-invalid', 'true');
  }

  function onSubmit(ev) {
    ev.preventDefault();
    clearErrors();
    var ok = true;

    var asset = el.fAsset.value.trim().toUpperCase();
    if (!asset) { fieldError('asset', 'f-asset', 'Indica el activo.'); ok = false; }

    var amt = parseNum(el.fAmount.value);
    if (amt === null) { fieldError('amount', 'f-amount', 'Indica el resultado en $.'); ok = false; }
    else if (isNaN(amt)) { fieldError('amount', 'f-amount', 'Introduce un número válido, por ejemplo 125,50.'); ok = false; }
    else if (amt < 0) { fieldError('amount', 'f-amount', 'Escribe el importe sin signo y elige Ganancia o Pérdida.'); ok = false; }
    else if (amt > MAX_ABS) { fieldError('amount', 'f-amount', 'El importe es demasiado grande.'); ok = false; }

    var entry = parseNum(el.fEntry.value);
    if (entry !== null && (isNaN(entry) || Math.abs(entry) > MAX_ABS)) {
      fieldError('entry', 'f-entry', 'Debe ser un número.'); ok = false;
    }
    var exit = parseNum(el.fExit.value);
    if (exit !== null && (isNaN(exit) || Math.abs(exit) > MAX_ABS)) {
      fieldError('exit', 'f-exit', 'Debe ser un número.'); ok = false;
    }

    var date = el.fDate.value;
    if (!isValidKey(date)) { fieldError('date', 'f-date', 'Elige una fecha válida.'); ok = false; }

    if (!ok) {
      var firstErr = el.viewForm.querySelector('.err:not([hidden])');
      if (firstErr) firstErr.parentNode.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }

    var rec = {
      date: date,
      asset: asset,
      entry: entry,
      exit: exit,
      pnl: round2(state.kind === 'loss' ? -amt : amt),
      note: el.fNote.value.trim().slice(0, 1000)
    };
    var editing = state.editId;

    var saved = commit(function (data) {
      if (editing) {
        var t = null;
        for (var i = 0; i < data.trades.length; i++) if (data.trades[i].id === editing) t = data.trades[i];
        if (t) {
          var moved = t.date !== rec.date;
          Object.keys(rec).forEach(function (k) { t[k] = rec[k]; });
          if (moved) { // al cambiar de día, pasa al final de la lista de ese día
            data.trades.splice(data.trades.indexOf(t), 1);
            data.trades.push(t);
          }
          return;
        }
      }
      rec.id = uid();
      data.trades.push(rec);
    });
    if (!saved) return;

    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();

    // Si la fecha está en otro mes, el calendario se mueve a ese mes.
    var p = parseKey(date);
    var dir = null;
    if (p.y !== state.y || p.m !== state.m) {
      dir = (p.y * 12 + p.m) > (state.y * 12 + state.m) ? 'next' : 'prev';
      state.y = p.y;
      state.m = p.m;
    }
    state.sheetDate = date;
    showList();
    render(dir);
    toast(editing ? 'Operación actualizada' : 'Operación guardada');
  }

  function onDelete() {
    var t = findTrade(state.editId);
    if (!t) return;
    confirmDialog({
      title: '¿Eliminar operación?',
      message: t.asset + ' · ' + fmtMoney(t.pnl) + '. No se puede deshacer.',
      ok: 'Eliminar',
      danger: true
    }).then(function (yes) {
      if (!yes) return;
      var id = t.id;
      var done = commit(function (data) {
        data.trades = data.trades.filter(function (x) { return x.id !== id; });
      });
      if (!done) return;
      showList();
      render();
      toast('Operación eliminada');
    });
  }

  /* ================= Diálogo y avisos ================= */

  var dialogTimer = null;

  function confirmDialog(o) {
    return new Promise(function (resolve) {
      clearTimeout(dialogTimer);
      var prev = document.activeElement;
      el.dTitle.textContent = o.title;
      el.dMsg.textContent = o.message || '';
      el.dOk.textContent = o.ok || 'Aceptar';
      el.dOk.classList.toggle('danger', !!o.danger);
      el.dialog.hidden = false;
      void el.dialog.offsetWidth;
      el.dialog.classList.add('open');
      el.dCancel.focus({ preventScroll: true });

      function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); done(false); }
      }
      function done(v) {
        el.dOk.onclick = el.dCancel.onclick = null;
        document.removeEventListener('keydown', onKey, true);
        el.dialog.classList.remove('open');
        dialogTimer = setTimeout(function () { el.dialog.hidden = true; }, 200);
        if (prev && prev.focus && document.contains(prev) && prev.offsetParent !== null) prev.focus({ preventScroll: true });
        resolve(v);
      }
      el.dOk.onclick = function () { done(true); };
      el.dCancel.onclick = function () { done(false); };
      document.addEventListener('keydown', onKey, true);
    });
  }

  var toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, 2400);
  }

  /* ================= Copia de seguridad ================= */

  function markExported() {
    commit(function (data) { data.lastExport = new Date().toISOString(); });
    renderBackup();
  }

  function downloadFile(json, name) {
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    markExported();
  }

  function exportData() {
    var payload = {
      app: 'trading-cal',
      version: DATA_VERSION,
      exportedAt: new Date().toISOString(),
      trades: state.data.trades
    };
    var json = JSON.stringify(payload, null, 2);
    var name = 'trading-' + todayKey() + '.json';
    var file = null;
    try { file = new File([json], name, { type: 'application/json' }); } catch (e) { file = null; }

    // En iPhone la hoja de compartir permite guardar en Archivos, iCloud, AirDrop…
    var touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (touch && file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: name })
        .then(markExported)
        .catch(function (err) { if (!err || err.name !== 'AbortError') downloadFile(json, name); });
    } else {
      downloadFile(json, name);
    }
  }

  function importFromText(text) {
    var res = null;
    try { res = normalize(JSON.parse(text)); } catch (e) { res = null; }
    if (!res) { toast('El archivo no es una copia válida.'); return; }
    var incoming = res.data.trades;
    if (!incoming.length && res.skipped) { toast('El archivo no contiene operaciones válidas.'); return; }

    var current = state.data.trades.length;
    var msg = 'Se reemplazarán tus ' + current + (current === 1 ? ' operación actual' : ' operaciones actuales') +
      ' por las ' + incoming.length + ' del archivo.';
    if (res.skipped) msg += ' Se ignorarán ' + res.skipped + ' entradas no válidas.';
    msg += ' No se puede deshacer.';

    confirmDialog({ title: '¿Reemplazar datos?', message: msg, ok: 'Reemplazar', danger: true }).then(function (yes) {
      if (!yes) return;
      var ok = commit(function (data) { data.trades = incoming; });
      if (!ok) return;
      render();
      toast('Importadas ' + incoming.length + (incoming.length === 1 ? ' operación' : ' operaciones'));
    });
  }

  function onImportFile() {
    var f = el.importFile.files && el.importFile.files[0];
    el.importFile.value = '';
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { toast('El archivo es demasiado grande.'); return; }
    var reader = new FileReader();
    reader.onload = function () { importFromText(String(reader.result || '')); };
    reader.onerror = function () { toast('No se pudo leer el archivo.'); };
    reader.readAsText(f);
  }

  /* ================= Navegación ================= */

  function shiftMonth(delta) {
    var d = new Date(state.y, state.m + delta, 1);
    state.y = d.getFullYear();
    state.m = d.getMonth();
    render(delta > 0 ? 'next' : 'prev');
  }

  function goToday() {
    var t = new Date();
    var cur = state.y * 12 + state.m;
    var target = t.getFullYear() * 12 + t.getMonth();
    state.y = t.getFullYear();
    state.m = t.getMonth();
    render(target === cur ? null : (target > cur ? 'next' : 'prev'));
  }

  /* ================= Teclado de iOS / visual viewport ================= */

  function syncViewport() {
    var vv = window.visualViewport;
    if (!vv) return;
    var kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    if (kb < 40) kb = 0;
    var root = document.documentElement.style;
    root.setProperty('--kb', kb + 'px');
    root.setProperty('--vvh', Math.round(vv.height) + 'px');
    el.sheet.classList.toggle('kb', kb > 0);
  }

  /* ================= Gestos ================= */

  // Deslizar hacia abajo desde la cabecera de la hoja para cerrarla.
  var drag = null;
  el.sheet.addEventListener('pointerdown', function (e) {
    if (!state.sheetOpen || !e.target.closest('.drag-zone') || e.target.closest('button, input, textarea')) return;
    drag = { y: e.clientY, dy: 0, id: e.pointerId };
    el.sheet.classList.add('dragging');
    try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
  });
  el.sheet.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag.dy = Math.max(0, e.clientY - drag.y);
    el.sheet.style.transform = 'translateY(' + drag.dy + 'px)';
  });
  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dy = drag.dy;
    drag = null;
    el.sheet.classList.remove('dragging');
    el.sheet.style.transform = '';
    if (dy > 90) closeSheet();
  }
  el.sheet.addEventListener('pointerup', endDrag);
  el.sheet.addEventListener('pointercancel', endDrag);

  // Deslizar a los lados sobre el calendario para cambiar de mes.
  var swipe = null;
  var suppressClick = false;
  el.calendar.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) { swipe = null; return; }
    swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  }, { passive: true });
  el.calendar.addEventListener('touchend', function (e) {
    if (!swipe) return;
    var t = e.changedTouches[0];
    var dx = t.clientX - swipe.x;
    var dy = t.clientY - swipe.y;
    var fast = Date.now() - swipe.t < 600;
    swipe = null;
    if (fast && Math.abs(dx) > 50 && Math.abs(dy) < 40) {
      suppressClick = true;
      setTimeout(function () { suppressClick = false; }, 350);
      shiftMonth(dx < 0 ? 1 : -1);
    }
  }, { passive: true });

  /* ================= Eventos ================= */

  // Activa :active en iOS.
  document.addEventListener('touchstart', function () {}, { passive: true });

  $('prev').addEventListener('click', function () { shiftMonth(-1); });
  $('next').addEventListener('click', function () { shiftMonth(1); });
  $('today').addEventListener('click', goToday);

  el.grid.addEventListener('click', function (e) {
    if (suppressClick) return;
    var b = e.target.closest('.day[data-date]');
    if (b) openSheet(b.dataset.date);
  });

  el.backdrop.addEventListener('click', closeSheet);
  $('sheet-close').addEventListener('click', closeSheet);
  $('add-btn').addEventListener('click', function () { showForm(null); });
  el.trades.addEventListener('click', function (e) {
    var b = e.target.closest('.trade');
    if (!b) return;
    var t = findTrade(b.dataset.id);
    if (t) showForm(t);
  });

  $('form-cancel').addEventListener('click', showList);
  el.viewForm.addEventListener('submit', onSubmit);
  el.deleteBtn.addEventListener('click', onDelete);
  el.kindWin.addEventListener('click', function () { setKind('win'); });
  el.kindLoss.addEventListener('click', function () { setKind('loss'); });

  // Lleva a la vista el campo enfocado cuando aparece el teclado.
  el.viewForm.addEventListener('focusin', function (e) {
    var t = e.target;
    if (!t.matches('input, textarea')) return;
    setTimeout(function () { t.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 300);
  });

  $('export-btn').addEventListener('click', exportData);
  $('import-btn').addEventListener('click', function () { el.importFile.click(); });
  el.importFile.addEventListener('change', onImportFile);

  document.addEventListener('keydown', function (e) {
    if (!el.dialog.hidden) return;
    if (e.key === 'Escape' && state.sheetOpen) {
      if (state.view === 'form') showList(); else closeSheet();
      return;
    }
    if (state.sheetOpen) return;
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft') shiftMonth(-1);
    else if (e.key === 'ArrowRight') shiftMonth(1);
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncViewport);
    window.visualViewport.addEventListener('scroll', syncViewport);
  }

  // Al volver a la app (p. ej. al día siguiente) refresca el anillo de "hoy".
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') render();
  });

  /* ================= Inicio ================= */

  render();
  if (loadProblem) toast('No se pudieron leer los datos guardados.');

  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(function () {});
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (err) {
        console.warn('No se pudo registrar el service worker:', err);
      });
    });
  }
})();
