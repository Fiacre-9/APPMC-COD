// Formulaire COD intégrable : <div data-mireb-form data-product="1" data-canal="1"></div><script src=".../widget.js"></script>
(function () {
  var base = (document.currentScript && document.currentScript.src || '').replace(/\/widget\.js.*$/, '');
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function mount(el) {
    var pid = el.getAttribute('data-product') || '', canal = el.getAttribute('data-canal') || new URLSearchParams(location.search).get('canal') || new URLSearchParams(location.search).get('mireb_canal') || '';
    fetch(base + '/public/form-config?product_id=' + pid).then(function (r) { return r.json(); }).then(function (c) {
      var col = el.getAttribute('data-color') || c.color, p = c.product, opts = (p && p.options) || [];
      var money = function (n) { return (Math.round(n * 100) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' ' + (c.currency || '$'); };
      var inp = 'padding:12px;border:1px solid #ccc;border-radius:8px;font-size:16px';
      // Variantes : une rangée de boutons par groupe (Taille, Couleur…) ; valeur épuisée grisée ; 1re valeur disponible présélectionnée
      var out = function (v) { return v.stock != null && v.stock <= 0; };
      var chosen = opts.map(function (g) { for (var i = 0; i < g.values.length; i++) if (!out(g.values[i])) return i; return -1; });
      var soldOut = chosen.indexOf(-1) !== -1;
      var variants = opts.map(function (g, gi) {
        return '<div><div style="font-size:14px;font-weight:600;margin-bottom:6px">' + esc(g.name) + ' : <span data-vl="' + gi + '" style="font-weight:400">' + (chosen[gi] >= 0 ? esc(g.values[chosen[gi]].label) : 'épuisé') + '</span></div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:6px">' + g.values.map(function (v, vi) {
            var off = out(v);
            return '<button type="button" data-g="' + gi + '" data-v="' + vi + '"' + (off ? ' disabled title="Épuisé"' : '') + ' style="padding:8px 12px;border-radius:8px;font-size:14px;background:#fff;' +
              (off ? 'color:#aaa;text-decoration:line-through;cursor:not-allowed;border:2px dashed #e5e7eb' : 'cursor:pointer;border:2px solid ' + (vi === chosen[gi] ? col : '#ddd')) + '">' +
              esc(v.label) + (v.extra ? ' <small style="color:#666">+' + esc(money(v.extra)) + '</small>' : '') + '</button>'; }).join('') + '</div></div>';
      }).join('');
      var qtyRow = p ? '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><span style="font-size:14px;font-weight:600">Quantité</span>' +
        '<div style="display:flex;align-items:center;border:1px solid #ccc;border-radius:8px;overflow:hidden">' +
        '<button type="button" data-q="-1" aria-label="Moins" style="width:44px;height:44px;border:0;background:#f3f4f6;font-size:22px;cursor:pointer">−</button>' +
        '<input name="qty" type="number" min="1" max="99" value="1" inputmode="numeric" aria-label="Quantité" style="width:52px;height:44px;border:0;text-align:center;font-size:17px;font-weight:bold;-moz-appearance:textfield">' +
        '<button type="button" data-q="1" aria-label="Plus" style="width:44px;height:44px;border:0;background:#f3f4f6;font-size:22px;cursor:pointer">+</button></div></div>' +
        '<div data-total style="background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:10px 12px;font-size:14px"></div>' : '';
      el.innerHTML = '<form style="font-family:system-ui,sans-serif;max-width:420px;border:2px solid ' + col + ';border-radius:12px;padding:18px;display:grid;gap:12px">' +
        (c.badge ? '<span style="background:' + col + ';color:#fff;padding:3px 10px;border-radius:99px;width:max-content;font-size:13px">' + esc(c.badge) + '</span>' : '') +
        (p && !el.hasAttribute('data-compact') ? '<b style="font-size:18px">' + esc(el.getAttribute('data-titre') || p.name) + '</b><div>' + (el.getAttribute('data-prix-barre') ? '<s style="color:#888">' + esc(el.getAttribute('data-prix-barre')) + '</s> ' : '') + '<b style="color:' + col + ';font-size:20px">' + esc(el.getAttribute('data-prix') || money(p.price)) + '</b></div>' : '') +
        variants + qtyRow +
        '<small style="color:#555">' + esc(c.subtitle) + '</small>' +
        ['name|Nom complet', 'phone|Téléphone', 'address|Adresse complète', 'city|Ville'].map(function (f) { f = f.split('|');
          return '<input name="' + f[0] + '" placeholder="' + f[1] + '" ' + (f[0] !== 'city' ? 'required' : '') + (f[0] === 'phone' ? ' type="tel" autocomplete="tel"' : '') + ' style="' + inp + '">'; }).join('') +
        '<button data-submit style="background:' + col + ';color:#fff;border:0;padding:14px;border-radius:8px;font-size:17px;font-weight:bold;cursor:pointer">' + esc(c.button) + '</button>' +
        '<small style="text-align:center;color:#555">' + esc(c.guarantee) + '</small><div class="mireb-msg" style="color:#dc2626;font-weight:600"></div></form>';
      var form = el.querySelector('form');
      // Total en direct : (prix + suppléments) × quantité
      function refresh() {
        if (!p) return;
        if (soldOut) { form.querySelector('[data-total]').innerHTML = '<b style="color:#dc2626">Produit épuisé pour le moment</b>'; form.querySelector('[data-submit]').disabled = true; return; }
        // Quantité limitée au stock des valeurs choisies (si suivi)
        var max = 99, unit = +p.price;
        opts.forEach(function (g, gi) { var v = g.values[chosen[gi]]; unit += +v.extra || 0; if (v.stock != null) max = Math.min(max, v.stock); });
        var q = form.qty, n = Math.min(max, Math.max(1, parseInt(q.value, 10) || 1)); if (String(n) !== q.value) q.value = n; q.max = max;
        form.querySelector('[data-total]').innerHTML = (n > 1 || opts.length ? esc(money(unit)) + ' × ' + n + ' = ' : '') +
          '<b style="font-size:18px;color:' + col + '">' + esc(money(unit * n)) + '</b><br><span style="color:#555">à payer à la livraison</span>' +
          (max <= 5 ? '<br><span style="color:#c2410c;font-weight:600">🔥 Plus que ' + max + ' en stock</span>' : '');
      }
      form.addEventListener('click', function (e) {
        var t = e.target.closest ? e.target.closest('button') : null; if (!t) return;
        if (t.hasAttribute('data-q')) { form.qty.value = (parseInt(form.qty.value, 10) || 1) + +t.getAttribute('data-q'); refresh(); }
        if (t.hasAttribute('data-g') && !t.disabled) {
          var gi = +t.getAttribute('data-g'), vi = +t.getAttribute('data-v'); chosen[gi] = vi;
          form.querySelectorAll('[data-g="' + gi + '"]:not([disabled])').forEach(function (b) { b.style.borderColor = +b.getAttribute('data-v') === vi ? col : '#ddd'; });
          form.querySelector('[data-vl="' + gi + '"]').textContent = opts[gi].values[vi].label; refresh();
        }
      });
      if (p) form.qty.addEventListener('input', refresh);
      refresh();
      el.querySelector('form').onsubmit = function (e) {
        e.preventDefault(); var f = e.target, b = f.querySelector('[data-submit]'), d = Object.fromEntries(new FormData(f));
        d.product_id = pid; d.canal = canal; b.disabled = true;
        d.options = {}; opts.forEach(function (g, gi) { d.options[g.name] = g.values[chosen[gi]].label; });
        fetch(base + '/public/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) })
          .then(function (r) { return r.json(); }).then(function (r) {
            if (!r.ok) { f.querySelector('.mireb-msg').textContent = r.error; b.disabled = false; return; }
            f.innerHTML = '<h3 style="color:' + col + '">✅ Commande reçue (n°' + r.id + ')</h3><p>' + esc(r.message) + '</p><p><a style="color:' + col + ';font-weight:bold" href="' + base + '/suivi?n=' + r.id + '">🚚 Suivre ma commande</a></p>';
            // Pixel Meta sur notre site : même event_id que l'API Conversions du serveur (pas de double comptage)
            if (window.fbq && base === location.origin) fbq('track', 'Purchase', { value: r.value, currency: r.currency, content_type: 'product',
              content_ids: r.content_id ? [r.content_id] : [], num_items: +d.qty || 1 }, { eventID: 'order-' + r.id });
            // Sur notre site (boutique, page commande) : proposer les notifications de suivi du colis
            if (r.track && window.MirebPush && base === location.origin && (MirebPush.supported() || MirebPush.needsInstall())) {
              var pb = document.createElement('button'); pb.type = 'button'; pb.textContent = '🔔 Me prévenir quand mon colis arrive';
              pb.style.cssText = 'background:#1A56DB;color:#fff;border:0;padding:12px 14px;border-radius:8px;font-size:15px;font-weight:bold;cursor:pointer;width:100%';
              f.appendChild(pb); MirebPush.button(pb, '/public/push/subscribe', { order_id: r.id, token: r.track });
            }
          });
      };
    });
  }
  document.querySelectorAll('[data-mireb-form]').forEach(mount);
})();
