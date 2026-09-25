// Formulaire COD intégrable : <div data-mireb-form data-product="1" data-canal="1"></div><script src=".../widget.js"></script>
(function () {
  var base = (document.currentScript && document.currentScript.src || '').replace(/\/widget\.js.*$/, '');
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function mount(el) {
    var pid = el.getAttribute('data-product') || '', canal = el.getAttribute('data-canal') || new URLSearchParams(location.search).get('canal') || new URLSearchParams(location.search).get('mireb_canal') || '';
    fetch(base + '/public/form-config?product_id=' + pid).then(function (r) { return r.json(); }).then(function (c) {
      var col = el.getAttribute('data-color') || c.color, p = c.product;
      el.innerHTML = '<form style="font-family:system-ui,sans-serif;max-width:420px;border:2px solid ' + col + ';border-radius:12px;padding:18px;display:grid;gap:10px">' +
        (c.badge ? '<span style="background:' + col + ';color:#fff;padding:3px 10px;border-radius:99px;width:max-content;font-size:13px">' + esc(c.badge) + '</span>' : '') +
        (p && !el.hasAttribute('data-compact') ? '<b style="font-size:18px">' + esc(el.getAttribute('data-titre') || p.name) + '</b><div>' + (el.getAttribute('data-prix-barre') ? '<s style="color:#888">' + esc(el.getAttribute('data-prix-barre')) + '</s> ' : '') + '<b style="color:' + col + ';font-size:20px">' + esc(el.getAttribute('data-prix') || p.price) + '</b></div>' : '') +
        '<small style="color:#555">' + esc(c.subtitle) + '</small>' +
        ['name|Nom complet', 'phone|Téléphone', 'address|Adresse complète', 'city|Ville'].map(function (f) { f = f.split('|');
          return '<input name="' + f[0] + '" placeholder="' + f[1] + '" ' + (f[0] !== 'city' ? 'required' : '') + ' style="padding:12px;border:1px solid #ccc;border-radius:8px;font-size:16px">'; }).join('') +
        '<button style="background:' + col + ';color:#fff;border:0;padding:14px;border-radius:8px;font-size:17px;font-weight:bold;cursor:pointer">' + esc(c.button) + '</button>' +
        '<small style="text-align:center;color:#555">' + esc(c.guarantee) + '</small><div class="mireb-msg"></div></form>';
      el.querySelector('form').onsubmit = function (e) {
        e.preventDefault(); var f = e.target, b = f.querySelector('button'), d = Object.fromEntries(new FormData(f));
        d.product_id = pid; d.canal = canal; b.disabled = true;
        fetch(base + '/public/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) })
          .then(function (r) { return r.json(); }).then(function (r) {
            if (r.ok) f.innerHTML = '<h3 style="color:' + col + '">✅ Commande reçue (n°' + r.id + ')</h3><p>' + esc(r.message) + '</p><p><a style="color:' + col + ';font-weight:bold" href="' + base + '/suivi?n=' + r.id + '">🚚 Suivre ma commande</a></p>';
            else { f.querySelector('.mireb-msg').textContent = r.error; b.disabled = false; }
          });
      };
    });
  }
  document.querySelectorAll('[data-mireb-form]').forEach(mount);
})();
