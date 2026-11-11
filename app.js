// js/app.js : Uygulamanın beyni. Soruları gösterir, cevapları kaydeder, istatistikleri hesaplar.
(function () {
  "use strict";

  // ---------- 1. Veriyi hazırla ----------
  // data/ klasöründeki her dosya window.YDS_SETS listesine bir test ekler.
  var SETS = window.YDS_SETS || [];
  var LETTERS = ["A", "B", "C", "D", "E"];
  var LEVELS = { 1: "Kolay", 2: "Orta", 3: "Zor" };
  var QUESTIONS = [];
  var BY_ID = {};
  SETS.forEach(function (set) {
    // Kaynak grubu: dosyada yazmıyorsa kimliğinden çıkar.
    if (!set.group) set.group = set.id.indexOf("ozgun-") === 0 ? "Özgün sorular" : "Akın Dil ders materyali";
    set.questions.forEach(function (q) {
      var item = Object.assign({}, q, { id: set.id + "-" + (q.n < 10 ? "0" + q.n : q.n), set: set });
      QUESTIONS.push(item);
      BY_ID[item.id] = item;
    });
  });
  // data/aciklamalar.js içindeki sonradan yazılmış açıklamalar, soru kimliğiyle eşleşip soruya eklenir.
  var EXPLAIN = window.YDS_EXPLAIN || {};
  Object.keys(EXPLAIN).forEach(function (id) { if (BY_ID[id]) Object.assign(BY_ID[id], EXPLAIN[id]); });

  // ---------- 2. Kayıt (tarayıcı hafızası) ----------
  // localStorage, tarayıcının içindeki küçük bir not defteri gibidir.
  var KEY = "ydsmaster.v1";
  var storageOk = true;
  var state = load();

  function load() {
    try {
      var raw = window.localStorage.getItem(KEY);
      var data = raw ? JSON.parse(raw) : null;
      if (data && typeof data.attempts === "object") {
        if (!data.mock) data.mock = { active: null, history: [] };
        return data;
      }
    } catch (e) { storageOk = false; }
    return { attempts: {}, mock: { active: null, history: [] } };
  }
  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { storageOk = false; }
  }
  // Bir sorunun bütün denemeleri: [{c: "B", ok: true, ms: 41000, at: 1731260000000}, ...]
  function attemptsOf(id) { return state.attempts[id] || []; }
  function lastOf(id) { var a = attemptsOf(id); return a.length ? a[a.length - 1] : null; }
  function statusOf(id) { var l = lastOf(id); return !l ? "new" : (l.ok ? "ok" : "wrong"); }
  function record(id, choice, ok, ms) {
    if (!state.attempts[id]) state.attempts[id] = [];
    state.attempts[id].push({ c: choice, ok: ok, ms: ms, at: Date.now() });
    save();
  }

  // ---------- 3. Küçük yardımcılar ----------
  var view = document.getElementById("view");
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function pct(a, b) { return b ? Math.round((a / b) * 100) : 0; }
  function uniq(arr) { return arr.filter(function (v, i) { return arr.indexOf(v) === i; }); }
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function fmtTime(ms) {
    if (!ms) return "–";
    var s = Math.round(ms / 1000);
    return s < 60 ? s + " sn" : Math.floor(s / 60) + " dk " + (s % 60) + " sn";
  }
  function mistakes() { return QUESTIONS.filter(function (q) { return statusOf(q.id) === "wrong"; }); }

  // Aralıklı tekrar (spaced repetition): bir soruyu en az bir kez yanlış çözdüysen takibe girer.
  // Art arda doğru sayısına göre 0, 1, 3 ve 7 gün sonra yeniden sorulur; 4 doğrudan sonra "kalıcı" sayılır.
  var DAY = 86400000, INTERVALS = [0, 1, 3, 7];
  function reviewOf(id) {
    var a = attemptsOf(id);
    if (!a.some(function (x) { return !x.ok; })) return null;        // Hiç yanlış yapılmadıysa takip yok
    var streak = 0;
    for (var i = a.length - 1; i >= 0 && a[i].ok; i--) streak++;
    if (streak >= INTERVALS.length) return { mastered: true, streak: streak };
    return { mastered: false, streak: streak, dueAt: a[a.length - 1].at + INTERVALS[streak] * DAY };
  }
  function reviewGroups() {
    var g = { due: [], later: [], mastered: [] }, now = Date.now();
    QUESTIONS.forEach(function (q) {
      var r = reviewOf(q.id);
      if (!r) return;
      if (r.mastered) g.mastered.push(q); else if (r.dueAt <= now) g.due.push(q); else g.later.push(q);
    });
    return g;
  }
  var GUIDE = window.YDS_GUIDE || { types: [], methods: [], formatNote: "" };
  function guideOf(type) { return GUIDE.types.filter(function (t) { return t.type === type; })[0]; }

  // Genel özet: paneldeki ve istatistikteki sayılar buradan gelir.
  function summary(list) {
    var solved = 0, correct = 0, totalMs = 0, timed = 0;
    list.forEach(function (q) {
      var l = lastOf(q.id);
      if (!l) return;
      solved++;
      if (l.ok) correct++;
      attemptsOf(q.id).forEach(function (a) { if (a.ms) { totalMs += a.ms; timed++; } });
    });
    return { total: list.length, solved: solved, correct: correct, acc: pct(correct, solved), avgMs: timed ? totalMs / timed : 0 };
  }
  function byType() {
    return uniq(QUESTIONS.map(function (q) { return q.type; })).map(function (t) {
      var s = summary(QUESTIONS.filter(function (q) { return q.type === t; }));
      s.type = t;
      return s;
    });
  }

  // ---------- 4. Sayfa yönlendirme ----------
  // Adres çubuğundaki "#/sorular" gibi kısım hangi sayfanın gösterileceğini belirler.
  var session = null;   // O an çözülen soru listesi
  var lastRoute = null;
  var filters = { group: "", set: "", types: [], topic: "", level: "", status: "", exp: "", order: "sirali", limit: "0" };

  var ROUTES = { panel: viewPanel, sorular: viewBank, deneme: viewMock, coz: viewSolve, hatalar: viewMistakes, istatistik: viewStats, rehber: viewGuide, yedek: viewBackup };

  function route() {
    clearInterval(timerHandle);   // Sınav sayacı yalnızca sınav ekranında çalışır
    var name = (location.hash || "#/panel").replace("#/", "");
    if (!ROUTES[name]) name = "panel";
    // Menüden Deneme Sınavı'na gelince liste açılır; sınav bitince ya da incelemeden dönünce sonuç ekranı kalır.
    if (name === "deneme" && lastRoute !== "deneme" && lastRoute !== "coz" && !mockUI.keep) mockUI.view = "list";
    mockUI.keep = false;
    lastRoute = name;
    if (name === "coz" && !session) name = "sorular";
    document.querySelectorAll("#nav a").forEach(function (a) {
      var on = a.getAttribute("data-route") === (name === "coz" ? session.origin : name);
      a.classList.toggle("active", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    var n = mistakes().length;
    var badge = document.getElementById("nav-badge");
    badge.hidden = n === 0;
    badge.textContent = n;
    ROUTES[name]();
    window.scrollTo(0, 0);
  }
  function go(name) {
    if (location.hash === "#/" + name) route(); else location.hash = "#/" + name;
  }
  function storageNotice() {
    return storageOk ? "" : '<div class="notice warn">Tarayıcı kayıt yapılmasına izin vermiyor. Bu oturumdaki ilerlemen sayfa kapanınca silinecek.</div>';
  }

  // ---------- 5. Panel ----------
  function viewPanel() {
    var s = summary(QUESTIONS);
    var wrong = mistakes().length;
    var types = byType().filter(function (t) { return t.solved >= 3; }).sort(function (a, b) { return a.acc - b.acc; });
    var unsolved = QUESTIONS.length - s.solved;
    var due = reviewGroups().due;

    var next;
    var mk = mockState();
    if (mk.active && setById(mk.active.setId)) next = '<p>Yarım kalmış bir deneme sınavın var: <b>' + esc(setById(mk.active.setId).title) + "</b>. " +
      (mk.active.durationMs ? "Süre işlemeye devam ediyor." : "") + '</p><button class="btn primary" data-act="mock">Sınava dön</button>';
    else if (!QUESTIONS.length) next = "<p>Henüz soru yüklenmemiş.</p>";
    else if (due.length) next = '<p>Bugün tekrar etmen gereken <b>' + due.length + '</b> soru var. Yeni soruya geçmeden önce bunları çözmek, öğrendiklerinin kalıcı olmasını sağlar.</p><button class="btn primary" data-act="due">Bugünün tekrarını başlat</button>';
    else if (unsolved) next = '<p>Çözmediğin <b>' + unsolved + '</b> soru var.</p><button class="btn primary" data-act="unsolved">Çözülmemiş sorulara devam et</button>';
    else if (wrong) next = '<p>Bütün soruları çözdün. Geriye <b>' + wrong + '</b> hata kaldı.</p><button class="btn primary" data-act="mistakes">Hataları tekrar çöz</button>';
    else next = "<p>Yüklü bütün soruları doğru çözdün. Yeni test eklenince burada görünecek.</p>";

    var weak = types.length
      ? types.slice(0, 3).map(function (t) { return barRow(t.type, t.acc, "%" + t.acc + " (" + t.correct + "/" + t.solved + ")"); }).join("")
      : '<p class="muted">Bir soru türünde en az 3 soru çözünce burada en zayıf alanların görünür.</p>';

    view.innerHTML =
      "<h1>Panel</h1><p class=\"lead\">Şu anki durumun ve sıradaki adım.</p>" + storageNotice() +
      '<div class="grid">' +
        stat(s.solved + " / " + s.total, "Çözülen soru") +
        stat(s.solved ? "%" + s.acc : "–", "Doğruluk (son denemeler)") +
        stat(due.length, "Bugünün tekrarı") +
        stat(fmtTime(s.avgMs), "Soru başına ortalama süre") +
      "</div>" +
      '<div class="card"><h2>Sıradaki adım</h2>' + next + "</div>" +
      '<div class="card"><h2>Deneme sınavları</h2>' + (mk.history.length
        ? (function (h) { return "<p>Son deneme: <b>" + esc(setById(h.setId) ? setById(h.setId).title : h.setId) + "</b> · " + fmtScore(h.score) + " puan · " + fmtDate(h.at) + "</p>"; })(mk.history[mk.history.length - 1])
        : "<p>" + EXAM_SETS.length + " ÖSYM sınavı gerçek sınav koşullarında çözülmeye hazır.</p>") +
        '<button class="btn" data-act="mocklist">Deneme Sınavı sayfasına git</button></div>' +
      '<div class="card"><h2>En zayıf alanların</h2>' + weak + "</div>" +
      '<div class="card"><h2>Yüklü testler</h2><table class="list"><tr><th>Test</th><th>Kaynak</th><th>Soru</th><th>Çözülen</th><th>Açıklama</th></tr>' +
        SETS.map(function (set) {
          var ss = summary(QUESTIONS.filter(function (q) { return q.set === set; }));
          var hasExp = QUESTIONS.some(function (q) { return q.set === set && q.why; });
          return "<tr><td>" + esc(set.title) + "</td><td>" + esc(set.group) + "</td><td>" + ss.total + "</td><td>" + ss.solved + "</td><td>" + (hasExp ? "Yazıldı" : "Bekliyor") + "</td></tr>";
        }).join("") + "</table></div>";

    view.querySelectorAll("[data-act]").forEach(function (b) {
      b.onclick = function () {
        var act = b.getAttribute("data-act");
        if (act === "mock" || act === "mocklist") { if (act === "mocklist") mockUI.view = "list"; go("deneme"); return; }
        if (b.getAttribute("data-act") === "due") startSession(due, "Bugünün tekrarı", "hatalar");
        else if (b.getAttribute("data-act") === "mistakes") startSession(mistakes(), "Hataları tekrar çöz", "hatalar");
        else startSession(QUESTIONS.filter(function (q) { return statusOf(q.id) === "new"; }), "Çözülmemiş sorular", "sorular");
      };
    });
  }
  function stat(num, lbl) { return '<div class="stat"><div class="num">' + esc(num) + '</div><div class="lbl">' + esc(lbl) + "</div></div>"; }
  function barRow(label, percent, val) {
    return '<div class="bar-row"><span>' + esc(label) + '</span><div class="bar"><i style="width:' + percent + '%"></i></div><span class="val">' + esc(val) + "</span></div>";
  }

  // ---------- 6. Soru Bankası (filtreler) ----------
  function applyFilters() {
    return QUESTIONS.filter(function (q) {
      if (filters.group && q.set.group !== filters.group) return false;
      if (filters.set && q.set.id !== filters.set) return false;
      if (filters.types.length && filters.types.indexOf(q.type) === -1) return false;
      if (filters.topic && q.topic !== filters.topic) return false;
      if (filters.level && String(q.lvl) !== filters.level) return false;
      if (filters.status && statusOf(q.id) !== filters.status) return false;
      if (filters.exp && (filters.exp === "var") !== Boolean(q.why)) return false;
      return true;
    });
  }
  function viewBank() {
    var types = uniq(QUESTIONS.map(function (q) { return q.type; }));
    // Konu listesi seçili soru türlerine göre daralır.
    var pool = QUESTIONS.filter(function (q) { return !filters.types.length || filters.types.indexOf(q.type) !== -1; });
    var topics = uniq(pool.map(function (q) { return q.topic; })).sort(function (a, b) { return a.localeCompare(b, "tr"); });
    if (filters.topic && topics.indexOf(filters.topic) === -1) filters.topic = "";
    var groups = uniq(SETS.map(function (x) { return x.group; }));
    // Test listesi seçili kaynağa göre daralır.
    var setList = SETS.filter(function (x) { return !filters.group || x.group === filters.group; });
    if (filters.set && !setList.some(function (x) { return x.id === filters.set; })) filters.set = "";
    var found = applyFilters();
    var count = filters.limit !== "0" ? Math.min(found.length, Number(filters.limit)) : found.length;

    function options(list, current) {
      return list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === current ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("");
    }

    view.innerHTML =
      "<h1>Soru Bankası</h1><p class=\"lead\">Çalışmak istediğin soruları seç ve başla.</p>" + storageNotice() +
      '<div class="card">' +
        '<div class="field muted" style="font-size:.85rem">Soru türü</div>' +
        '<div class="chips" id="f-types">' + types.map(function (t) {
          return '<button type="button" class="chip" aria-pressed="' + (filters.types.indexOf(t) !== -1) + '" data-type="' + esc(t) + '">' + esc(t) + "</button>";
        }).join("") + "</div>" +
        '<div class="filters" style="margin-top:16px">' +
          '<label class="field">Kaynak<select id="f-group">' + options([["", "Tüm kaynaklar"]].concat(groups.map(function (g) { return [g, g]; })), filters.group) + "</select></label>" +
          '<label class="field">Test<select id="f-set">' + options([["", "Tüm testler"]].concat(setList.map(function (s) { return [s.id, s.title]; })), filters.set) + "</select></label>" +
          '<label class="field">Konu<select id="f-topic">' + options([["", "Tüm konular"]].concat(topics.map(function (t) { return [t, t]; })), filters.topic) + "</select></label>" +
          '<label class="field">Zorluk (tahmini)<select id="f-level">' + options([["", "Hepsi"], ["1", "Kolay"], ["2", "Orta"], ["3", "Zor"]], filters.level) + "</select></label>" +
          '<label class="field">Durum<select id="f-status">' + options([["", "Hepsi"], ["new", "Çözülmemiş"], ["ok", "Doğru çözülmüş"], ["wrong", "Yanlış çözülmüş"]], filters.status) + "</select></label>" +
          '<label class="field">Açıklama<select id="f-exp">' + options([["", "Hepsi"], ["var", "Açıklaması yazılmış"], ["yok", "Açıklaması yazılmamış"]], filters.exp) + "</select></label>" +
          '<label class="field">Sıra<select id="f-order">' + options([["sirali", "Test sırasıyla"], ["karisik", "Karışık"]], filters.order) + "</select></label>" +
          '<label class="field">Soru sayısı<select id="f-limit">' + options([["0", "Hepsi"], ["10", "10 soru"], ["20", "20 soru"]], filters.limit) + "</select></label>" +
        "</div>" +
        '<div class="row between" style="margin-top:18px">' +
          '<span><b>' + found.length + "</b> soru bulundu" + (count !== found.length ? ", " + count + " tanesi sorulacak" : "") + "</span>" +
          '<span class="row"><button type="button" class="btn" id="f-clear">Filtreleri temizle</button>' +
          '<button type="button" class="btn primary" id="f-start"' + (found.length ? "" : " disabled") + ">Başla</button></span>" +
        "</div>" +
      "</div>" +
      '<p class="muted">İpucu: Cloze sorularını test sırasıyla çözersen aynı parçanın boşlukları arka arkaya gelir.</p>';

    view.querySelectorAll("#f-types .chip").forEach(function (c) {
      c.onclick = function () {
        var t = c.getAttribute("data-type"), i = filters.types.indexOf(t);
        if (i === -1) filters.types.push(t); else filters.types.splice(i, 1);
        viewBank();
      };
    });
    [["f-group", "group"], ["f-set", "set"], ["f-topic", "topic"], ["f-level", "level"], ["f-status", "status"], ["f-exp", "exp"], ["f-order", "order"], ["f-limit", "limit"]].forEach(function (p) {
      document.getElementById(p[0]).onchange = function (e) { filters[p[1]] = e.target.value; viewBank(); };
    });
    document.getElementById("f-clear").onclick = function () {
      filters = { group: "", set: "", types: [], topic: "", level: "", status: "", exp: "", order: "sirali", limit: "0" };
      viewBank();
    };
    document.getElementById("f-start").onclick = function () {
      var list = filters.order === "karisik" ? shuffle(found) : found;
      if (filters.limit !== "0") list = list.slice(0, Number(filters.limit));
      startSession(list, "Soru Bankası", "sorular");
    };
  }

  // ---------- 7. Soru çözme ekranı ----------
  function startSession(list, title, origin) {
    if (!list.length) return;
    session = { ids: list.map(function (q) { return q.id; }), idx: 0, given: {}, title: title, origin: origin, shownAt: Date.now(), done: false };
    go("coz");
  }
  function viewSolve() {
    if (session.done) {
      if (session.review) { session = null; go("deneme"); return; }   // İncelemeden sınav sonucuna dön
      return viewSessionEnd();
    }
    var q = BY_ID[session.ids[session.idx]];
    var given = session.given[q.id];           // Bu oturumda verilen cevap (yoksa undefined)
    var answered = session.review || given !== undefined;
    var total = session.ids.length;
    if (!answered) session.shownAt = Date.now();


    var opts = q.opts.map(function (o, i) {
      var L = LETTERS[i], cls = "opt";
      if (answered && L === q.ans) cls += " correct";
      else if (answered && given && L === given) cls += " wrong";
      return '<button type="button" class="' + cls + '" data-letter="' + L + '"' + (answered ? " disabled" : "") + '><span class="letter">' + L + "</span><span>" + esc(o) + "</span></button>";
    }).join("");

    view.innerHTML =
      '<div class="row between"><h1>' + esc(session.title) + '</h1><button type="button" class="btn" id="s-quit">' + (session.review ? "Sonuçlara dön" : "Bitir") + "</button></div>" +
      '<div class="muted">Soru ' + (session.idx + 1) + " / " + total + "</div>" +
      '<div class="progress"><i style="width:' + pct(session.review ? session.idx + 1 : Object.keys(session.given).length, total) + '%"></i></div>' +
      '<div class="card">' +
        '<div class="tags"><span class="tag">' + esc(q.set.title) + " · Soru " + q.n + '</span><span class="tag">' + esc(q.type) + '</span><span class="tag">' + esc(q.topic) + "</span>" + (q.lvl ? '<span class="tag">' + LEVELS[q.lvl] + "</span>" : "") + "</div>" +
        questionBody(q) +
        '<div class="opts">' + opts + "</div>" +
        guideBox(q.type) +
        (answered ? explanation(q, given) : '<p class="muted" style="margin-top:14px">Klavye: <kbd>A</kbd>–<kbd>E</kbd> ile cevapla.</p>') +
        '<div class="source">Kaynak: ' + esc(q.set.source) + " · " + esc(q.set.license) + "</div>" +
      "</div>" +
      '<div class="row between">' +
        '<button type="button" class="btn" id="s-prev"' + (session.idx === 0 ? " disabled" : "") + ">← Önceki</button>" +
        '<button type="button" class="btn primary" id="s-next">' + (session.idx === total - 1 ? (session.review ? "Sonuçlara dön" : "Sonuçları gör") : "Sonraki →") + "</button>" +
      "</div>";

    view.querySelectorAll(".opt").forEach(function (b) {
      b.onclick = function () { answer(b.getAttribute("data-letter")); };
    });
    document.getElementById("s-prev").onclick = prev;
    document.getElementById("s-next").onclick = next;
    document.getElementById("s-quit").onclick = function () { session.done = true; viewSolve(); };
  }
  // Parça (varsa) ve soru kökü: soru ekranı ile sınav ekranı aynı görünümü kullanır.
  function questionBody(q) {
    var passage = "";
    if (q.passage) {
      // Cloze sorusunda parçadaki ilgili boşluğu sarıyla işaretle: "(17) ----"
      var text = esc(q.set.passages[q.passage]).replace("(" + q.n + ") ----", "<mark>(" + q.n + ") ----</mark>");
      passage = '<div class="passage">' + text + "</div>";
    }
    var stem = q.stem ? esc(q.stem) : "Parçadaki <b>" + q.n + "</b> numaralı boşluğa uygun düşen seçeneği bulunuz.";
    return passage + '<div class="stem">' + stem + "</div>";
  }
  // Soru türüne özel çözüm adımları; tıklayınca açılan küçük bir kutu.
  function guideBox(type) {
    var g = guideOf(type);
    if (!g) return "";
    return '<details class="guide"><summary>Bu soru türü nasıl çözülür?</summary><ol>' +
      g.steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol><p><b>Sık düşülen tuzaklar:</b> " +
      g.traps.map(esc).join(" ") + "</p></details>";
  }
  function answer(letter) {
    if (session.review) return;   // İnceleme ekranında cevap değiştirilemez
    var q = BY_ID[session.ids[session.idx]];
    if (session.given[q.id] !== undefined) return;
    var ms = Math.min(Date.now() - session.shownAt, 10 * 60 * 1000);   // En fazla 10 dk say (masadan kalkma payı)
    session.given[q.id] = letter;
    record(q.id, letter, letter === q.ans, ms);
    route();
  }
  function next() {
    if (session.idx < session.ids.length - 1) { session.idx++; route(); }
    else { session.done = true; route(); }
  }
  function prev() { if (session.idx > 0) { session.idx--; route(); } }

  function explanation(q, given) {
    var ok = given === q.ans;
    var verdict = '<div class="verdict ' + (ok ? "ok" : "bad") + '">' + (ok ? "Doğru." : (given ? "Yanlış." : "Boş bıraktın.") + " Doğru cevap: " + q.ans) + "</div>";
    var flag = q.flag ? '<div class="notice warn" style="margin-top:12px"><b>Dikkat:</b> ' + esc(q.flag) + "</div>" : "";
    // Açıklaması henüz yazılmamış sorularda yalnızca sonucu gösteriyoruz.
    if (!q.why) {
      return verdict + '<div class="exp">' + flag +
        '<p class="muted" style="margin-top:12px">Bu sorunun Türkçe açıklaması henüz yazılmadı. Doğru cevap kaynaktaki cevap anahtarından alınmıştır.</p></div>';
    }
    var wrong =LETTERS.filter(function (L) { return q.wrong && q.wrong[L]; }).map(function (L) {
      return "<li><b>" + L + ")</b> " + esc(q.wrong[L]) + "</li>";
    }).join("");
    return (
      verdict +
      '<div class="exp">' + flag +
        "<h3>Neden " + q.ans + "?</h3><p>" + esc(q.why) + "</p>" +
        "<h3>Kural</h3><p>" + esc(q.rule) + "</p>" +
        '<h3>Türkçesi</h3><p class="tr">' + esc(q.tr) + "</p>" +
        "<h3>Diğer şıklar neden yanlış?</h3><ul>" + wrong + "</ul>" +
        "<h3>Önemli kelimeler</h3><ul>" + (q.vocab || []).map(function (v) { return "<li>" + esc(v) + "</li>"; }).join("") + "</ul>" +
        "<h3>Sınav ipucu</h3><p>" + esc(q.tip) + "</p>" +
      "</div>"
    );
  }

  // Kelime ve gramer sayfalarından başlatılan oturumlar geldikleri yere dönebilsin
  var BACK = { kelime: "Kelime Laboratuvarına dön", gramer: "Derse dön" };
  function viewSessionEnd() {
    var ids = Object.keys(session.given);
    var correct = ids.filter(function (id) { return session.given[id] === BY_ID[id].ans; }).length;
    var wrongIds = ids.filter(function (id) { return session.given[id] !== BY_ID[id].ans; });
    view.innerHTML =
      "<h1>Oturum bitti</h1><p class=\"lead\">" + esc(session.title) + "</p>" +
      '<div class="grid">' + stat(ids.length + " / " + session.ids.length, "Cevaplanan") + stat(correct, "Doğru") + stat(wrongIds.length, "Yanlış") + stat(ids.length ? "%" + pct(correct, ids.length) : "–", "Doğruluk") + "</div>" +
      '<div class="card"><div class="row">' +
        (wrongIds.length ? '<button type="button" class="btn primary" id="e-retry">Bu oturumdaki yanlışları tekrar çöz</button>' : "") +
        (BACK[session.origin] ? '<button type="button" class="btn" id="e-back">' + BACK[session.origin] + "</button>" : "") +
        '<button type="button" class="btn" id="e-bank">Soru Bankasına dön</button>' +
        '<button type="button" class="btn" id="e-panel">Panele dön</button>' +
      "</div></div>";
    var retry = document.getElementById("e-retry");
    if (retry) retry.onclick = function () {
      startSession(wrongIds.map(function (id) { return BY_ID[id]; }), "Yanlışların tekrarı", "hatalar");
    };
    var back = document.getElementById("e-back");
    if (back) back.onclick = function () { var o = session.origin; session = null; go(o); };
    document.getElementById("e-bank").onclick = function () { session = null; go("sorular"); };
    document.getElementById("e-panel").onclick = function () { session = null; go("panel"); };
  }

  // Klavye kısayolları: A–E cevap, sağ/sol ok ya da Enter ile gezinme.
  document.addEventListener("keydown", function (e) {
    if (!session || session.done || location.hash !== "#/coz") return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var tag = (e.target.tagName || "").toLowerCase();
    if (tag === "select" || tag === "input" || tag === "textarea") return;
    var k = e.key.toUpperCase();
    if (LETTERS.indexOf(k) !== -1) { e.preventDefault(); answer(k); }
    else if (e.key === "ArrowRight" || (e.key === "Enter" && tag !== "button")) { e.preventDefault(); next(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
  });

  // ---------- 7b. Deneme sınavı ----------
  // Gerçek sınav gibi: 80 soru, süre sayacı, cevaplar ve açıklamalar sınav bitene kadar gösterilmez.
  var EXAM_SETS = SETS.filter(function (s) { return s.group === "ÖSYM çıkmış sorular" && s.questions.length === 80; });
  var mockUI = { view: "list", resultAt: null, confirm: false, duration: "180" };
  var timerHandle = null;
  function mockState() {
    if (!state.mock) state.mock = { active: null, history: [] };
    return state.mock;
  }
  function examQuestions(setId) { return QUESTIONS.filter(function (q) { return q.set.id === setId; }); }
  function setById(id) { return SETS.filter(function (s) { return s.id === id; })[0]; }
  function remaining(a) { return a.durationMs ? a.startedAt + a.durationMs - Date.now() : Infinity; }
  function clock(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h + ":" + (m < 10 ? "0" : "") + m + ":" + (x < 10 ? "0" : "") + x;
  }
  function fmtScore(n) { return n.toFixed(2).replace(".", ","); }
  function fmtDate(t) {
    var d = new Date(t);
    return d.toLocaleDateString("tr-TR") + " " + d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  }

  function viewMock() {
    var m = mockState();
    if (m.active) {
      if (!setById(m.active.setId)) { m.active = null; save(); }          // Sınav dosyası kaldırılmışsa
      else if (remaining(m.active) <= 0) { submitExam(true); return; }    // Sayfa kapalıyken süre dolmuşsa
      else { viewExam(); return; }
    }
    var entry = mockUI.view === "result" ? m.history.filter(function (h) { return h.at === mockUI.resultAt; })[0] : null;
    if (entry) viewMockResult(entry); else viewMockList();
  }

  function viewMockList() {
    var m = mockState();
    var durations = [["180", "180 dakika (güncel sınav süresi)"], ["150", "150 dakika"], ["120", "120 dakika"], ["0", "Süresiz"]];
    var rows = EXAM_SETS.map(function (s) {
      var past = m.history.filter(function (h) { return h.setId === s.id; });
      var last = past[past.length - 1];
      return "<tr><td>" + esc(s.title) + "</td><td>" + (last ? "<b>" + fmtScore(last.score) + "</b> puan · " + fmtDate(last.at) : '<span class="muted">Çözülmedi</span>') +
        '</td><td style="text-align:right"><button type="button" class="btn' + (last ? "" : " primary") + '" data-start="' + esc(s.id) + '">' + (last ? "Tekrar çöz" : "Başla") + "</button></td></tr>";
    }).join("");
    var hist = m.history.slice().reverse().map(function (h) {
      var s = setById(h.setId);
      return "<tr><td>" + fmtDate(h.at) + "</td><td>" + esc(s ? s.title : h.setId) + "</td><td>" + h.correct + " / " + h.wrong + " / " + h.blank + "</td><td><b>" + fmtScore(h.score) + "</b></td>" +
        '<td style="text-align:right"><button type="button" class="btn" data-result="' + h.at + '">Sonuç</button></td></tr>';
    }).join("");
    view.innerHTML =
      "<h1>Deneme Sınavı</h1><p class=\"lead\">Bir ÖSYM sınavını gerçek sınav koşullarında baştan sona çöz.</p>" + storageNotice() +
      '<div class="card"><h2>Kurallar</h2><ul class="rules">' +
        "<li>80 soru, seçtiğin süre boyunca. Cevaplar ve açıklamalar sınav bitene kadar gösterilmez.</li>" +
        "<li>Cevabını istediğin kadar değiştirebilirsin. Emin olmadığın soruyu işaretleyip sonra dönebilirsin.</li>" +
        "<li>Tahmini puan = doğru sayısı × 1,25. Yanlış cevap puanı düşürmez, bu yüzden hiçbir soruyu boş bırakmamak avantajlıdır.</li>" +
        "<li>Sayfayı kapatırsan cevapların saklanır ama süre işlemeye devam eder; süre dolunca sınav kendiliğinden biter.</li>" +
        "<li>Sınavdaki cevapların Hatalarım ve aralıklı tekrar listesine de işlenir.</li>" +
      "</ul>" +
      '<label class="field" style="max-width:320px">Süre<select id="mk-dur">' +
        durations.map(function (d) { return '<option value="' + d[0] + '"' + (d[0] === mockUI.duration ? " selected" : "") + ">" + d[1] + "</option>"; }).join("") +
      "</select></label></div>" +
      '<div class="card"><h2>Sınavlar</h2><table class="list"><tr><th>Sınav</th><th>Son sonuç</th><th></th></tr>' + rows + "</table></div>" +
      (hist ? '<div class="card"><h2>Geçmiş denemeler</h2><table class="list"><tr><th>Tarih</th><th>Sınav</th><th>D / Y / B</th><th>Puan</th><th></th></tr>' + hist + "</table></div>" : "");
    document.getElementById("mk-dur").onchange = function (e) { mockUI.duration = e.target.value; };
    view.querySelectorAll("[data-start]").forEach(function (b) {
      b.onclick = function () { startExam(b.getAttribute("data-start"), Number(mockUI.duration) * 60000); };
    });
    view.querySelectorAll("[data-result]").forEach(function (b) {
      b.onclick = function () { mockUI.view = "result"; mockUI.resultAt = Number(b.getAttribute("data-result")); viewMock(); window.scrollTo(0, 0); };
    });
  }

  function startExam(setId, durationMs) {
    mockState().active = { setId: setId, startedAt: Date.now(), durationMs: durationMs, answers: {}, marked: {}, spent: {}, cur: 0, viewAt: Date.now() };
    save();
    mockUI.confirm = false;
    route();
  }

  function viewExam() {
    var a = mockState().active, qs = examQuestions(a.setId), q = qs[a.cur], set = setById(a.setId);
    var sel = a.answers[q.n], answeredN = Object.keys(a.answers).length, markedN = Object.keys(a.marked).length;
    var last = a.cur === qs.length - 1;
    var opts = q.opts.map(function (o, i) {
      var L = LETTERS[i];
      return '<button type="button" class="opt' + (sel === L ? " selected" : "") + '" data-letter="' + L + '" aria-pressed="' + (sel === L) + '"><span class="letter">' + L + "</span><span>" + esc(o) + "</span></button>";
    }).join("");
    var grid = qs.map(function (x, i) {
      var cls = "qn" + (a.answers[x.n] ? " answered" : "") + (a.marked[x.n] ? " marked" : "") + (i === a.cur ? " current" : "");
      return '<button type="button" class="' + cls + '" data-go="' + i + '" aria-label="Soru ' + x.n + (a.answers[x.n] ? ", cevaplandı" : ", boş") + (a.marked[x.n] ? ", işaretli" : "") + '">' + x.n + "</button>";
    }).join("");
    var confirmBox = mockUI.confirm
      ? '<div class="card confirm" role="alertdialog" aria-labelledby="cf-h"><h2 id="cf-h">Sınavı bitirmek istiyor musun?</h2><p>' +
        (qs.length - answeredN) + " soru boş, " + markedN + " soru işaretli. Bitirdikten sonra cevaplarını değiştiremezsin.</p>" +
        '<div class="row"><button type="button" class="btn primary" id="cf-yes">Evet, bitir</button><button type="button" class="btn" id="cf-no">Sınava dön</button></div></div>'
      : "";
    view.innerHTML =
      '<div class="row between exam-head"><div><h1>' + esc(set.title) + '</h1><div class="muted">Soru ' + q.n + " / " + qs.length + " · " + answeredN + " cevaplandı" + (markedN ? " · " + markedN + " işaretli" : "") + "</div></div>" +
        '<div class="row"><span class="timer" id="mk-timer"></span><button type="button" class="btn" id="mk-finish">Sınavı bitir</button></div></div>' +
      confirmBox +
      '<div class="card"><div class="tags"><span class="tag">Soru ' + q.n + '</span><span class="tag">' + esc(q.type) + "</span>" + (a.marked[q.n] ? '<span class="tag mark-tag">İşaretli</span>' : "") + "</div>" +
        questionBody(q) + '<div class="opts">' + opts + "</div>" +
        '<p class="muted" style="margin-top:14px;font-size:.88rem">Klavye: <kbd>A</kbd>–<kbd>E</kbd> cevap · <kbd>←</kbd> <kbd>→</kbd> gezin · <kbd>M</kbd> işaretle. Seçili şıkka tekrar tıklarsan cevap silinir.</p>' +
      "</div>" +
      '<div class="row between"><button type="button" class="btn" id="mk-prev"' + (a.cur === 0 ? " disabled" : "") + ">← Önceki</button>" +
        '<button type="button" class="btn" id="mk-mark">' + (a.marked[q.n] ? "İşareti kaldır" : "İşaretle") + "</button>" +
        '<button type="button" class="btn primary" id="mk-next">' + (last ? "Sınavı bitir" : "Sonraki →") + "</button></div>" +
      '<div class="card" style="margin-top:18px"><h2>Soru haritası</h2><div class="qgrid">' + grid + "</div>" +
        '<div class="legend"><span><i class="qn answered"></i>Cevaplandı</span><span><i class="qn marked"></i>İşaretli</span><span><i class="qn"></i>Boş</span></div></div>';

    view.querySelectorAll(".opt").forEach(function (b) { b.onclick = function () { setAnswer(b.getAttribute("data-letter"), true); }; });
    view.querySelectorAll("[data-go]").forEach(function (b) { b.onclick = function () { goTo(Number(b.getAttribute("data-go"))); }; });
    document.getElementById("mk-prev").onclick = function () { goTo(a.cur - 1); };
    document.getElementById("mk-next").onclick = function () { if (last) askFinish(); else goTo(a.cur + 1); };
    document.getElementById("mk-mark").onclick = toggleMark;
    document.getElementById("mk-finish").onclick = askFinish;
    if (mockUI.confirm) {
      document.getElementById("cf-yes").onclick = function () { submitExam(false); };
      document.getElementById("cf-no").onclick = function () { mockUI.confirm = false; viewExam(); };
      document.getElementById("cf-yes").focus();
    }
    clearInterval(timerHandle);
    tick();
    timerHandle = setInterval(tick, 1000);
  }
  function askFinish() { mockUI.confirm = true; viewExam(); window.scrollTo(0, 0); }
  function tick() {
    var a = mockState().active, el = document.getElementById("mk-timer");
    if (!a || !el) { clearInterval(timerHandle); return; }
    if (a.durationMs) {
      var r = remaining(a);
      if (r <= 0) { clearInterval(timerHandle); submitExam(true); return; }
      el.textContent = "Kalan süre " + clock(r);
      el.classList.toggle("low", r < 10 * 60000);
    } else {
      el.textContent = "Geçen süre " + clock(Date.now() - a.startedAt);
    }
  }
  // O an açık olan soruda geçen süreyi kaydeder (masadan kalkma payı: en fazla 10 dk).
  function noteTime(a) {
    var n = examQuestions(a.setId)[a.cur].n, now = Date.now();
    a.spent[n] = (a.spent[n] || 0) + Math.min(now - (a.viewAt || now), 10 * 60000);
    a.viewAt = now;
  }
  function goTo(i) {
    var a = mockState().active;
    if (i < 0 || i >= examQuestions(a.setId).length || i === a.cur) return;
    noteTime(a);
    a.cur = i;
    save();
    viewExam();
    window.scrollTo(0, 0);
  }
  function setAnswer(L, toggle) {
    var a = mockState().active, n = examQuestions(a.setId)[a.cur].n;
    if (toggle && a.answers[n] === L) delete a.answers[n]; else a.answers[n] = L;
    save();
    viewExam();
  }
  function toggleMark() {
    var a = mockState().active, n = examQuestions(a.setId)[a.cur].n;
    if (a.marked[n]) delete a.marked[n]; else a.marked[n] = true;
    save();
    viewExam();
  }
  function submitExam(auto) {
    var m = mockState(), a = m.active;
    if (!a) return;
    clearInterval(timerHandle);
    noteTime(a);
    var qs = examQuestions(a.setId), now = Date.now(), c = 0, w = 0, b = 0;
    qs.forEach(function (q) {
      var g = a.answers[q.n];
      if (!g) { b++; return; }
      var ok = g === q.ans;
      if (ok) c++; else w++;
      // Sınav cevapları normal cevap geçmişine de işlenir: Hatalarım ve aralıklı tekrar bunları görür.
      if (!state.attempts[q.id]) state.attempts[q.id] = [];
      state.attempts[q.id].push({ c: g, ok: ok, ms: a.spent[q.n] || 0, at: now, src: "deneme" });
    });
    var used = now - a.startedAt;
    if (a.durationMs) used = Math.min(used, a.durationMs);
    m.history.push({ setId: a.setId, at: now, startedAt: a.startedAt, durationMs: a.durationMs, usedMs: used, auto: !!auto,
      answers: a.answers, marked: a.marked, spent: a.spent, correct: c, wrong: w, blank: b, score: c * 1.25 });
    m.active = null;
    save();
    mockUI.view = "result"; mockUI.resultAt = now; mockUI.confirm = false; mockUI.keep = true;
    if (location.hash !== "#/deneme") location.hash = "#/deneme"; else route();
  }

  function viewMockResult(h) {
    var set = setById(h.setId), qs = examQuestions(h.setId);
    var rows = qs.map(function (q) {
      var g = h.answers[q.n] || null;
      return { q: q, g: g, st: !g ? "blank" : (g === q.ans ? "ok" : "wrong"), ms: h.spent[q.n] || 0 };
    });
    var types = uniq(qs.map(function (q) { return q.type; })).map(function (t) {
      var r = rows.filter(function (x) { return x.q.type === t; });
      var ok = r.filter(function (x) { return x.st === "ok"; }).length;
      var bl = r.filter(function (x) { return x.st === "blank"; }).length;
      var ms = r.reduce(function (s, x) { return s + x.ms; }, 0);
      return { type: t, total: r.length, ok: ok, blank: bl, acc: pct(ok, r.length), avg: r.length ? ms / r.length : 0 };
    });
    var weak = types.filter(function (t) { return t.acc < 100; }).sort(function (x, y) { return x.acc - y.acc; }).slice(0, 3);
    var missed = rows.filter(function (x) { return x.st !== "ok"; });
    var label = { ok: '<span class="st ok">Doğru</span>', wrong: '<span class="st bad">Yanlış</span>', blank: '<span class="st blank">Boş</span>' };

    view.innerHTML =
      '<div class="row between"><div><h1>Deneme sonucu</h1><p class="lead" style="margin:0">' + esc(set.title) + " · " + fmtDate(h.at) + '</p></div><button type="button" class="btn" id="r-back">Deneme listesine dön</button></div>' +
      (h.auto ? '<div class="notice warn" style="margin-top:16px">Süre dolduğu için sınav otomatik olarak bitirildi.</div>' : "") +
      '<div class="grid" style="margin-top:16px">' +
        stat(fmtScore(h.score), "Tahmini puan (100 üzerinden)") + stat(h.correct, "Doğru") + stat(h.wrong, "Yanlış") + stat(h.blank, "Boş") + stat(clock(h.usedMs), "Kullanılan süre") +
      "</div>" +
      '<p class="muted">Tahmini puan = doğru sayısı × 1,25; yanlışlar puanı düşürmez. Resmi puanı ÖSYM hesaplar, bu bir tahmindir.</p>' +
      '<div class="card"><h2>Soru türüne göre</h2><table class="list"><tr><th>Tür</th><th>Doğru</th><th>Boş</th><th style="width:34%">Doğruluk</th><th>Ort. süre</th></tr>' +
        types.map(function (t) {
          return "<tr><td>" + esc(t.type) + "</td><td>" + t.ok + " / " + t.total + "</td><td>" + t.blank + '</td><td><div class="bar"><i style="width:' + t.acc + '%"></i></div> <span class="muted">%' + t.acc + "</span></td><td>" + fmtTime(t.avg) + "</td></tr>";
        }).join("") + "</table></div>" +
      '<div class="card"><h2>Önerilen çalışma</h2>' +
        (weak.length ? weak.map(function (t) {
          var g = guideOf(t.type);
          return '<div class="advice"><p><b>' + esc(t.type) + "</b> · %" + t.acc + " doğruluk (" + t.ok + "/" + t.total + ")" + (g ? '<br><span class="muted">' + esc(g.steps[0]) + "</span>" : "") +
            '</p><button type="button" class="btn" data-practice="' + esc(t.type) + '">Bu türden soru çöz</button></div>';
        }).join("") : "<p>Bütün türlerde tam isabet. Bir sonraki sınava geçebilirsin.</p>") + "</div>" +
      '<div class="card"><h2>Soru soru inceleme</h2><div class="row" style="margin-bottom:12px">' +
        '<button type="button" class="btn primary" id="r-missed"' + (missed.length ? "" : " disabled") + ">Yanlış ve boşları incele (" + missed.length + ")</button>" +
        '<button type="button" class="btn" id="r-all">Tümünü incele</button></div>' +
        '<table class="list"><tr><th>No</th><th>Tür</th><th>Cevabın</th><th>Doğru</th><th>Sonuç</th><th>Süre</th><th></th></tr>' +
        rows.map(function (x, i) {
          return "<tr><td>" + x.q.n + "</td><td>" + esc(x.q.type) + "</td><td>" + (x.g || "–") + "</td><td>" + x.q.ans + "</td><td>" + label[x.st] + "</td><td>" + fmtTime(x.ms) +
            '</td><td style="text-align:right"><button type="button" class="btn small" data-review="' + i + '">İncele</button></td></tr>';
        }).join("") + "</table></div>" +
      requestBox(missed.map(function (x) { return x.q; }));

    document.getElementById("r-back").onclick = function () { mockUI.view = "list"; viewMock(); window.scrollTo(0, 0); };
    document.getElementById("r-missed").onclick = function () { startReview(h, missed.map(function (x) { return x.q; }), 0); };
    document.getElementById("r-all").onclick = function () { startReview(h, qs, 0); };
    view.querySelectorAll("[data-review]").forEach(function (b) {
      b.onclick = function () { startReview(h, qs, Number(b.getAttribute("data-review"))); };
    });
    view.querySelectorAll("[data-practice]").forEach(function (b) {
      b.onclick = function () {
        filters = { group: "", set: "", types: [b.getAttribute("data-practice")], topic: "", level: "", status: "new", exp: "", order: "karisik", limit: "20" };
        go("sorular");
      };
    });
    bindCopy();
  }
  // Sınav sonrası inceleme: soru ekranı salt okunur açılır, verdiğin cevap ve doğru cevap birlikte görünür.
  function startReview(h, list, idx) {
    var given = {};
    list.forEach(function (q) { given[q.id] = h.answers[q.n] || null; });
    session = { ids: list.map(function (q) { return q.id; }), idx: idx || 0, given: given, title: "Deneme incelemesi", origin: "deneme", review: true, done: false, shownAt: Date.now() };
    go("coz");
  }

  // Açıklaması olmayan soruların listesini sohbete yapıştırılacak metin olarak verir.
  function requestBox(list) {
    var need = list.filter(function (q) { return !q.why; });
    if (!need.length) return "";
    var text = "YDS Master açıklama isteği (" + need.length + " soru): " + need.map(function (q) { return q.id; }).join(", ");
    return '<div class="card"><h2>Açıklama iste</h2><p>Bu listedeki ' + need.length + " sorunun Türkçe açıklaması henüz yok. Metni kopyalayıp Claude ile sohbete yapıştır; açıklamaları yazılıp uygulamaya eklenir.</p>" +
      '<textarea class="req" readonly rows="3" aria-label="Açıklama isteği metni">' + esc(text) + "</textarea>" +
      '<div class="row" style="margin-top:8px"><button type="button" class="btn primary" data-copy>Metni kopyala</button><span class="muted" data-copied role="status"></span></div></div>';
  }
  function bindCopy() {
    view.querySelectorAll("[data-copy]").forEach(function (b) {
      b.onclick = function () {
        var card = b.closest(".card"), ta = card.querySelector("textarea"), out = card.querySelector("[data-copied]");
        function done(ok) { out.textContent = ok ? "Kopyalandı." : "Kopyalanamadı; metni seçip Ctrl+C ile kopyala."; }
        function fallback() { ta.focus(); ta.select(); var ok = false; try { ok = document.execCommand("copy"); } catch (e) { ok = false; } done(ok); }
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(function () { done(true); }, fallback);
        else fallback();
      };
    });
  }

  // Sınav ekranının klavye kısayolları.
  document.addEventListener("keydown", function (e) {
    if (location.hash !== "#/deneme" || !mockState().active || mockUI.confirm) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var tag = (e.target.tagName || "").toLowerCase();
    if (tag === "select" || tag === "input" || tag === "textarea") return;
    var k = e.key.toUpperCase(), a = mockState().active;
    if (LETTERS.indexOf(k) !== -1) { e.preventDefault(); setAnswer(k, false); }
    else if (e.key === "ArrowRight") { e.preventDefault(); goTo(a.cur + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); goTo(a.cur - 1); }
    else if (k === "M") { e.preventDefault(); toggleMark(); }
  });

  // ---------- 8. Hatalarım ----------
  function viewMistakes() {
    var list = mistakes();
    var rg = reviewGroups();
    // Aralıklı tekrar kartı: bugün, ileride ve kalıcı öğrenilen soru sayıları.
    var review = '<div class="card"><h2>Aralıklı tekrar</h2><div class="grid" style="margin-bottom:12px">' +
      stat(rg.due.length, "Bugün tekrar edilecek") + stat(rg.later.length, "İleri tarihe planlı") + stat(rg.mastered.length, "Kalıcı öğrenilen") + "</div>" +
      '<p class="muted">Yanlış yaptığın soru doğru çözdükçe 1, 3 ve 7 gün sonra yeniden sorulur. Art arda dört doğrudan sonra kalıcı sayılır.</p>' +
      '<button type="button" class="btn primary" id="m-due"' + (rg.due.length ? "" : " disabled") + ">Bugünün tekrarını başlat</button></div>";
    function bindDue() {
      document.getElementById("m-due").onclick = function () { startSession(rg.due, "Bugünün tekrarı", "hatalar"); };
    }
    if (!list.length) {
      view.innerHTML = "<h1>Hatalarım</h1><p class=\"lead\">Yanlış çözdüğün sorular burada birikir.</p>" + review +
        '<div class="card"><p>Şu an son denemesi yanlış olan sorun yok. Bir soruyu yanlış çözdüğünde buraya eklenir, doğru çözdüğünde listeden çıkar.</p></div>';
      bindDue();
      return;
    }
    var groups = uniq(list.map(function (q) { return q.type; }));
    view.innerHTML =
      "<h1>Hatalarım</h1><p class=\"lead\">Son denemede yanlış çözdüğün " + list.length + " soru. Doğru çözünce listeden çıkar.</p>" + review +
      '<div class="card"><div class="row"><button type="button" class="btn primary" id="m-all">Hepsini tekrar çöz</button>' +
        groups.map(function (g) {
          var n = list.filter(function (q) { return q.type === g; }).length;
          return '<button type="button" class="btn" data-group="' + esc(g) + '">' + esc(g) + " (" + n + ")</button>";
        }).join("") + "</div></div>" +
      '<div class="card"><table class="list"><tr><th>Soru</th><th>Tür</th><th>Konu</th><th>Yanlış sayısı</th><th>Son cevabın</th></tr>' +
        list.map(function (q) {
          var wrongCount = attemptsOf(q.id).filter(function (a) { return !a.ok; }).length;
          return "<tr><td>" + esc(q.set.title) + " · " + q.n + "</td><td>" + esc(q.type) + "</td><td>" + esc(q.topic) + "</td><td>" + wrongCount + "</td><td>" + lastOf(q.id).c + " (doğrusu " + q.ans + ")</td></tr>";
        }).join("") + "</table></div>" + requestBox(list);
    bindDue();
    bindCopy();
    document.getElementById("m-all").onclick = function () { startSession(list, "Hataları tekrar çöz", "hatalar"); };
    view.querySelectorAll("[data-group]").forEach(function (b) {
      b.onclick = function () {
        var g = b.getAttribute("data-group");
        startSession(list.filter(function (q) { return q.type === g; }), "Hatalar: " + g, "hatalar");
      };
    });
  }

  // ---------- 9. İstatistik ----------
  function viewStats() {
    var s = summary(QUESTIONS);
    var types = byType();
    var allAttempts = [];
    QUESTIONS.forEach(function (q) { attemptsOf(q.id).forEach(function (a) { allAttempts.push({ q: q, a: a }); }); });

    // Son 7 günün her biri için kaç soru çözüldüğünü say.
    var days = [], names = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"], now = new Date();
    for (var i = 6; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      var start = d.getTime(), end = start + 86400000;
      days.push({ label: names[d.getDay()], n: allAttempts.filter(function (x) { return x.a.at >= start && x.a.at < end; }).length });
    }
    var maxDay = Math.max.apply(null, days.map(function (d) { return d.n; }).concat([1]));

    // En çok tekrarlanan hatalar: birden fazla kez yanlış yapılan sorular.
    var repeated = QUESTIONS.map(function (q) {
      return { q: q, n: attemptsOf(q.id).filter(function (a) { return !a.ok; }).length };
    }).filter(function (x) { return x.n >= 2; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 8);

    view.innerHTML =
      "<h1>İstatistik</h1><p class=\"lead\">Doğruluk oranları her sorunun son denemesine göre hesaplanır.</p>" +
      '<div class="grid">' + stat(s.solved + " / " + s.total, "Çözülen soru") + stat(allAttempts.length, "Toplam cevap") + stat(s.solved ? "%" + s.acc : "–", "Doğruluk") + stat(fmtTime(s.avgMs), "Ortalama süre") + "</div>" +
      '<div class="card"><h2>Soru türüne göre doğruluk</h2>' +
        types.map(function (t) {
          return barRow(t.type, t.acc, t.solved ? "%" + t.acc + " (" + t.correct + "/" + t.solved + ")" : "çözülmedi");
        }).join("") +
        '<p class="muted" style="margin-top:10px">Parantez içi: doğru / çözülen soru sayısı.</p></div>' +
      '<div class="card"><h2>Son 7 gün</h2><div class="days">' +
        days.map(function (d) {
          return '<div class="day"><b>' + d.n + '</b><i style="height:' + Math.round((d.n / maxDay) * 80) + '%"></i><span>' + d.label + "</span></div>";
        }).join("") + '</div><p class="muted" style="margin-top:10px">Her sütun o gün çözülen soru sayısını gösterir.</p></div>' +
      '<div class="card"><h2>En çok tekrarlanan hatalar</h2>' +
        (repeated.length
          ? '<table class="list"><tr><th>Soru</th><th>Tür</th><th>Konu</th><th>Yanlış sayısı</th></tr>' + repeated.map(function (x) {
              return "<tr><td>" + esc(x.q.set.title) + " · " + x.q.n + "</td><td>" + esc(x.q.type) + "</td><td>" + esc(x.q.topic) + "</td><td>" + x.n + "</td></tr>";
            }).join("") + "</table>"
          : '<p class="muted">Aynı soruyu iki kez yanlış çözdüğünde burada listelenir.</p>') +
      "</div>" + mockHistoryCard();
  }

  function mockHistoryCard() {
    var hs = mockState().history.slice(-10);
    if (!hs.length) return '<div class="card"><h2>Deneme geçmişi</h2><p class="muted">Deneme Sınavı sayfasından bir sınav çözünce puanların burada görünür.</p></div>';
    return '<div class="card"><h2>Deneme geçmişi</h2>' + hs.map(function (h) {
      var s = setById(h.setId);
      return barRow(fmtDate(h.at).split(" ")[0] + " · " + (s ? s.title.replace(/^ÖSYM /, "").replace(/ \(.*\)$/, "") : h.setId), h.score, fmtScore(h.score) + " puan");
    }).join("") + '<p class="muted" style="margin-top:10px">Son 10 deneme, eskiden yeniye. Çubuk 100 puan üzerinden.</p></div>';
  }

  // ---------- 9b. Rehber ----------
  function viewGuide() {
    var rows = GUIDE.types.map(function (t) {
      var inBank = QUESTIONS.filter(function (q) { return q.type === t.type; });
      var withExp = inBank.filter(function (q) { return q.why; }).length;
      return "<tr><td>" + esc(t.type) + "</td><td>" + t.exam + "</td><td>" + inBank.length + "</td><td>" + withExp + "</td></tr>";
    }).join("");
    var total = GUIDE.types.reduce(function (n, t) { return n + t.exam; }, 0);
    view.innerHTML =
      "<h1>Rehber</h1><p class=\"lead\">Sınavın yapısı, her soru türü için çözüm adımları ve bu uygulamanın çalışma yöntemi.</p>" +
      '<div class="card"><h2>Sınav yapısı ve soru bankasının kapsamı</h2><p class="muted">' + esc(GUIDE.formatNote) + "</p>" +
        '<table class="list"><tr><th>Soru türü</th><th>Sınavda</th><th>Bankada</th><th>Açıklamalı</th></tr>' + rows +
        "<tr><td><b>Toplam</b></td><td><b>" + total + "</b></td><td><b>" + QUESTIONS.length + "</b></td><td><b>" + QUESTIONS.filter(function (q) { return q.why; }).length + "</b></td></tr></table></div>" +
      '<div class="card"><h2>Bu uygulama nasıl öğretiyor?</h2>' +
        GUIDE.methods.map(function (m) { return "<h3>" + esc(m.name) + "</h3><p>" + esc(m.text) + "</p>"; }).join("") + "</div>" +
      '<div class="card"><h2>Soru türüne göre çözüm adımları</h2>' +
        GUIDE.types.map(function (t) {
          return '<details class="guide"><summary>' + esc(t.type) + " (sınavda yaklaşık " + t.exam + " soru)</summary><ol>" +
            t.steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol><p><b>Sık düşülen tuzaklar:</b> " + t.traps.map(esc).join(" ") + "</p></details>";
        }).join("") + "</div>";
  }

  // ---------- 10. Yedekleme ----------
  function viewBackup(message) {
    var count = Object.keys(state.attempts).length;
    view.innerHTML =
      "<h1>Yedekleme</h1><p class=\"lead\">İlerlemen yalnızca bu bilgisayardaki bu tarayıcıda durur. Ara sıra yedek almak iyi bir alışkanlık.</p>" +
      (message ? '<div class="notice info" role="status">' + esc(message) + "</div>" : "") + storageNotice() +
      '<div class="card"><h2>Yedek al</h2><p>Kayıtlı ' + count + ' sorunun cevap geçmişini, deneme sınavı sonuçlarını ve kelime çalışmalarını bir dosyaya indirir.</p><button type="button" class="btn primary" id="b-export">İlerlemeyi dosyaya indir</button></div>' +
      '<div class="card"><h2>Yedekten geri yükle</h2><p>Daha önce indirdiğin yedek dosyasını seç. Şu anki ilerlemenin yerine geçer.</p><input type="file" id="b-file" accept="application/json,.json"></div>' +
      '<div class="card"><h2>Sıfırla</h2><p>Bütün cevap geçmişini ve deneme sonuçlarını siler. Geri alınamaz.</p><button type="button" class="btn danger" id="b-reset">İlerlemeyi sil</button></div>';

    document.getElementById("b-export").onclick = function () {
      var blob = new Blob([JSON.stringify({ app: "ydsmaster", version: 1, exportedAt: new Date().toISOString(), attempts: state.attempts, mock: mockState(), learn: state.learn || {} }, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "yds-master-yedek-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    };
    document.getElementById("b-file").onchange = function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(reader.result);
          if (data.app !== "ydsmaster" || typeof data.attempts !== "object") throw new Error("format");
          state = { attempts: data.attempts, mock: data.mock || { active: null, history: [] }, learn: data.learn || {} };
          save(); route();
          viewBackup("Yedek geri yüklendi: " + Object.keys(state.attempts).length + " sorunun geçmişi alındı.");
        } catch (err) {
          viewBackup("Bu dosya bir YDS Master yedeği gibi görünmüyor. Hiçbir şey değiştirilmedi.");
        }
      };
      reader.readAsText(file);
    };
    // Yanlışlıkla silmeyi önlemek için iki kez tıklamak gerekir.
    var reset = document.getElementById("b-reset"), armed = false;
    reset.onclick = function () {
      if (!armed) { armed = true; reset.textContent = "Emin misin? Silmek için tekrar tıkla"; return; }
      state = { attempts: {}, mock: { active: null, history: [] } };
      save(); route();
      viewBackup("Bütün ilerleme silindi.");
    };
  }

  // ---------- 11. Diğer modüller için arayüz ----------
  // js/ogren.js gibi dosyalar yeni sayfalarını buradan ekler; ortak yardımcıları buradan kullanır.
  window.YDS_APP = {
    get state() { return state; },
    save: save,
    register: function (name, fn) { ROUTES[name] = fn; },
    startSession: startSession,
    go: go,
    BY_ID: BY_ID,
    QUESTIONS: QUESTIONS,
    statusOf: statusOf,
    esc: esc,
    stat: stat,
    barRow: barRow,
    pct: pct,
    shuffle: shuffle,
    view: view
  };

  // ---------- 12. Başlat ----------
  // Bütün script dosyaları yüklendikten sonra ilk sayfayı göster.
  window.addEventListener("hashchange", route);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", route); else route();
})();
