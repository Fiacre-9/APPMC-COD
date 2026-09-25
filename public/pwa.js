// Installation de l'application (PWA) : bouton natif sur Android/Chrome, guide « Sur l'écran d'accueil » sur iPhone/iPad.
// <script src="/pwa.js" data-app="Boutique" data-color="#1A56DB" data-offset="70" data-auto="0"></script>  (data-auto="0" : pas de bannière automatique)
// Tout élément [data-pwa-install] devient un bouton « Installer » (masqué une fois l'app installée).
(function () {
  var s = document.currentScript || {}, d = s.dataset || {};
  var app = d.app || 'Mireb', color = d.color || '#1A56DB', offset = +d.offset || 12, auto = d.auto !== '0';
  if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });

  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  var ua = navigator.userAgent;
  var ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var inApp = /FBAN|FBAV|FB_IAB|Instagram|musical_ly|Bytedance|TikTok/i.test(ua);
  var key = 'mireb_pwa_later_' + app, deferred = null, bar = null;
  var later = function () { try { return +localStorage.getItem(key) > Date.now(); } catch (e) { return false; } };
  var setLater = function () { try { localStorage.setItem(key, String(Date.now() + 7 * 864e5)); } catch (e) {} };
  var buttons = function (show) { document.querySelectorAll('[data-pwa-install]').forEach(function (b) { b.hidden = !show; }); };

  function el(html) { var t = document.createElement('div'); t.innerHTML = html; return t.firstChild; }
  function hideBar() { if (bar) { bar.remove(); bar = null; } }
  function showBar() {
    if (bar || standalone || later() || !auto) return;
    bar = el('<div role="dialog" aria-label="Installer l\'application" style="position:fixed;left:10px;right:10px;bottom:' + offset + 'px;z-index:99999;' +
      'max-width:460px;margin:0 auto;background:#0F172A;color:#fff;border-radius:14px;padding:12px;display:flex;gap:10px;align-items:center;' +
      'box-shadow:0 10px 30px rgba(0,0,0,.3);font:14px/1.35 system-ui,-apple-system,sans-serif">' +
      '<img src="' + (d.icon || '/icons/boutique-192.png') + '" alt="" width="42" height="42" style="border-radius:10px;flex-shrink:0">' +
      '<div style="flex:1;min-width:0"><b>Installer l\'app ' + app + '</b><br><span style="opacity:.75;font-size:12px">Accès rapide depuis votre écran d\'accueil</span></div>' +
      '<button data-a="ok" style="background:' + color + ';color:#fff;border:0;border-radius:9px;padding:9px 14px;font-weight:700;cursor:pointer">Installer</button>' +
      '<button data-a="no" aria-label="Plus tard" style="background:none;border:0;color:#94a3b8;font-size:20px;cursor:pointer;padding:4px">✕</button></div>');
    bar.onclick = function (e) {
      var a = e.target.getAttribute('data-a');
      if (a === 'ok') install(); else if (a === 'no') { setLater(); hideBar(); }
    };
    document.body.appendChild(bar);
  }

  function guide(why) {
    var share = '<svg width="18" height="18" viewBox="0 0 24 24" style="vertical-align:-3px"><path d="M12 3v12M7 8l5-5 5 5" fill="none" stroke="#1A56DB" stroke-width="2"/><path d="M5 11v9h14v-9" fill="none" stroke="#1A56DB" stroke-width="2"/></svg>';
    var steps = ios
      ? ['Touchez le bouton <b>Partager</b> ' + share + ' en bas de Safari (ou en haut sur iPad).', 'Faites défiler et choisissez <b>« Sur l\'écran d\'accueil »</b>.', 'Touchez <b>Ajouter</b> : l\'icône apparaît sur votre écran.']
      : ['Ouvrez le menu <b>⋮</b> du navigateur (en haut à droite).', 'Choisissez <b>« Installer l\'application »</b> ou <b>« Ajouter à l\'écran d\'accueil »</b>.', 'Confirmez : l\'icône apparaît sur votre écran.'];
    var m = el('<div style="position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.55);display:flex;align-items:flex-end;justify-content:center;font:15px/1.5 system-ui,-apple-system,sans-serif">' +
      '<div style="background:#fff;color:#0F172A;width:100%;max-width:460px;border-radius:18px 18px 0 0;padding:20px 20px calc(20px + env(safe-area-inset-bottom))">' +
      '<div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:17px">📲 Installer ' + app + '</b>' +
      '<button data-x style="background:none;border:0;font-size:22px;cursor:pointer;color:#64748B">✕</button></div>' +
      (inApp ? '<p style="background:#FEF3C7;padding:8px 10px;border-radius:8px;font-size:13px">Vous êtes dans le navigateur de Facebook, Instagram ou TikTok : touchez <b>⋯</b> puis <b>« Ouvrir dans ' + (ios ? 'Safari' : 'Chrome') + ' »</b>, puis suivez ces étapes.</p>' : '') +
      (why === 'push' ? '<p style="background:#EEF2FF;padding:8px 10px;border-radius:8px;font-size:13px">🔔 Sur iPhone, les notifications fonctionnent dans l\'app installée : installez-la, ouvrez-la depuis l\'écran d\'accueil puis activez les notifications.</p>' : '') +
      '<ol style="padding-left:20px;margin:12px 0 0">' + steps.map(function (x) { return '<li style="margin:8px 0">' + x + '</li>'; }).join('') + '</ol></div></div>');
    m.onclick = function (e) { if (e.target === m || e.target.hasAttribute('data-x')) m.remove(); };
    document.body.appendChild(m);
  }

  function install() {
    if (deferred) {
      deferred.prompt();
      deferred.userChoice.then(function (c) { if (c.outcome !== 'accepted') setLater(); deferred = null; hideBar(); });
    } else guide();
  }
  window.MirebInstall = install;

  // ---------- Notifications push ----------
  // MirebPush.button(bouton, '/vendor/api/push/subscribe', { corps en plus }, { en-têtes en plus })
  var b64 = function (k) { var p = '='.repeat((4 - k.length % 4) % 4), r = atob((k + p).replace(/-/g, '+').replace(/_/g, '/')), a = new Uint8Array(r.length);
    for (var i = 0; i < r.length; i++) a[i] = r.charCodeAt(i); return a; };
  var pushOk = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  window.MirebPush = {
    // iPhone : les notifications ne marchent que dans l'app installée (écran d'accueil)
    needsInstall: function () { return ios && !standalone; },
    supported: function () { return pushOk; },
    enable: function (url, body, headers) {
      if (this.needsInstall()) return Promise.reject(new Error('install'));
      if (!pushOk) return Promise.reject(new Error('Ce navigateur ne gère pas les notifications.'));
      return Notification.requestPermission().then(function (perm) {
        if (perm !== 'granted') throw new Error('Notifications bloquées : autorisez-les dans les réglages du navigateur pour ce site.');
        return navigator.serviceWorker.register('/sw.js').then(function () { return navigator.serviceWorker.ready; });
      }).then(function (reg) {
        return fetch('/public/push/key').then(function (r) { return r.json(); }).then(function (k) {
          return reg.pushManager.getSubscription().then(function (sub) {
            return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(k.key) }).catch(function () {
              throw new Error('Impossible d\'activer les notifications sur ce navigateur. Essayez avec Chrome, Samsung Internet ou l\'application installée.');
            });
          });
        });
      }).then(function (sub) {
        var h = { 'Content-Type': 'application/json' }; for (var x in headers || {}) h[x] = headers[x];
        var data = { subscription: sub.toJSON() }; for (var y in body || {}) data[y] = body[y];
        return fetch(url, { method: 'POST', headers: h, credentials: 'same-origin', body: JSON.stringify(data) }).then(function (r) {
          if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || 'Erreur'); });
        });
      });
    },
    button: function (btn, url, body, headers) {
      if (!btn) return;
      var on = function () { btn.textContent = '🔔 Notifications activées'; btn.disabled = true; };
      if (!pushOk && !this.needsInstall()) { btn.hidden = true; return; }
      var self = this;
      // Déjà autorisé sur cet appareil : on réabonne sans rien demander (garde le lien avec ce compte)
      if (pushOk && Notification.permission === 'granted' && !self.needsInstall()) self.enable(url, body, headers).then(on, function () {});
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        if (self.needsInstall()) { guide('push'); return; }
        btn.disabled = true;
        self.enable(url, body, headers).then(on, function (err) { btn.disabled = false; alert(err.message); });
      });
    },
  };

  if (standalone) { buttons(false); return; }
  document.addEventListener('DOMContentLoaded', function () {
    buttons(true);
    document.querySelectorAll('[data-pwa-install]').forEach(function (b) { b.addEventListener('click', function (e) { e.preventDefault(); install(); }); });
  });
  // Android / Chrome / Edge : le navigateur propose l'installation native
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; showBar(); });
  window.addEventListener('appinstalled', function () { hideBar(); buttons(false); });
  // iPhone / iPad : pas de bouton natif, on propose le guide après quelques secondes
  if (ios) setTimeout(showBar, 4000);
})();
