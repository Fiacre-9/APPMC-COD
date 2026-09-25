// Markdown minimal et sûr pour les descriptions produits (serveur + aperçu navigateur).
// Tout le texte est échappé AVANT la mise en forme : aucun HTML saisi par un vendeur n'est interprété.
// Pris en charge : # titres, **gras**, *italique*, `code`, [lien](https://…), ![image](https://…),
// listes - / 1., > citation, --- séparateur, retours à la ligne, liens nus cliquables,
// vidéo YouTube / TikTok / Instagram / Facebook / Vimeo seule sur sa ligne → lecteur intégré.
(function (root) {
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  // Seules les adresses http(s) et les images hébergées ici sont acceptées (pas de javascript:)
  var safeUrl = function (u) { return /^(https?:\/\/|\/uploads\/)[^\s]*$/i.test(u) ? u : ''; };

  // Vidéo d'un réseau social seule sur sa ligne → lecteur intégré (l'identifiant est vérifié, jamais d'URL brute dans l'iframe)
  function embed(line) {
    var u = line.trim().replace(/&amp;/g, '&'), m, src, tall = false;
    if ((m = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/.exec(u))) {
      src = 'https://www.youtube-nocookie.com/embed/' + m[1]; tall = /\/shorts\//.test(u);
    } else if ((m = /^https?:\/\/(?:www\.)?tiktok\.com\/@[\w.-]+\/video\/(\d{6,25})/.exec(u))) {
      src = 'https://www.tiktok.com/embed/v2/' + m[1]; tall = true;
    } else if ((m = /^https?:\/\/(?:www\.)?instagram\.com\/(p|reel|tv)\/([\w-]{5,40})/.exec(u))) {
      src = 'https://www.instagram.com/' + m[1] + '/' + m[2] + '/embed'; tall = true;
    } else if ((m = /^https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\/(?:[\w.-]+\/videos\/(?:[\w.-]+\/)?(\d{6,25})|watch\/?\?v=(\d{6,25})|reel\/(\d{6,25}))/.exec(u))) {
      var vid = m[1] || m[2] || m[3]; tall = !!m[3];
      src = 'https://www.facebook.com/plugins/video.php?href=' + encodeURIComponent('https://www.facebook.com/' + (m[3] ? 'reel/' : 'watch/?v=') + vid) + '&show_text=false';
    } else if ((m = /^https?:\/\/(?:www\.)?vimeo\.com\/(\d{5,15})/.exec(u))) {
      src = 'https://player.vimeo.com/video/' + m[1];
    }
    if (!src) return '';
    return '<div class="mdv" style="position:relative;width:100%;max-width:' + (tall ? '340px' : '640px') + ';aspect-ratio:' + (tall ? '9/16' : '16/9') +
      ';margin:12px auto;border-radius:12px;overflow:hidden;background:#000"><iframe src="' + src.replace(/&/g, '&amp;') + '" loading="lazy" allowfullscreen ' +
      'allow="autoplay; encrypted-media; picture-in-picture; clipboard-write" referrerpolicy="strict-origin-when-cross-origin" ' +
      'style="position:absolute;inset:0;width:100%;height:100%;border:0" title="Vidéo"></iframe></div>';
  }
  // Liens nus (https://…) rendus cliquables ; réseaux sociaux reconnus avec leur icône
  var SOCIAL = [[/(^|\.)facebook\.com$|^fb\.(watch|me)$/, '📘 Facebook'], [/(^|\.)instagram\.com$/, '📸 Instagram'], [/(^|\.)tiktok\.com$/, '🎵 TikTok'],
    [/(^|\.)(youtube\.com|youtu\.be)$/, '▶️ YouTube'], [/^(wa\.me|chat\.whatsapp\.com|(www\.)?whatsapp\.com)$/, '💬 WhatsApp'], [/(^|\.)(twitter|x)\.com$/, '𝕏'],
    [/^t\.me$/, '✈️ Telegram'], [/(^|\.)snapchat\.com$/, '👻 Snapchat'], [/(^|\.)linkedin\.com$/, '💼 LinkedIn']];
  function autolink(t) {
    return t.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)'])/g, function (all, pre, url) {
      var host = (/^https?:\/\/([^/?#:]+)/i.exec(url) || [])[1] || '', label = url.replace(/^https?:\/\/(www\.)?/, '');
      for (var i = 0; i < SOCIAL.length; i++) if (SOCIAL[i][0].test(host.toLowerCase().replace(/^www\./, ''))) { label = SOCIAL[i][1]; break; }
      if (label.length > 45) label = label.slice(0, 42) + '…';
      return pre + '<a href="' + url + '" target="_blank" rel="noopener nofollow">' + label + '</a>';
    });
  }

  function inline(t) {
    return autolink(t
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (m, alt, u) {
        return safeUrl(u) ? '<img src="' + u + '" alt="' + alt + '" loading="lazy">' : m;
      })
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, txt, u) {
        return safeUrl(u) ? '<a href="' + u + '" target="_blank" rel="noopener nofollow">' + txt + '</a>' : m;
      })
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, '$1<em>$2</em>'));
  }

  function render(src) {
    var lines = esc(src).replace(/\r/g, '').split('\n'), out = [], para = [], list = null;
    var flushPara = function () { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
    var flushList = function () { if (list) { out.push('<' + list.tag + '>' + list.items.map(function (i) { return '<li>' + inline(i) + '</li>'; }).join('') + '</' + list.tag + '>'); list = null; } };
    lines.forEach(function (l) {
      var m;
      if (!l.trim()) { flushPara(); flushList(); return; }
      var v = embed(l); if (v) { flushPara(); flushList(); out.push(v); return; }
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
