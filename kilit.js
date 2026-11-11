// js/kilit.js : Web sürümünün kilidi. veri.enc dosyasını şifreyle çözer, uygulamayı başlatır,
// çözülen veriyi (istenirse) bu cihazda saklar ve internetsiz çalışma için service worker'ı kaydeder.
(function () {
  "use strict";
  var DB = "ydsmaster", STORE = "veri", KEY = "bundle";

  // ---------- Cihaz hafızası (IndexedDB): çözülmüş veriyi saklar ----------
  function db() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function op(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(STORE, mode), req = fn(t.objectStore(STORE));
        t.oncomplete = function () { res(req && req.result); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }
  var getCache = function () { return op("readonly", function (s) { return s.get(KEY); }).catch(function () { return null; }); };
  var putCache = function (v) { return op("readwrite", function (s) { return s.put(v, KEY); }).catch(function () {}); };
  var delCache = function () { return op("readwrite", function (s) { return s.delete(KEY); }).catch(function () {}); };

  // ---------- Şifre çözme ----------
  function fromB64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function fetchEnc() {
    return fetch("veri.enc", { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("NOFILE");
      return r.json();
    });
  }
  async function decrypt(file, pass) {
    var enc = new TextEncoder();
    var base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
    var key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: fromB64(file.salt), iterations: file.iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    var plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(file.iv) }, key, fromB64(file.ct));
    return new TextDecoder().decode(plain);
  }

  // ---------- Uygulamayı başlat ----------
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = function () { rej(new Error(src)); };
      document.body.appendChild(s);
    });
  }
  async function boot(text) {
    var s = document.createElement("script");
    s.textContent = text;                       // Soru verisini sayfaya yükle
    document.body.appendChild(s);
    document.body.classList.remove("locked");
    await loadScript("app.js");
    await loadScript("ogren.js");
    window.dispatchEvent(new HashChangeEvent("hashchange"));   // Yeni eklenen sayfalar da açılabilsin
  }

  // ---------- Kilit formu ----------
  function say(html, cls) { document.getElementById("lockmsg").innerHTML = html ? '<div class="notice ' + (cls || "warn") + '">' + html + "</div>" : ""; }
  function showForm(note) {
    var box = document.getElementById("lockbox");
    if (!box) { location.reload(); return; }
    if (note) say(note, "info");
    document.getElementById("lockform").onsubmit = async function (e) {
      e.preventDefault();
      var pass = document.getElementById("pass").value, btn = document.getElementById("unlock");
      if (!window.crypto || !crypto.subtle) return say("Bu tarayıcı şifre çözmeyi desteklemiyor. Safari ya da Chrome'un güncel sürümünü kullan.");
      btn.disabled = true; say("Açılıyor…", "info");
      try {
        var file = await fetchEnc();
        var text;
        try { text = await decrypt(file, pass); }
        catch (err) { btn.disabled = false; return say("Şifre yanlış. Tekrar dene."); }
        if (document.getElementById("remember").checked) await putCache({ text: text, at: file.at });
        else await delCache();
        await boot(text);
      } catch (err) {
        btn.disabled = false;
        say(err.message === "NOFILE" ? "Şifreli veri dosyası (veri.enc) bulunamadı. Dosyanın siteye yüklendiğinden emin ol." : "Veri yüklenemedi. İnternet bağlantını kontrol edip tekrar dene.");
      }
    };
    setTimeout(function () { var p = document.getElementById("pass"); if (p) p.focus(); }, 50);
  }

  // Siteye daha yeni bir veri.enc yüklendiyse kullanıcıya haber ver
  function checkUpdate(cached) {
    fetchEnc().then(function (file) {
      if (!file.at || file.at === cached.at) return;
      var bar = document.createElement("div");
      bar.className = "update-bar";
      bar.innerHTML = '<span>Yeni soru verisi var.</span><button type="button" class="btn primary">Şifreyle güncelle</button>';
      bar.querySelector("button").onclick = function () { delCache().then(function () { location.reload(); }); };
      document.body.appendChild(bar);
    }).catch(function () {});
  }

  // ---------- Kilitle düğmesi ----------
  document.getElementById("lock-out").onclick = function () {
    delCache().then(function () { location.hash = ""; location.reload(); });
  };

  // ---------- İnternetsiz çalışma ----------
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }

  // ---------- Başlangıç ----------
  getCache().then(function (cached) {
    if (cached && cached.text) { boot(cached.text); checkUpdate(cached); }
    else showForm();
  });
})();
