// js/ogren.js : Kelime Laboratuvarı ve Gramer Akademisi.
// İçerik data/ogren.js dosyasından (window.YDS_LEARN) gelir; çıkmış sorular js/app.js'teki soru bankasındadır.
(function () {
  "use strict";
  var APP = window.YDS_APP, L = window.YDS_LEARN;
  if (!APP || !L) return;
  var esc = APP.esc, view = APP.view;
  var POS = { v: "Fiil", n: "İsim", adj: "Sıfat", adv: "Zarf", pv: "Phrasal verb" };
  var LVL = { 1: "Temel", 2: "Orta", 3: "İleri" };
  var DAY = 86400000;
  // Aralıklı tekrar kutuları (Leitner): her doğru cevap kelimeyi bir sonraki kutuya taşır.
  // Kutu 1 → 1 gün, 2 → 3 gün, 3 → 7 gün, 4 → 14 gün, 5 → 30 gün sonra tekrar. Yanlış cevap kelimeyi kutu 1'e geri atar.
  var INTERVAL = [0, 1, 3, 7, 14, 30];

  // ---------- Kelime listesi: kelimeler + phrasal verb'ler tek havuzda ----------
  var ITEMS = L.words.map(function (w) { return Object.assign({ key: "w:" + w.w, head: w.w, kind: "word" }, w); })
    .concat(L.phrasal.map(function (p) {
      return Object.assign({}, p, { key: "p:" + p.k, head: p.k, kind: "phrasal", pos: "pv",
        syn: p.syn ? p.syn.split(/,\s*/) : [], ant: [], col: [], fam: "", lvl: 2 });
    }));
  var BY_KEY = {};
  ITEMS.forEach(function (it) { BY_KEY[it.key] = it; });

  // ---------- Kayıt ----------
  function store() {
    var st = APP.state;
    if (!st.learn) st.learn = {};
    if (!st.learn.words) st.learn.words = {};
    if (!st.learn.saved) st.learn.saved = {};
    return st.learn;
  }
  function progressOf(key) { return store().words[key] || null; }
  function statusOf(key) {
    var p = progressOf(key);
    if (!p) return "new";
    return p.box >= 4 ? "known" : "learning";
  }
  function isDue(key) { var p = progressOf(key); return !!p && p.box < 6 && p.due <= Date.now(); }
  function grade(key, ok) {
    var s = store(), p = s.words[key] || { box: 0, due: 0, seen: 0, right: 0 };
    p.seen++;
    if (ok) { p.right++; p.box = Math.min(p.box + 1, 5); } else { p.box = 1; }
    p.due = ok ? Date.now() + INTERVAL[p.box] * DAY : Date.now();
    p.at = Date.now();
    s.words[key] = p;
    APP.save();
  }
  function toggleSaved(key) {
    var s = store();
    if (s.saved[key]) delete s.saved[key]; else s.saved[key] = Date.now();
    APP.save();
  }

  // ---------- Ortak parçalar ----------
  function tabs(list, current, attr) {
    return '<div class="seg" role="tablist">' + list.map(function (t) {
      return '<button type="button" role="tab" class="seg-btn" aria-selected="' + (t[0] === current) + '" data-' + attr + '="' + t[0] + '">' + esc(t[1]) + "</button>";
    }).join("") + "</div>";
  }
  function examLink(id) {
    var q = APP.BY_ID[id];
    return q ? esc(q.set.title.replace(/ \(.*\)$/, "") + " · Soru " + q.n) : esc(id);
  }
  // Sınav cümlesinde [[kelime]] işaretini vurgulu hâle getirir
  function highlight(text) {
    return esc(text).replace(/\[\[(.+?)\]\]/g, '<mark class="hl">$1</mark>');
  }
  function solveIds(ids, title, origin) {
    var list = ids.map(function (id) { return APP.BY_ID[id]; }).filter(Boolean);
    if (list.length) APP.startSession(list, title, origin);
  }
  function bindSolve(root, origin) {
    root.querySelectorAll("[data-solve]").forEach(function (b) {
      b.onclick = function () { solveIds(b.getAttribute("data-solve").split(","), b.getAttribute("data-title") || "Çıkmış sorular", origin); };
    });
  }

  // =====================================================================
  // KELİME LABORATUVARI
  // =====================================================================
  var kui = { tab: "liste", q: "", pos: "", lvl: "", st: "", only: "", open: null, kal: "phrasal", study: null, limit: 150 };

  function viewWords() {
    var due = ITEMS.filter(function (it) { return isDue(it.key); }).length;
    var known = ITEMS.filter(function (it) { return statusOf(it.key) === "known"; }).length;
    var learning = ITEMS.filter(function (it) { return statusOf(it.key) === "learning"; }).length;
    var saved = Object.keys(store().saved).length;
    var html =
      "<h1>Kelime Laboratuvarı</h1><p class=\"lead\">13 çıkmış ÖSYM sınavında ve Akın Dil testlerinde şık olarak sorulan kelimeler, paragraflarda sık geçen akademik kelimeler ve kalıplar. Sınavda geçenlerin gerçek cümlesi ve sorusu yanında.</p>" +
      '<div class="grid">' + APP.stat(ITEMS.length, "Kelime ve phrasal verb") + APP.stat(due, "Bugün tekrar edilecek") + APP.stat(learning, "Öğreniliyor") + APP.stat(known, "Öğrenildi") + APP.stat(saved, "Defterimde") + "</div>" +
      tabs([["liste", "Kelimeler"], ["calis", "Çalış"], ["kaliplar", "Kalıplar"], ["yontem", "Nasıl çalışmalı?"]], kui.tab, "ktab") +
      '<div id="k-body"></div>';
    view.innerHTML = html;
    view.querySelectorAll("[data-ktab]").forEach(function (b) {
      b.onclick = function () { kui.tab = b.getAttribute("data-ktab"); kui.study = null; viewWords(); };
    });
    var body = document.getElementById("k-body");
    if (kui.tab === "liste") wordList(body);
    else if (kui.tab === "calis") (kui.study ? studyCard(body) : studyMenu(body, due, saved));
    else if (kui.tab === "kaliplar") patterns(body);
    else method(body);
  }

  // ---------- Liste ----------
  function filtered() {
    var q = kui.q.trim().toLowerCase(), s = store();
    return ITEMS.filter(function (it) {
      if (q && it.head.toLowerCase().indexOf(q) === -1 && (it.tr || "").toLowerCase().indexOf(q) === -1) return false;
      if (kui.pos && it.pos !== kui.pos) return false;
      if (kui.lvl && String(it.lvl) !== kui.lvl) return false;
      if (kui.st && statusOf(it.key) !== kui.st) return false;
      if (kui.only === "answer" && !it.refs.some(function (r) { return r.ans; })) return false;
      if (kui.only === "saved" && !s.saved[it.key]) return false;
      if (kui.only === "exam" && !it.refs.length) return false;
      return true;
    });
  }
  function sel(id, list, cur) {
    return '<select id="' + id + '">' + list.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === cur ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select>";
  }
  function wordList(body) {
    var list = filtered();
    list.sort(function (a, b) { return (b.freq - a.freq) || a.head.localeCompare(b.head); });
    body.innerHTML =
      '<div class="card"><div class="filters">' +
        '<label class="field">Ara<input id="k-q" type="search" placeholder="İngilizce ya da Türkçe" value="' + esc(kui.q) + '"></label>' +
        '<label class="field">Tür' + sel("k-pos", [["", "Hepsi"], ["v", "Fiil"], ["n", "İsim"], ["adj", "Sıfat"], ["adv", "Zarf"], ["pv", "Phrasal verb"]], kui.pos) + "</label>" +
        '<label class="field">Seviye' + sel("k-lvl", [["", "Hepsi"], ["1", "Temel"], ["2", "Orta"], ["3", "İleri"]], kui.lvl) + "</label>" +
        '<label class="field">Durum' + sel("k-st", [["", "Hepsi"], ["new", "Yeni"], ["learning", "Öğreniliyor"], ["known", "Öğrenildi"]], kui.st) + "</label>" +
        '<label class="field">Göster' + sel("k-only", [["", "Hepsi"], ["exam", "Sınavda şık olarak çıkanlar"], ["answer", "ÖSYM'de doğru cevap olanlar"], ["saved", "Kelime defterim"]], kui.only) + "</label>" +
      "</div><p class=\"muted\" style=\"margin:12px 0 0\">" + list.length + " kayıt · sınavlarda en sık geçenden en aza sıralı</p></div>" +
      '<div class="card" style="padding:6px 0">' + (list.length ? list.slice(0, kui.limit).map(wordRow).join("") : '<p class="muted" style="padding:14px 20px">Bu filtrelere uyan kelime yok.</p>') + "</div>" +
      (list.length > kui.limit ? '<p style="text-align:center"><button type="button" class="btn" id="k-more">Daha fazla göster (' + (list.length - kui.limit) + ' kayıt daha)</button></p>' : "");
    var more = document.getElementById("k-more");
    if (more) more.onclick = function () { var y = window.scrollY; kui.limit += 150; wordList(body); window.scrollTo(0, y); };
    var qi = document.getElementById("k-q");
    qi.oninput = function () { kui.q = qi.value; kui.limit = 150; var pos = qi.selectionStart; wordList(body); var n = document.getElementById("k-q"); n.focus(); n.setSelectionRange(pos, pos); };
    [["k-pos", "pos"], ["k-lvl", "lvl"], ["k-st", "st"], ["k-only", "only"]].forEach(function (p) {
      document.getElementById(p[0]).onchange = function (e) { kui[p[1]] = e.target.value; kui.limit = 150; wordList(body); };
    });
    body.querySelectorAll("[data-open]").forEach(function (b) {
      b.onclick = function () { var k = b.getAttribute("data-open"); kui.open = kui.open === k ? null : k; wordList(body); var el = document.getElementById("w-" + cssId(k)); if (el) el.scrollIntoView({ block: "nearest" }); };
    });
    body.querySelectorAll("[data-star]").forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); toggleSaved(b.getAttribute("data-star")); wordList(body); };
    });
    body.querySelectorAll("[data-grade]").forEach(function (b) {
      b.onclick = function () { var p = b.getAttribute("data-grade").split("|"); grade(p[1], p[0] === "1"); wordList(body); };
    });
    bindSolve(body, "kelime");
  }
  function cssId(k) { return k.replace(/[^a-z0-9]/gi, "_"); }
  function badge(st) {
    return { new: '<span class="pill">Yeni</span>', learning: '<span class="pill warn">Öğreniliyor</span>', known: '<span class="pill ok">Öğrenildi</span>' }[st];
  }
  function wordRow(it) {
    var open = kui.open === it.key, saved = !!store().saved[it.key];
    var isAns = it.refs.some(function (r) { return r.ans; });
    var head =
      '<div class="wrow' + (open ? " open" : "") + '" id="w-' + cssId(it.key) + '">' +
      '<button type="button" class="wrow-head" data-open="' + esc(it.key) + '" aria-expanded="' + open + '">' +
        '<span class="w-main"><b>' + esc(it.head) + '</b> <span class="muted">' + POS[it.pos] + "</span>" + (isAns ? ' <span class="pill accent" title="13 ÖSYM sınavından birinde doğru cevap">ÖSYM cevabı</span>' : "") + "</span>" +
        '<span class="w-tr">' + esc(it.tr) + "</span>" +
        '<span class="w-meta">' + (it.freq ? '<span class="freq" title="13 sınavın metinlerinde geçme sayısı">' + it.freq + "×</span>" : "") + badge(statusOf(it.key)) + "</span>" +
      "</button>" +
      '<button type="button" class="star" data-star="' + esc(it.key) + '" aria-pressed="' + saved + '" title="' + (saved ? "Defterden çıkar" : "Kelime defterime ekle") + '">' + (saved ? "★" : "☆") + "</button>";
    return head + (open ? wordDetail(it) : "") + "</div>";
  }
  function chips(arr) { return arr && arr.length ? arr.map(function (x) { return '<span class="chip-s">' + esc(x) + "</span>"; }).join(" ") : '<span class="muted">–</span>'; }
  function wordDetail(it) {
    var refs = it.refs || [];
    var osym = refs.filter(function (r) { return r.src === "ÖSYM"; });
    var ansIds = refs.filter(function (r) { return r.ans; }).map(function (r) { return r.id; });
    var allIds = refs.map(function (r) { return r.id; });
    return '<div class="wdetail">' +
      (it.def ? '<p class="def">' + esc(it.def) + "</p>" : "") +
      '<div class="ex"><div class="en">' + esc(it.ex) + '</div><div class="tr">' + esc(it.exTr || "") + "</div></div>" +
      (it.examEx ? '<h3>Sınavda nasıl geçti?</h3><div class="ex exam"><div class="en">' + highlight(it.examEx.text) + '</div><div class="src">' + examLink(it.examEx.id) + ' · <button type="button" class="linkbtn" data-solve="' + it.examEx.id + '" data-title="' + esc(it.head) + ' – sınav sorusu">Bu soruyu çöz</button></div></div>' : "") +
      '<div class="wgrid">' +
        "<div><h3>Eş anlamlılar</h3>" + chips(it.syn) + "</div>" +
        "<div><h3>Zıt anlamlılar</h3>" + chips(it.ant) + "</div>" +
        "<div><h3>Sık kullanılan kalıplar</h3>" + chips(it.col) + "</div>" +
        "<div><h3>Kelime ailesi</h3>" + (it.fam ? esc(it.fam) : '<span class="muted">–</span>') + "</div>" +
      "</div>" +
      '<div class="row" style="margin-top:14px">' +
        (allIds.length ? '<button type="button" class="btn" data-solve="' + allIds.join(",") + '" data-title="' + esc(it.head) + ' – şık olarak geçtiği sorular">Şık olarak geçtiği ' + allIds.length + " soruyu çöz</button>" : "") +
        '<span class="muted">' + (osym.length ? "ÖSYM'de " + osym.length + " soruda şık" + (ansIds.length ? ", " + refs.filter(function (r) { return r.ans && r.src === "ÖSYM"; }).length + " kez doğru cevap" : "") : "ÖSYM kelime sorularında şık olarak geçmedi") + (it.freq ? " · sınav metinlerinde " + it.freq + " kez" : "") + "</span>" +
      "</div>" +
      '<div class="row" style="margin-top:10px"><span class="muted">Bu kelimeyi biliyor musun?</span>' +
        '<button type="button" class="btn" data-grade="0|' + esc(it.key) + '">Henüz değil</button><button type="button" class="btn primary" data-grade="1|' + esc(it.key) + '">Biliyorum</button></div>' +
    "</div>";
  }

  // ---------- Çalışma ----------
  function pool(kind) {
    var s = store();
    if (kind === "due") return ITEMS.filter(function (it) { return isDue(it.key); });
    if (kind === "new") return ITEMS.filter(function (it) { return statusOf(it.key) === "new"; }).sort(function (a, b) { return b.freq - a.freq; }).slice(0, 10);
    if (kind === "saved") return ITEMS.filter(function (it) { return s.saved[it.key]; });
    if (kind === "answer") return APP.shuffle(ITEMS.filter(function (it) { return it.refs.some(function (r) { return r.ans && r.src === "ÖSYM"; }); })).slice(0, 15);
    if (kind === "pv") return APP.shuffle(ITEMS.filter(function (it) { return it.kind === "phrasal"; })).slice(0, 15);
    return APP.shuffle(ITEMS.slice()).slice(0, 15);
  }
  var POOLS = [["due", "Bugünün tekrarı"], ["new", "10 yeni kelime (en sık geçenler)"], ["answer", "ÖSYM'de doğru cevap olan 15 kelime"], ["pv", "15 phrasal verb"], ["saved", "Kelime defterim"], ["mix", "Karışık 15 kelime"]];
  var MODES = [["kart", "Kart", "Kelimeyi gör, anlamını hatırlamaya çalış, sonra kontrol et."], ["anlam", "Anlam testi", "Kelimenin Türkçe anlamını beş seçenek arasından bul."], ["bosluk", "Boşluk doldurma", "ÖSYM'nin 1–6. soruları gibi: cümledeki boşluğa uyan kelimeyi seç."]];
  function studyMenu(body, due, saved) {
    var counts = {};
    POOLS.forEach(function (p) { counts[p[0]] = p[0] === "due" ? due : p[0] === "saved" ? saved : pool(p[0]).length; });
    body.innerHTML =
      '<div class="card"><h2>1. Hangi kelimeler?</h2><div class="opts-grid">' + POOLS.map(function (p) {
        return '<label class="pick"><input type="radio" name="k-pool" value="' + p[0] + '"' + (p[0] === (due ? "due" : "new") ? " checked" : "") + (counts[p[0]] ? "" : " disabled") + "><span>" + esc(p[1]) + ' <span class="muted">(' + counts[p[0]] + ")</span></span></label>";
      }).join("") + "</div>" +
      '<h2 style="margin-top:20px">2. Nasıl çalışmak istersin?</h2><div class="opts-grid">' + MODES.map(function (m, i) {
        return '<label class="pick"><input type="radio" name="k-mode" value="' + m[0] + '"' + (i === 0 ? " checked" : "") + "><span><b>" + esc(m[1]) + '</b><br><span class="muted">' + esc(m[2]) + "</span></span></label>";
      }).join("") + "</div>" +
      '<div class="row" style="margin-top:18px"><button type="button" class="btn primary" id="k-start">Başla</button>' +
      (due ? "" : '<span class="muted">Bugün tekrarı bekleyen kelime yok. Yeni kelimelerle başla; bildiğin kelimeler 1, 3, 7, 14 ve 30 gün sonra yeniden karşına çıkar.</span>') + "</div></div>";
    document.getElementById("k-start").onclick = function () {
      var pk = (view.querySelector("input[name=k-pool]:checked") || {}).value, md = view.querySelector("input[name=k-mode]:checked").value;
      var list = pk ? pool(pk) : [];
      if (pk === "due" || pk === "saved") list = APP.shuffle(list).slice(0, 20);
      if (!list.length) return;
      kui.study = { mode: md, keys: list.map(function (it) { return it.key; }), i: 0, right: 0, answered: null, reveal: false, title: POOLS.filter(function (p) { return p[0] === pk; })[0][1] };
      viewWords();
    };
  }
  // Aynı türden 4 çeldirici seç (ÖSYM'deki gibi şıklar aynı türden olsun)
  function distractors(it, field) {
    var same = ITEMS.filter(function (x) { return x.key !== it.key && x.pos === it.pos && x[field] && x[field] !== it[field]; });
    if (same.length < 4) same = ITEMS.filter(function (x) { return x.key !== it.key && x[field]; });
    return APP.shuffle(same).slice(0, 4);
  }
  // Örnek cümlede kelimeyi bulup boşluğa çevirir (çekimli hâlleriyle)
  function blankOut(it) {
    var base = it.head.split(" / ")[0].toLowerCase(), words = base.split(" ");
    var stem = words[0].replace(/(e|y)$/, "");
    var rx = new RegExp("\\b" + stem + "[a-z]*" + (words.length > 1 ? "\\s+" + words.slice(1).join("\\s+") : "") + "\\b", "i");
    var irregular = { come: "came", draw: "drew", give: "gave", take: "took", run: "ran", bring: "brought", lead: "led", make: "made", go: "went", break: "broke", leave: "left", keep: "kept", stick: "stuck", deal: "dealt", show: "shown", get: "got" };
    var src = it.ex;
    if (!rx.test(src) && irregular[words[0]]) rx = new RegExp("\\b(" + irregular[words[0]] + "|" + words[0] + "[a-z]*)" + (words.length > 1 ? "\\s+" + words.slice(1).join("\\s+") : "") + "\\b", "i");
    if (!rx.test(src) && it.examEx) { src = it.examEx.text.replace(/\[\[(.+?)\]\]/, "$1"); rx = new RegExp("\\b" + stem + "[a-z]*\\b", "i"); }
    var m = src.match(rx);
    return m ? { text: src.replace(rx, "----"), used: m[0] } : null;
  }
  function studyCard(body) {
    var S = kui.study, n = S.keys.length;
    if (S.i >= n) {
      body.innerHTML = '<div class="card"><h2>Oturum bitti</h2><p>' + S.right + " / " + n + " doğru. Bildiğin kelimeler bir sonraki kutuya geçti; bilemediklerin yarın yeniden karşına çıkacak.</p>" +
        '<div class="row"><button type="button" class="btn primary" id="k-again">Yeni oturum</button><button type="button" class="btn" id="k-list">Kelime listesine dön</button></div></div>';
      document.getElementById("k-again").onclick = function () { kui.study = null; viewWords(); };
      document.getElementById("k-list").onclick = function () { kui.study = null; kui.tab = "liste"; viewWords(); };
      return;
    }
    var it = BY_KEY[S.keys[S.i]];
    var mode = S.mode;
    var blank = mode === "bosluk" ? blankOut(it) : null;
    if (mode === "bosluk" && !blank) mode = "anlam";        // Cümlede bulunamazsa anlam testine düş
    var top = '<div class="row between"><span class="muted">' + esc(S.title) + " · " + (S.i + 1) + " / " + n + '</span><button type="button" class="btn" id="k-stop">Bitir</button></div>' +
      '<div class="progress"><i style="width:' + APP.pct(S.i, n) + '%"></i></div>';
    var html;
    if (mode === "kart") {
      html = '<div class="card flash"><div class="flash-word">' + esc(it.head) + '</div><div class="muted">' + POS[it.pos] + "</div>" +
        (S.reveal ? '<div class="flash-back"><div class="flash-tr">' + esc(it.tr) + "</div>" + (it.def ? '<p class="def">' + esc(it.def) + "</p>" : "") +
          '<div class="ex"><div class="en">' + esc(it.ex) + '</div><div class="tr">' + esc(it.exTr || "") + "</div></div>" +
          (it.examEx ? '<div class="ex exam"><div class="en">' + highlight(it.examEx.text) + '</div><div class="src">' + examLink(it.examEx.id) + "</div></div>" : "") +
          '<div class="row center" style="margin-top:16px"><button type="button" class="btn" data-k="0">Bilmiyordum <kbd>1</kbd></button><button type="button" class="btn primary" data-k="1">Biliyordum <kbd>2</kbd></button></div></div>'
        : '<div class="row center" style="margin-top:20px"><button type="button" class="btn primary" id="k-reveal">Anlamını göster <kbd>Boşluk</kbd></button></div><p class="muted center" style="margin-top:12px">Önce anlamını kendin hatırlamaya çalış.</p>') + "</div>";
    } else {
      var field = mode === "anlam" ? "tr" : "head";
      var opts = APP.shuffle([it].concat(distractors(it, field)));
      var letters = "ABCDE";
      var stem = mode === "anlam" ? '<div class="flash-word">' + esc(it.head) + '</div><div class="muted" style="margin-bottom:14px">' + POS[it.pos] + " · Türkçe anlamı hangisi?</div>"
        : '<div class="stem">' + esc(blank.text) + '</div><p class="muted">Boşluğa uygun düşen kelimeyi bulun.</p>';
      html = '<div class="card">' + stem + '<div class="opts">' + opts.map(function (o, i) {
        var cls = "opt";
        if (S.answered !== null) { if (o.key === it.key) cls += " correct"; else if (o.key === S.answered) cls += " wrong"; }
        // Şıklar hep yalın hâlde: doğru cevap çekimli biçiminden ele verilmesin
        var label = mode === "anlam" ? o.tr : o.head;
        return '<button type="button" class="' + cls + '" data-opt="' + esc(o.key) + '"' + (S.answered !== null ? " disabled" : "") + '><span class="letter">' + letters[i] + "</span><span>" + esc(label) + "</span></button>";
      }).join("") + "</div>" +
      (S.answered !== null ? '<div class="verdict ' + (S.answered === it.key ? "ok" : "bad") + '">' + (S.answered === it.key ? "Doğru." : "Yanlış. Doğrusu: " + esc(it.head) + " – " + esc(it.tr)) + "</div>" +
        '<div class="ex"><div class="en">' + esc(it.ex) + '</div><div class="tr">' + esc(it.exTr || "") + "</div></div>" +
        '<div class="row" style="margin-top:14px"><button type="button" class="btn primary" id="k-next">Sonraki <kbd>Enter</kbd></button></div>' : "") + "</div>";
      S.opts = opts.map(function (o) { return o.key; });
    }
    body.innerHTML = top + html;
    document.getElementById("k-stop").onclick = function () { S.i = n; viewWords(); };
    var rv = document.getElementById("k-reveal");
    if (rv) rv.onclick = function () { S.reveal = true; viewWords(); };
    body.querySelectorAll("[data-k]").forEach(function (b) {
      b.onclick = function () { var ok = b.getAttribute("data-k") === "1"; grade(it.key, ok); if (ok) S.right++; S.i++; S.reveal = false; viewWords(); };
    });
    body.querySelectorAll("[data-opt]").forEach(function (b) {
      b.onclick = function () { answerOpt(b.getAttribute("data-opt")); };
    });
    var nx = document.getElementById("k-next");
    if (nx) nx.onclick = nextCard;
  }
  function answerOpt(key) {
    var S = kui.study; if (!S || S.answered !== null) return;
    var it = BY_KEY[S.keys[S.i]], ok = key === it.key;
    S.answered = key; grade(it.key, ok); if (ok) S.right++;
    viewWords();
  }
  function nextCard() { var S = kui.study; S.i++; S.answered = null; S.reveal = false; viewWords(); }
  // Klavye: kart modunda Boşluk/1/2, testlerde A–E ve Enter
  document.addEventListener("keydown", function (e) {
    if (location.hash !== "#/kelime" || kui.tab !== "calis" || !kui.study || e.ctrlKey || e.metaKey || e.altKey) return;
    var tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea") return;
    var S = kui.study;
    if (S.i >= S.keys.length) return;
    if (S.mode === "kart") {
      if (!S.reveal && (e.key === " " || e.key === "Enter")) { e.preventDefault(); S.reveal = true; viewWords(); }
      else if (S.reveal && (e.key === "1" || e.key === "2")) { e.preventDefault(); var b = view.querySelector('[data-k="' + (e.key === "2" ? 1 : 0) + '"]'); if (b) b.click(); }
    } else {
      var k = e.key.toUpperCase(), idx = "ABCDE".indexOf(k);
      if (S.answered === null && idx !== -1 && S.opts && S.opts[idx]) { e.preventDefault(); answerOpt(S.opts[idx]); }
      else if (S.answered !== null && e.key === "Enter" && tag !== "button") { e.preventDefault(); nextCard(); }
    }
  });

  // ---------- Kalıplar ----------
  function patterns(body) {
    var data = { phrasal: L.phrasal, edat: L.edat, akademik: L.akademik };
    var head = tabs([["phrasal", "Phrasal verb'ler (" + L.phrasal.length + ")"], ["edat", "Edatla kullanılan kalıplar (" + L.edat.length + ")"], ["akademik", "Akademik ifadeler (" + L.akademik.length + ")"]], kui.kal, "kal");
    var intro = {
      phrasal: "13 ÖSYM sınavının 6. sorusunda (phrasal verb) doğru cevap ve şık olarak geçen fiiller ile Akın Dil listelerinden seçilenler. Sayılar, kalıbın kelime sorularında şık olarak kaç kez çıktığını gösterir.",
      edat: "Edat soruları (10–11) ve cloze testlerde en çok sorulan isim/sıfat/fiil + edat birliktelikleri. Kelime gibi öbek hâlinde öğrenin.",
      akademik: "Paragraf, çeviri ve yakın anlam sorularında sık geçen akademik ifadeler. 'Akın Dil' etiketli olanlar ders notlarındaki listelerden alındı."
    }[kui.kal];
    var rows = data[kui.kal].map(function (p) {
      var refs = p.refs || [], ansN = refs.filter(function (r) { return r.ans && r.src === "ÖSYM"; }).length, osN = refs.filter(function (r) { return r.src === "ÖSYM"; }).length;
      return '<tr><td><b>' + esc(p.k) + "</b>" + (p.src ? ' <span class="pill">' + esc(p.src) + "</span>" : "") + (ansN ? ' <span class="pill accent">ÖSYM cevabı ×' + ansN + "</span>" : "") + "</td>" +
        "<td>" + esc(p.tr) + (p.syn ? '<div class="muted small">≈ ' + esc(p.syn) + "</div>" : "") + "</td>" +
        '<td><div class="en">' + esc(p.ex) + "</div>" + (p.exTr ? '<div class="tr small">' + esc(p.exTr) + "</div>" : "") + "</td>" +
        (kui.kal === "phrasal" ? "<td>" + (refs.length ? '<button type="button" class="linkbtn" data-solve="' + refs.map(function (r) { return r.id; }).join(",") + '" data-title="' + esc(p.k) + '">' + refs.length + " soru" + (osN ? " (ÖSYM " + osN + ")" : "") + "</button>" : '<span class="muted">–</span>') + "</td>" : "") + "</tr>";
    }).join("");
    body.innerHTML = head + '<div class="card"><p class="muted">' + esc(intro) + '</p><div class="table-wrap"><table class="list pat"><tr><th>Kalıp</th><th>Anlamı</th><th>Örnek</th>' + (kui.kal === "phrasal" ? "<th>Sorular</th>" : "") + "</tr>" + rows + "</table></div></div>";
    body.querySelectorAll("[data-kal]").forEach(function (b) { b.onclick = function () { kui.kal = b.getAttribute("data-kal"); patterns(body); }; });
    bindSolve(body, "kelime");
  }

  // ---------- Yöntem ----------
  function method(body) {
    body.innerHTML = '<div class="card"><h2>Kelime nasıl kalıcı öğrenilir?</h2>' +
      "<h3>1. Aralıklı tekrar</h3><p>Bir kelimeyi aynı gün on kez tekrar etmek yerine, onu tam unutmak üzereyken yeniden görmek çok daha kalıcıdır. Kas çalıştırmaya benzer: her gün aynı ağırlığı kaldırmak yerine dinlenme günleri koymak kası daha çok güçlendirir. Bu laboratuvar her kelimeyi bir kutuya koyar; bildikçe kelime 1, 3, 7, 14 ve 30 gün sonraya ertelenir, bilemezsen ertesi gün yeniden gelir.</p>" +
      "<h3>2. Önce hatırla, sonra kontrol et</h3><p>Kartta anlamı hemen açmayın. Birkaç saniye hatırlamaya çalışmak (doğru bulamasanız bile) kelimeyi beyninizde daha derine kazır. Bu yüzden her modda önce siz cevap veriyorsunuz.</p>" +
      "<h3>3. Kelimeyi cümle ve kalıp içinde öğren</h3><p>YDS kelimeyi tek başına değil cümle içinde sorar ve şıklar aynı türden gelir. Her kelimenin yanındaki gerçek sınav cümlesini okuyun ve kalıbıyla birlikte öğrenin: 'pose a threat to', 'be prone to', 'stem from'. Boşluk doldurma modu tam olarak 1–6. soruların formatını taklit eder.</p>" +
      "<h3>4. Küçük gruplarla çalış</h3><p>Günde 10 yeni kelime ve bekleyen tekrarlar yeterlidir. Büyük listeleri bir oturumda bitirmeye çalışmak yerine her gün kısa bir oturum daha verimlidir.</p>" +
      "<h3>Önerilen günlük rutin (15–20 dakika)</h3><ol><li>'Bugünün tekrarı'nı Kart modunda bitir.</li><li>'10 yeni kelime'yi önce listeden oku (örnek ve sınav cümlesiyle), sonra Boşluk doldurma modunda çöz.</li><li>Bilemediğin kelimeleri yıldızla deftere ekle.</li><li>Haftada bir 'Kalıplar' sekmesinden 10 phrasal verb ve 10 edat kalıbı oku.</li></ol>" +
      '<p class="muted small">Dayanak: ikinci dilde kelime öğrenimiyle ilgili araştırmalar, aralıklı tekrarın (spaced practice) toplu tekrara göre daha kalıcı öğrenme sağladığını ve en güçlü etkinin aralıklı tekrar kendini sınamayla (retrieval practice) birleşince görüldüğünü gösteriyor (ör. Kim ve Webb, 2022, Language Learning; Nakata, 2015, Studies in Second Language Acquisition).</p></div>';
  }

  // =====================================================================
  // GRAMER AKADEMİSİ
  // =====================================================================
  var gui = { open: null };
  var LESSONS = L.lessons;

  function lessonProgress(ls) {
    var done = 0, ok = 0;
    ls.refs.forEach(function (id) { var s = APP.statusOf(id); if (s !== "new") done++; if (s === "ok") ok++; });
    return { done: done, ok: ok };
  }
  function viewGrammar() {
    var ls = gui.open && LESSONS.filter(function (x) { return x.id === gui.open; })[0];
    if (ls) return viewLesson(ls);
    view.innerHTML = "<h1>Gramer Akademisi</h1><p class=\"lead\">YDS'de soruların gerçekten dayandığı yapılar. Her derste kural, örnek, sık yapılan hatalar ve o konudan çıkmış ÖSYM soruları var.</p>" +
      '<div class="card"><h2>Önce bunlar: sınavda en çok soru getiren konular</h2><p>13 çıkmış sınavın analizine göre en yüksek getiri <b>bağlaçlardadır</b>: 12–16. sorular, cloze testlerin yarısı ve cümle tamamlama sorularının neredeyse tamamı bağlaç bilgisine dayanır. Cümle tamamlamada bağlaçla kurulan cümlelerin yaklaşık yarısı zıtlık bildirir (although, while, but, even though, whereas). Ardından zamanlar (7), modallar (8), fiilimsiler (9) ve edatlar (10–11) gelir; bunların her biri her sınavda en az bir soru demektir.</p></div>' +
      '<div class="lessons">' + LESSONS.map(function (x, i) {
        var p = lessonProgress(x);
        return '<button type="button" class="lesson" data-lesson="' + x.id + '"><span class="lnum">' + (i + 1) + '</span><span class="lbody"><b>' + esc(x.title) + '</b><span class="muted small">' + esc(x.exam) + '</span><span class="small">' +
          (x.refs.length ? x.refs.length + " çıkmış soru" + (p.done ? " · " + p.ok + "/" + p.done + " doğru" : "") : "Sınavlarda dolaylı geçer") + (x.bank.length ? " · " + x.bank.length + " alıştırma" : "") + "</span></span></button>";
      }).join("") + "</div>";
    view.querySelectorAll("[data-lesson]").forEach(function (b) {
      b.onclick = function () { gui.open = b.getAttribute("data-lesson"); viewGrammar(); window.scrollTo(0, 0); };
    });
  }
  function table(t) {
    return '<div class="table-wrap"><table class="list gtable"><tr>' + t.head.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") + "</tr>" +
      t.rows.map(function (r) { return "<tr>" + r.map(function (c, i) { return "<td" + (i === 0 ? ' class="k"' : "") + ">" + esc(c) + "</td>"; }).join("") + "</tr>"; }).join("") + "</table></div>";
  }
  function examples(ex) {
    return '<div class="exlist">' + ex.map(function (e) { return '<div class="ex"><div class="en">' + esc(e[0]) + '</div><div class="tr">' + esc(e[1]) + "</div></div>"; }).join("") + "</div>";
  }
  function linkerTable() {
    var groups = {};
    // Ana gruba göre topla: "Zıtlık / koşul" → Zıtlık, "Sebep (olumlu)" → Sebep
    L.linkers.forEach(function (x) { var g = x.f.split(/\s*[\/(]/)[0].trim(); (groups[g] = groups[g] || []).push(x); });
    var max = Math.max.apply(null, L.linkers.map(function (x) { return x.count; }).concat([1]));
    return '<div class="card"><h2>Bağlaç başvuru tablosu</h2><p class="muted">Sağdaki çubuk, bağlacın 13 ÖSYM sınavında (12–16. sorular, cloze ve cümle tamamlama) kaç kez doğru cevap ya da cümlenin bağlacı olduğunu gösterir. Tıklayınca o soruları çözebilirsin.</p>' +
      Object.keys(groups).map(function (g) {
        return "<h3>" + esc(g) + '</h3><div class="table-wrap"><table class="list ltable"><tr><th>Bağlaç</th><th>Yapı</th><th>Anlam</th><th>Örnek</th><th>ÖSYM</th></tr>' +
          groups[g].map(function (x) {
            return '<tr><td class="k">' + esc(x.k) + (x.f.split(/\s*[\/(]/)[0].trim() !== x.f ? '<div class="muted small">' + esc(x.f) + "</div>" : "") + "</td><td>" + esc(x.y) + "</td><td>" + esc(x.tr) + '</td><td class="en">' + esc(x.ex) + "</td><td>" +
              (x.count ? '<button type="button" class="cnt" data-solve="' + x.refs.join(",") + '" data-title="' + esc(x.k) + '" title="Bu soruları çöz"><span class="cbar"><i style="width:' + Math.round(x.count / max * 100) + '%"></i></span>' + x.count + "</button>" : '<span class="muted">0</span>') + "</td></tr>";
          }).join("") + "</table></div>";
      }).join("") + "</div>";
  }
  function edatTable() {
    return '<div class="card"><h2>Edat kalıpları listesi</h2><div class="table-wrap"><table class="list pat"><tr><th>Kalıp</th><th>Anlamı</th><th>Örnek</th></tr>' +
      L.edat.map(function (p) { return '<tr><td class="k">' + esc(p.k) + "</td><td>" + esc(p.tr) + '</td><td class="en">' + esc(p.ex) + "</td></tr>"; }).join("") + "</table></div></div>";
  }
  function viewLesson(ls) {
    var idx = LESSONS.indexOf(ls), prev = LESSONS[idx - 1], next = LESSONS[idx + 1];
    var p = lessonProgress(ls);
    var quiz = APP.shuffle(ls.refs.slice()).slice(0, 5);
    var sample = ls.refs.slice(-3).map(function (id) {
      var q = APP.BY_ID[id]; if (!q) return "";
      var stem = q.stem || (q.passage ? "Cloze: parçadaki " + q.n + " numaralı boşluk" : "");
      return '<li><span class="muted small">' + examLink(id) + "</span><br>" + esc(stem.length > 220 ? stem.slice(0, 220) + "…" : stem) + ' <button type="button" class="linkbtn" data-solve="' + id + '" data-title="' + esc(ls.title) + '">Çöz</button></li>';
    }).join("");
    view.innerHTML =
      '<div class="row between"><button type="button" class="btn" id="g-back">← Dersler</button><span class="muted small">Ders ' + (idx + 1) + " / " + LESSONS.length + "</span></div>" +
      '<h1 style="margin-top:14px">' + esc(ls.title) + '</h1><p class="lead">' + esc(ls.exam) + "</p>" +
      '<div class="card intro"><p>' + esc(ls.intro) + "</p></div>" +
      ls.sections.map(function (s) {
        return '<div class="card"><h2>' + esc(s.h) + "</h2>" + (s.p ? "<p>" + esc(s.p) + "</p>" : "") + (s.table ? table(s.table) : "") + (s.ex ? examples(s.ex) : "") + "</div>";
      }).join("") +
      (ls.id === "baglac" ? linkerTable() : "") + (ls.id === "edat" ? edatTable() : "") +
      '<div class="card two"><div><h2>Sık yapılan hatalar</h2><ul class="bad">' + ls.mistakes.map(function (m) { return "<li>" + esc(m) + "</li>"; }).join("") + "</ul></div>" +
        '<div><h2>Sınav ipuçları</h2><ul class="good">' + ls.tips.map(function (m) { return "<li>" + esc(m) + "</li>"; }).join("") + "</ul></div></div>" +
      '<div class="card"><h2>Çıkmış sorularla pekiştir</h2>' +
        (ls.refs.length ? "<p>Bu konuyla eşleşen <b>" + ls.refs.length + "</b> ÖSYM sorusu bulundu" + (p.done ? "; " + p.done + " tanesini çözdün, " + p.ok + " doğru." : ".") + "</p>" + (sample ? '<ul class="samples">' + sample + "</ul>" : "") : "<p class=\"muted\">Bu konu 13 sınavda doğrudan bir boşluk sorusu olarak çıkmadı; paragraf, çeviri ve yakın anlam sorularında dolaylı olarak karşına çıkar.</p>") +
        '<div class="row" style="margin-top:14px">' +
          (quiz.length ? '<button type="button" class="btn primary" data-solve="' + quiz.join(",") + '" data-title="' + esc(ls.title) + ' – ders sonu testi">Ders sonu testi (' + quiz.length + " soru)</button>" : "") +
          (ls.refs.length > 5 ? '<button type="button" class="btn" data-solve="' + ls.refs.join(",") + '" data-title="' + esc(ls.title) + ' – tüm çıkmış sorular">Tüm çıkmış sorular (' + ls.refs.length + ")</button>" : "") +
          (ls.bank.length ? '<button type="button" class="btn" data-solve="' + ls.bank.join(",") + '" data-title="' + esc(ls.title) + ' – Akın Dil alıştırmaları">Akın Dil alıştırmaları (' + ls.bank.length + ")</button>" : "") +
        "</div></div>" +
      '<div class="row between">' + (prev ? '<button type="button" class="btn" data-lesson="' + prev.id + '">← ' + esc(prev.title) + "</button>" : "<span></span>") +
        (next ? '<button type="button" class="btn primary" data-lesson="' + next.id + '">' + esc(next.title) + " →</button>" : "") + "</div>";
    document.getElementById("g-back").onclick = function () { gui.open = null; viewGrammar(); window.scrollTo(0, 0); };
    view.querySelectorAll("[data-lesson]").forEach(function (b) { b.onclick = function () { gui.open = b.getAttribute("data-lesson"); viewGrammar(); window.scrollTo(0, 0); }; });
    bindSolve(view, "gramer");
  }

  // Menüden bölüme tıklanınca: Gramer'de ders listesine, Kelime'de açık kartı kapatarak başa dön
  document.querySelectorAll('#nav a[data-route="gramer"]').forEach(function (a) {
    a.addEventListener("click", function () { gui.open = null; if (location.hash === "#/gramer") viewGrammar(); });
  });
  document.querySelectorAll('#nav a[data-route="kelime"]').forEach(function (a) {
    a.addEventListener("click", function () { kui.open = null; if (!kui.study && location.hash === "#/kelime") viewWords(); });
  });
  APP.register("kelime", viewWords);
  APP.register("gramer", viewGrammar);
})();
