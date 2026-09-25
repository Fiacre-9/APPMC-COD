// Markdown minimal et sûr pour les descriptions produits (serveur + aperçu navigateur).
// Tout le texte est échappé AVANT la mise en forme : aucun HTML saisi par un vendeur n'est interprété.
// Pris en charge : # titres, **gras**, *italique*, `code`, [lien](https://…), ![image](https://…),
// listes - / 1., > citation, --- séparateur, retours à la ligne.
(function (root) {
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  // Seules les adresses http(s) et les images hébergées ici sont acceptées (pas de javascript:)
  var safeUrl = function (u) { return /^(https?:\/\/|\/uploads\/)[^\s]*$/i.test(u) ? u : ''; };

  function inline(t) {
    return t
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (m, alt, u) {
        return safeUrl(u) ? '<img src="' + u + '" alt="' + alt + '" loading="lazy">' : m;
      })
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, txt, u) {
        return safeUrl(u) ? '<a href="' + u + '" target="_blank" rel="noopener nofollow">' + txt + '</a>' : m;
      })
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, '$1<em>$2</em>');
  }

  function render(src) {
    var lines = esc(src).replace(/\r/g, '').split('\n'), out = [], para = [], list = null;
    var flushPara = function () { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
    var flushList = function () { if (list) { out.push('<' + list.tag + '>' + list.items.map(function (i) { return '<li>' + inline(i) + '</li>'; }).join('') + '</' + list.tag + '>'); list = null; } };
    lines.forEach(function (l) {
      var m;
      if (!l.trim()) { flushPara(); flushList(); return; }
      if ((m = /^(#{1,3})\s+(.*)$/.exec(l))) { flushPara(); flushList(); var n = m[1].length + 1; out.push('<h' + n + '>' + inline(m[2]) + '</h' + n + '>'); return; }
      if (/^\s*(---+|\*\*\*+)\s*$/.test(l)) { flushPara(); flushList(); out.push('<hr>'); return; }
      if ((m = /^&gt;\s?(.*)$/.exec(l))) { flushPara(); flushList(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>'); return; }
      if ((m = /^\s*(?:[-*•]|✅|✔️?)\s+(.*)$/.exec(l))) {
        flushPara(); if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; }
        list.items.push(/^\s*(✅|✔)/.test(l) ? '✅ ' + m[1] : m[1]); return;
      }
      if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(l))) {
        flushPara(); if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; }
        list.items.push(m[1]); return;
      }
      flushList(); para.push(l);
    });
    flushPara(); flushList();
    return out.join('\n');
  }

  var api = { render: render, escape: esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MirebMarkdown = api;
})(this);
