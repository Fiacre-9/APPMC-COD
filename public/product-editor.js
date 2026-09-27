// Éditeur de produit partagé (espace vendeur + admin) : photos, prix, catégorie, variantes avec stock, descriptions Markdown.
// ProductEditor.open({ product, categories, vendors?, title?, save: async (données) => ({ id }), fileUrl: id => url, done: () => … })
// La page doit fournir modal(html), closeModal(), toast(msg) et charger /markdown.js.
(function () {
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var q = function (s) { return document.querySelector('#pe ' + s); };
  var photosOf = function (p) { try { var g = JSON.parse(p.gallery || '[]'); return g.length ? g : (p.image ? [p.image] : []); } catch (e) { return p.image ? [p.image] : []; } };
  var optsOf = function (p) { try { return JSON.parse(p.options || '[]'); } catch (e) { return []; } };
  var PE = window.PE = window.ProductEditor = { pics: [], opts: [], cfg: null };

  // ---------- Photos (6 max, redimensionnées à 1200 px) ----------
  PE.drawPics = function () {
    q('.pics').innerHTML = PE.pics.map(function (x, i) {
      return '<div class="pic"><img src="' + esc(x.url || x.data) + '">' + (i ? '' : '<span>Principale</span>') +
        '<button type="button" class="gray" onclick="PE.pics.splice(' + i + ',1);PE.drawPics()">✕</button></div>'; }).join('') +
      (PE.pics.length < 6 ? '<div class="addpic" onclick="document.querySelector(\'#pe-file\').click()">＋</div>' : '');
  };
  PE.addPics = function (input) {
    [].slice.call(input.files, 0, 6 - PE.pics.length).forEach(function (f) {
      var img = new Image(); img.onload = function () {
        var k = Math.min(1, 1200 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        if (PE.pics.length < 6) PE.pics.push({ data: c.toDataURL('image/jpeg', 0.85) }); PE.drawPics(); URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(f);
    });
    input.value = '';
  };

  // ---------- Variantes : groupe (Taille…) → valeurs avec supplément et stock ----------
  PE.drawOpts = function () {
    q('.opts').innerHTML = PE.opts.map(function (g, gi) {
      return '<div class="optg"><div class="row"><input placeholder="Nom : Taille, Couleur, Pointure…" value="' + esc(g.name) + '" oninput="PE.opts[' + gi + '].name=this.value">' +
        '<button type="button" class="sm gray" style="flex:0 0 auto" onclick="PE.opts.splice(' + gi + ',1);PE.drawOpts()">Supprimer</button></div>' +
        '<table class="optv"><tr><th>Valeur</th><th>Supplément</th><th>Stock <small>(vide = illimité)</small></th><th></th></tr>' +
        g.values.map(function (v, vi) {
          var f = function (k, ph, type) { return '<input ' + (type ? 'type="number" min="0" step="' + (k === 'extra' ? '0.01' : '1') + '"' : '') + ' placeholder="' + ph + '" value="' + esc(v[k] == null ? '' : v[k]) +
            '" oninput="PE.opts[' + gi + '].values[' + vi + '].' + k + '=this.value">'; };
          return '<tr><td>' + f('label', 'S, Rouge…') + '</td><td>' + f('extra', '0', 1) + '</td><td>' + f('stock', '∞', 1) + '</td>' +
            '<td><button type="button" class="sm gray" onclick="PE.opts[' + gi + '].values.splice(' + vi + ',1);PE.drawOpts()">✕</button></td></tr>'; }).join('') +
        '</table><button type="button" class="sm gray" onclick="PE.opts[' + gi + '].values.push({label:\'\',extra:\'\',stock:\'\'});PE.drawOpts()">+ Valeur</button></div>';
    }).join('') + (PE.opts.length < 5 ? '<button type="button" class="sm gray" onclick="PE.opts.push({name:\'\',values:[{label:\'\',extra:\'\',stock:\'\'}]});PE.drawOpts()">+ Ajouter une variante (taille, couleur, pointure…)</button>' : '');
  };

  // ---------- Barre Markdown ----------
  var ta = function () { return q('.mdtxt'); };
  PE.wrap = function (a, b, ph) { var t = ta(), s = t.selectionStart, e = t.selectionEnd; t.setRangeText(a + (t.value.slice(s, e) || ph) + b, s, e, 'end'); t.focus(); };
  PE.line = function (p) { var t = ta(), s = t.value.lastIndexOf('\n', t.selectionStart - 1) + 1; t.setRangeText(p, s, s, 'end'); t.focus(); };
  PE.video = function () {
    var u = prompt('Lien de la vidéo YouTube, TikTok, Instagram ou Facebook :'); if (!u) return;
    var t = ta(); t.setRangeText((t.selectionStart && t.value[t.selectionStart - 1] !== '\n' ? '\n' : '') + '\n' + u.trim() + '\n\n', t.selectionStart, t.selectionEnd, 'end'); t.focus();
  };
  PE.preview = function () {
    var out = q('.mdprev'), on = out.hidden; out.hidden = !on; ta().hidden = on; q('.mdpv').classList.toggle('on', on);
    if (on) out.innerHTML = window.MirebMarkdown.render(ta().value) || '<span class="mut">Rien à afficher</span>';
  };

  PE.open = function (cfg) {
    var p = cfg.product || { active: 1 }; PE.cfg = cfg;
    PE.pics = photosOf(p).map(function (url) { return { url: url }; });
    PE.opts = optsOf(p).map(function (g) { return { name: g.name, values: g.values.map(function (v) { return { label: v.label, extra: v.extra || '', stock: v.stock == null ? '' : v.stock }; }) }; });
    var lb = function (t) { return '<label class="lb">' + t + '</label>'; };
    window.modal('<h3>' + esc(cfg.title || (p.id ? 'Modifier le produit' : 'Nouveau produit')) + '</h3><form class="f" id="pe" onsubmit="PE.save(event)">' +
      lb('Photos (6 max — la 1re est la photo principale)') + '<div class="pics"></div><input type="file" id="pe-file" accept="image/*" multiple hidden onchange="PE.addPics(this)">' +
      lb('Type de produit') + '<div class="ptype"><label><input type="radio" name="type" value="physical"' + (p.type !== 'digital' ? ' checked' : '') + ' onchange="PE.kind()"> 📦 Physique<small>Paiement à la livraison</small></label>' +
        '<label><input type="radio" name="type" value="digital"' + (p.type === 'digital' ? ' checked' : '') + ' onchange="PE.kind()"> 📥 Numérique<small>Payé en ligne (FlexPay), téléchargé</small></label></div>' +
      '<div class="pdig f" style="gap:8px">' + lb('Fichier à livrer (PDF, EPUB, ZIP, MP3, MP4… 100 Mo max)') +
        '<input type="file" class="pe-dfile" onchange="PE.dfile=this.files[0]||null">' + (p.digital_name ? '<small class="mut" style="display:block">Fichier actuel : 📎 ' + esc(p.digital_name) + ' (choisir un fichier le remplace)</small>' : '') +
        lb('…ou lien d\'accès (Google Drive, cours en ligne…) donné après paiement') + '<input name="digital_url" placeholder="https://…" value="' + esc(p.digital_url) + '">' +
        lb('Instructions affichées après paiement (Markdown, facultatif)') + '<textarea name="digital_note" rows="2" placeholder="Ex : mot de passe du cours, lien du groupe WhatsApp…">' + esc(p.digital_note) + '</textarea></div>' +
      lb('Nom du produit') + '<input name="name" value="' + esc(p.name) + '" required>' +
      '<div class="row"><div>' + lb('Prix de vente') + '<input name="price" type="number" step="0.01" min="0" value="' + (p.price == null ? '' : p.price) + '" required></div>' +
      '<div>' + lb('Ancien prix (barré)') + '<input name="compare_price" type="number" step="0.01" min="0" value="' + (p.compare_price == null ? '' : p.compare_price) + '"></div></div>' +
      '<div class="row"><div>' + lb('Catégorie') + '<select name="category"><option value="">— Choisir —</option>' + (cfg.categories || []).map(function (c) {
        return '<option value="' + esc(c.slug) + '"' + (c.slug === p.category ? ' selected' : '') + '>' + esc(c.icon) + ' ' + esc(c.name) + '</option>'; }).join('') + '</select></div>' +
      '<div class="pphys">' + lb('Stock du produit') + '<input name="stock" type="number" min="0" value="' + (p.stock == null ? '' : p.stock) + '"></div></div>' +
      (cfg.vendors ? lb('Vendeur') + '<select name="vendor_id"><option value="">— Boutique principale (aucun vendeur) —</option>' + cfg.vendors.map(function (v) {
        return '<option value="' + v.id + '"' + (v.id === p.vendor_id ? ' selected' : '') + '>' + esc(v.shop_name) + '</option>'; }).join('') + '</select>' : '') +
      '<div class="pphys f" style="gap:8px">' + lb('Variantes — supplément ajouté au prix ; stock vide = non suivi') + '<div class="opts f" style="gap:8px"></div></div>' +
      lb('Courte description (affichée au-dessus du formulaire)') + '<textarea name="short_description" rows="2" placeholder="Ex : Sac en cuir véritable, livraison 24h à Kinshasa.">' + esc(p.short_description) + '</textarea>' +
      lb('Description complète — Markdown') + '<div class="mdbar"><button type="button" onclick="PE.wrap(\'**\',\'**\',\'gras\')"><b>B</b></button><button type="button" onclick="PE.wrap(\'*\',\'*\',\'italique\')"><i>I</i></button>' +
      '<button type="button" onclick="PE.line(\'## \')">Titre</button><button type="button" onclick="PE.line(\'- \')">• Liste</button><button type="button" onclick="PE.line(\'✅ \')">✅</button>' +
      '<button type="button" onclick="PE.line(\'> \')">❝ Citation</button><button type="button" onclick="PE.wrap(\'[\',\'](https://)\',\'texte du lien\')">🔗 Lien</button>' +
      '<button type="button" onclick="PE.video()">🎬 Vidéo</button><button type="button" class="mdpv" onclick="PE.preview()">👁 Aperçu</button></div>' +
      '<textarea name="description" class="mdtxt" rows="9" placeholder="## Pourquoi choisir ce produit ?&#10;- **Qualité** premium&#10;&#10;Collez un lien YouTube / TikTok / Instagram / Facebook seul sur une ligne : la vidéo s\'affiche.">' + esc(p.description) + '</textarea>' +
      '<div class="mdprev" hidden></div>' +
      '<label><input type="checkbox" name="active" style="width:auto"' + (p.active ? ' checked' : '') + '> Visible dans la boutique</label>' +
      '<button class="pe-save">Enregistrer</button></form>');
    PE.dfile = null; PE.drawPics(); PE.drawOpts(); PE.kind();
  };
  // Physique : stock + variantes ; numérique : fichier / lien à livrer
  PE.kind = function () {
    var dig = document.querySelector('#pe [name=type]:checked').value === 'digital';
    document.querySelectorAll('#pe .pdig').forEach(function (e) { e.hidden = !dig; });
    document.querySelectorAll('#pe .pphys').forEach(function (e) { e.hidden = dig; });
  };

  PE.save = function (e) {
    e.preventDefault(); var f = e.target, d = Object.fromEntries(new FormData(f)), btn = f.querySelector('.pe-save');
    d.active = f.active.checked ? 1 : 0;
    d.compare_price = d.compare_price === '' ? null : +d.compare_price; d.stock = +d.stock || 0; d.price = +d.price;
    // L'ordre des photos est conservé : existantes gardées puis nouvelles
    d.gallery_keep = PE.pics.filter(function (x) { return x.url; }).map(function (x) { return x.url; });
    d.gallery_new = PE.pics.filter(function (x) { return x.data; }).map(function (x) { return x.data; });
    d.options = PE.opts.map(function (g) { return { name: String(g.name).trim(), values: g.values.filter(function (v) { return String(v.label).trim(); })
      .map(function (v) { return { label: String(v.label).trim(), extra: +v.extra || 0, stock: v.stock === '' ? null : +v.stock }; }) }; })
      .filter(function (g) { return g.name && g.values.length; });
    if (d.type === 'digital') { d.options = []; if (!PE.dfile && !d.digital_url && !(PE.cfg.product || {}).digital_name) { alert('Ajoutez le fichier à livrer ou un lien d\'accès.'); return; } }
    btn.disabled = true; btn.textContent = 'Enregistrement…';
    var id = (PE.cfg.product || {}).id, file = d.type === 'digital' ? PE.dfile : null;
    Promise.resolve(PE.cfg.save(d)).then(function (r) {
      // Le fichier numérique est envoyé après l'enregistrement (il faut l'identifiant du produit)
      if (!file) return;
      btn.textContent = 'Envoi du fichier… (' + Math.ceil(file.size / 1048576) + ' Mo)';
      return fetch(PE.cfg.fileUrl((r && r.id) || id), { method: 'POST', credentials: 'same-origin', body: file,
        headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) } })
        .then(function (x) { return x.json(); }).then(function (j) { if (j.error) throw new Error(j.error); });
    }).then(function () { window.toast('Produit enregistré'); window.closeModal(); if (PE.cfg.done) PE.cfg.done(); },
      function (e) { if (e && e.message) alert(e.message); if (PE.cfg.done) PE.cfg.done(); })
      .then(function () { btn.disabled = false; btn.textContent = 'Enregistrer'; });
  };
})();
