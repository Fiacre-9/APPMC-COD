// Pages publiques au design du thème Mireb COD : accueil boutique, recherche/catégories,
// page produit (galerie + formulaire COD + description Markdown), boutique vendeur, suivi de commande
const router = require('express').Router();
const { db, getSetting, categories, STATUSES } = require('../db');
const md = require('../../public/markdown.js');
const push = require('../push');

const esc = md.escape;
const money = n => `${(+n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${process.env.CURRENCY || '$'}`;
const shopName = () => getSetting('shop_name', '') || 'Mireb';
const catMap = () => Object.fromEntries(categories().map(c => [c.slug, c]));
const VISIBLE = 'p.active=1 AND (p.vendor_id IS NULL OR v.active=1)';
const FROM = 'FROM products p LEFT JOIN vendors v ON v.id=p.vendor_id';
const pct = p => p.compare_price > p.price ? Math.round((1 - p.price / p.compare_price) * 100) : 0;
const photos = p => { try { const g = JSON.parse(p.gallery || '[]'); return g.length ? g : (p.image ? [p.image] : []); } catch { return p.image ? [p.image] : []; } };
const LABEL = { nouveau: 'Commande reçue', en_confirmation: 'En confirmation', confirme: 'Confirmée', en_preparation: 'En préparation',
  expedie: 'Expédiée', en_livraison: 'En cours de livraison', livre: 'Livrée', paye: 'Livrée', annule: 'Annulée', retourne: 'Retournée' };

const CSS = `
:root{--p:#1A56DB;--pd:#1543B0;--a:#E8342A;--ad:#C42820;--dk:#0F172A;--g:#64748B;--l:#F8FAFC;--b:#E2E8F0;--ok:#16A34A;--h:60px;
  --sh:0 4px 20px rgba(0,0,0,.12)}
*,*::before,*::after{box-sizing:border-box}html{scroll-behavior:smooth}[hidden]{display:none!important}
body{margin:0;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;color:var(--dk);background:var(--l);
  -webkit-font-smoothing:antialiased;padding-top:var(--h);padding-bottom:68px}
a{color:inherit;text-decoration:none}img{max-width:100%;display:block}
.hd{position:fixed;top:0;left:0;right:0;height:var(--h);background:#fff;border-bottom:1px solid var(--b);box-shadow:0 1px 8px rgba(0,0,0,.06);
  z-index:50;display:flex;align-items:center;gap:10px;padding:0 12px}
.logo{flex-shrink:0;line-height:1}.logo b{display:block;font-size:18px;font-weight:800;color:var(--p);letter-spacing:-.02em}
.logo small{display:block;font-size:9px;font-weight:600;color:var(--a);letter-spacing:.06em;margin-top:2px}
.srch{flex:1;display:flex;height:38px;background:var(--l);border:1.5px solid var(--b);border-radius:20px;overflow:hidden;max-width:560px;margin:0 auto}
.srch:focus-within{border-color:var(--p)}.srch input{flex:1;min-width:0;border:0;background:transparent;padding:0 12px;font:inherit;font-size:13px;outline:0}
.srch button{width:40px;border:0;background:var(--p);color:#fff;font-size:15px;cursor:pointer}
.hic{width:38px;height:38px;display:flex;align-items:center;justify-content:center;border-radius:8px;font-size:18px;flex-shrink:0}.hic:hover{background:var(--l)}
.cnav{background:#fff;border-bottom:1px solid var(--b);overflow-x:auto;scrollbar-width:none;position:sticky;top:var(--h);z-index:40}
.cnav::-webkit-scrollbar{display:none}.cnav div{display:flex;padding:0 8px;min-width:max-content}
.cnav a{display:inline-flex;align-items:center;gap:5px;padding:10px 12px;font-size:12px;font-weight:600;color:var(--g);border-bottom:2px solid transparent;white-space:nowrap}
.cnav a:hover,.cnav a.on{color:var(--p);border-bottom-color:var(--p)}.cnav span{font-size:15px}
.wrap{max-width:1200px;margin:0 auto}
.hero{background:linear-gradient(135deg,var(--p) 0%,var(--pd) 60%,#0F2E8A 100%);padding:30px 16px 26px;text-align:center;color:#fff;position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;top:-40px;right:-40px;width:200px;height:200px;background:rgba(255,255,255,.06);border-radius:50%}
.hero::after{content:'';position:absolute;bottom:-30px;left:-20px;width:150px;height:150px;background:rgba(255,255,255,.05);border-radius:50%}
.hero>*{position:relative;z-index:1}.hbadge{display:inline-block;background:var(--a);font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:3px 10px;border-radius:20px;margin-bottom:10px}
.hero h1{font-size:1.6rem;font-weight:800;margin:0 0 8px;line-height:1.2}.hero h1 span{font-size:.62em;font-weight:600;opacity:.9}
.hero p{font-size:.87rem;opacity:.88;margin:0 0 16px}.hbtns{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
.btn{display:inline-flex;align-items:center;gap:6px;padding:10px 20px;border-radius:8px;font-size:.87rem;font-weight:700;border:0;cursor:pointer;font-family:inherit}
.btn.w{background:#fff;color:var(--p)}.btn.r{background:var(--a);color:#fff;box-shadow:0 4px 14px rgba(232,52,42,.35)}.btn.r:hover{background:var(--ad)}
.qi{background:#fff;padding:14px 12px;display:grid;grid-template-columns:repeat(4,1fr);gap:8px;border-bottom:1px solid var(--b)}
.qi a{display:flex;flex-direction:column;align-items:center;gap:6px;font-size:11px;font-weight:600;text-align:center}
.qi i{width:46px;height:46px;background:linear-gradient(135deg,#EEF2FF,#E0EAFF);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:21px;font-style:normal;transition:transform .15s}
.qi a:hover i{transform:scale(1.06)}
.strip{background:linear-gradient(90deg,var(--a),#F97316);color:#fff;text-align:center;font-size:12px;padding:9px 12px}
.sec{background:#fff;margin:8px 0}.sh{display:flex;align-items:center;justify-content:space-between;padding:14px 14px 10px;border-bottom:1px solid var(--b)}
.st{font-size:1rem;font-weight:800;margin:0;display:flex;align-items:center;gap:6px}.st::before{content:'';width:3px;height:16px;background:var(--a);border-radius:2px}
.sl{font-size:12px;font-weight:600;color:var(--p)}.sl::after{content:' ›';font-size:15px}.sc{font-size:12px;color:var(--g)}
.cats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:14px}
.cats a{display:flex;flex-direction:column;align-items:center;gap:6px;font-size:11px;font-weight:600;text-align:center}
.cats i{width:48px;height:48px;border-radius:50%;background:var(--l);border:1px solid var(--b);display:flex;align-items:center;justify-content:center;font-size:22px;font-style:normal}
.cats a:hover i{border-color:var(--p);background:#EEF2FF}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:1px;background:var(--b)}
.scroll{display:flex;gap:1px;overflow-x:auto;scrollbar-width:none;background:var(--b)}.scroll::-webkit-scrollbar{display:none}.scroll .card{flex:0 0 160px}
.card{background:#fff;display:flex;flex-direction:column;position:relative;overflow:hidden;transition:box-shadow .15s}.card:hover{z-index:1;box-shadow:var(--sh)}
.iw{position:relative;background:#f9f9f9;aspect-ratio:1;overflow:hidden}.iw img{width:100%;height:100%;object-fit:cover;transition:transform .3s}
.card:hover .iw img{transform:scale(1.04)}.noimg{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:48px;color:#cbd5e1}
.bdg{position:absolute;top:6px;left:6px;background:var(--a);color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;z-index:1}.bdg.new{background:var(--p)}
.cb{padding:8px 10px 10px;flex:1;display:flex;flex-direction:column}
.ct{font-size:12px;font-weight:500;line-height:1.4;margin:0 0 6px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pr{display:flex;align-items:center;gap:6px;margin-top:auto;flex-wrap:wrap}.pn{font-size:14px;font-weight:800;color:var(--a)}.po{font-size:11px;color:#aaa;text-decoration:line-through}
.cod{display:flex;align-items:center;justify-content:center;gap:5px;margin:0 10px 10px;padding:8px;background:var(--a);color:#fff;border-radius:6px;font-size:11px;font-weight:700;
  text-transform:uppercase;letter-spacing:.04em;animation:pulse 2.5s ease-in-out infinite}.cod:hover{background:var(--ad);animation:none}
@keyframes pulse{0%,100%{box-shadow:0 2px 8px rgba(232,52,42,.3)}50%{box-shadow:0 4px 14px rgba(232,52,42,.5)}}
.empty{text-align:center;color:var(--g);padding:40px 16px;background:#fff}
.chips{display:flex;gap:6px;overflow-x:auto;padding:10px 12px;background:#fff;border-bottom:1px solid var(--b);scrollbar-width:none}
.sort{border:1px solid var(--b);border-radius:8px;padding:5px 8px;font:inherit;font-size:12px;background:#fff;margin-left:8px;max-width:150px}
.sh>span.sc{margin-left:auto}.allbtn{background:#fff;padding:16px;text-align:center;margin:8px 0}.allbtn .btn{justify-content:center;width:100%;max-width:420px}
.chips small{opacity:.7;font-weight:500}.chips a{flex-shrink:0;padding:6px 12px;border:1px solid var(--b);border-radius:99px;font-size:12px;font-weight:600;color:var(--g)}.chips a.on{background:var(--p);border-color:var(--p);color:#fff}
.vhead{background:#fff;padding:18px 14px;border-bottom:1px solid var(--b);display:flex;gap:12px;align-items:center}
.vav{width:54px;height:54px;border-radius:50%;background:linear-gradient(135deg,var(--p),var(--pd));color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;flex-shrink:0}
.vhead h1{margin:0;font-size:1.2rem}.vhead p{margin:4px 0 0;color:var(--g);font-size:13px}
/* Page produit */
.sp{background:#fff}.gal{background:#f5f5f5;position:relative}.mi{aspect-ratio:1;position:relative;background:#fff}.mi img{width:100%;height:100%;object-fit:contain}
.stk{position:absolute;top:10px;left:10px;font-size:10px;font-weight:700;padding:3px 8px;border-radius:4px;color:#fff;background:var(--ok)}
.spc{position:absolute;top:10px;right:10px;background:var(--a);color:#fff;font-weight:800;font-size:13px;padding:4px 9px;border-radius:6px}
.th{display:flex;gap:8px;padding:10px;overflow-x:auto;background:#fff;border-top:1px solid var(--b)}
.th button{flex:0 0 58px;height:58px;padding:0;border:2px solid var(--b);border-radius:8px;overflow:hidden;background:#fff;cursor:pointer}.th button.on{border-color:var(--p)}
.th img{width:100%;height:100%;object-fit:cover}
.inf{padding:16px 14px}.cat{font-size:12px;color:var(--p);font-weight:600;margin:0 0 6px}.inf h1{font-size:1.25rem;font-weight:800;margin:0 0 10px;line-height:1.3}
.spr{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:6px}.spr b{font-size:1.7rem;font-weight:800;color:var(--a)}.spr s{color:#94a3b8;font-size:1rem}
.save{font-size:12px;font-weight:700;color:var(--a);background:#FEF2F2;padding:2px 8px;border-radius:4px}
.by{font-size:13px;color:var(--g);margin:0 0 12px}.by a{color:var(--p);font-weight:600}
.short{color:#334155;line-height:1.6;margin:0 0 14px}
#mireb-commande{scroll-margin-top:calc(var(--h) + 12px)}#mireb-commande form{max-width:none!important}
.perks{display:flex;gap:6px;flex-wrap:wrap;margin-top:14px}.perk{font-size:11px;font-weight:600;padding:5px 10px;border-radius:99px}
.perk.b{background:#EEF2FF;color:var(--p)}.perk.g{background:#F0FDF4;color:var(--ok)}.perk.o{background:#FFF7ED;color:#C2410C}
.desc{background:#fff;margin-top:8px;padding:16px 14px}.desc h2.dt{font-size:1rem;font-weight:800;margin:0 0 12px;display:flex;gap:6px;align-items:center}
.desc h2.dt::before{content:'';width:3px;height:16px;background:var(--a);border-radius:2px}
.md{line-height:1.7;color:#334155;font-size:14.5px}.md h2,.md h3,.md h4{color:var(--dk);margin:18px 0 8px;line-height:1.3}.md h2{font-size:1.2rem}.md h3{font-size:1.05rem}
.md p{margin:0 0 12px}.md ul,.md ol{margin:0 0 12px;padding-left:22px}.md li{margin:4px 0}.md img{border-radius:10px;margin:10px 0;max-width:100%}
.md blockquote{margin:0 0 12px;padding:10px 14px;border-left:4px solid var(--p);background:#EEF2FF;border-radius:0 8px 8px 0;color:var(--dk)}
.md hr{border:0;border-top:1px solid var(--b);margin:16px 0}.md a{color:var(--p);text-decoration:underline}.md code{background:var(--l);padding:1px 6px;border-radius:4px}
.cta{padding:14px;background:#fff;margin-top:1px}.cta a{display:flex;justify-content:center;align-items:center;gap:6px;background:var(--a);color:#fff;font-weight:800;
  padding:15px;border-radius:10px;font-size:15px;text-align:center;animation:pulse 2.5s ease-in-out infinite}
/* Suivi */
.box{background:#fff;margin:8px 0;padding:18px 14px}.box h1{font-size:1.2rem;margin:0 0 6px}.box p{color:var(--g);margin:0 0 14px}
.box form{display:grid;gap:10px;max-width:420px}.box input{padding:12px;border:1.5px solid var(--b);border-radius:8px;font:inherit;font-size:15px}.box input:focus{outline:0;border-color:var(--p)}
.steps{list-style:none;padding:0;margin:16px 0 0;max-width:460px}.steps li{display:flex;gap:10px;align-items:center;padding:8px 0;color:#94a3b8;font-weight:600}
.steps li i{width:26px;height:26px;border-radius:50%;background:var(--b);display:flex;align-items:center;justify-content:center;font-style:normal;font-size:12px;color:#fff;flex-shrink:0}
.steps li.ok{color:var(--dk)}.steps li.ok i{background:var(--ok)}.steps li.ko i{background:var(--a)}.steps small{font-weight:400;color:var(--g);margin-left:auto}
.err{color:var(--a);font-weight:600}
/* Pied de page + menu du bas */
.ft{background:var(--dk);color:#cbd5e1;padding:24px 16px;text-align:center;font-size:12px;margin-top:8px}.ft b{color:#fff;font-size:15px}.ft a{color:#fff;text-decoration:underline}
.tr{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;background:#fff;padding:14px 10px;text-align:center;font-size:11px;font-weight:600;border-top:1px solid var(--b)}
.tr span{display:block;font-size:20px;margin-bottom:4px}
.bn{position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid var(--b);display:flex;z-index:50;box-shadow:0 -2px 12px rgba(0,0,0,.08);padding-bottom:env(safe-area-inset-bottom)}
.bn a{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 2px 9px;color:var(--g);font-size:10px;font-weight:600}
.bn a.on{color:var(--p)}.bn a span{font-size:19px;line-height:1}.bn a.cmd{color:#fff;background:var(--a);margin:-5px 3px 0;border-radius:12px 12px 0 0;font-weight:700;animation:pulse 2.5s ease-in-out infinite}
@media(min-width:768px){:root{--h:70px}.grid{grid-template-columns:repeat(3,1fr)}.cats{grid-template-columns:repeat(6,1fr)}.qi{grid-template-columns:repeat(4,1fr);max-width:640px;margin:0 auto}
  .hero{padding:44px 16px 38px}.hero h1{font-size:2.2rem}.logo b{font-size:21px}
  .sp{display:grid;grid-template-columns:1fr 1fr;gap:0;align-items:start}.gal{position:sticky;top:calc(var(--h) + 8px)}.inf{padding:24px}.inf h1{font-size:1.6rem}}
@media(min-width:1024px){.grid{grid-template-columns:repeat(4,1fr)}.bn{display:none}body{padding-bottom:0}.wrap{padding:0 12px}.scroll .card{flex-basis:200px}}
`;

// Script de page : galerie, bouton « Commander maintenant » (défile + curseur dans le 1er champ)
const JS = `document.querySelectorAll('.th button').forEach(function(b){b.onclick=function(){
  document.getElementById('mimg').src=b.dataset.src;document.querySelectorAll('.th button').forEach(function(x){x.classList.toggle('on',x===b)})}});
function goForm(){var f=document.getElementById('mireb-commande');if(!f)return;f.scrollIntoView({behavior:'smooth',block:'start'});
  var i=f.querySelector('input');if(i)setTimeout(function(){i.focus({preventScroll:true})},450)}
document.querySelectorAll('[data-goto-form]').forEach(function(a){a.onclick=function(e){e.preventDefault();goForm()}});
var fm=document.getElementById('mireb-commande');if(fm&&location.hash==='#mireb-commande'){new MutationObserver(function(m,o){if(fm.querySelector('input')){o.disconnect();goForm()}}).observe(fm,{childList:true,subtree:true})}`;

// Pixel Meta (réglé dans Admin → Marketing) ; `track` = événement de la page, ex. ViewContent d'un produit du catalogue
function pixel(track) {
  const id = getSetting('meta_pixel_id');
  if (!/^\d+$/.test(id || '')) return '';
  return `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${id}');fbq('track','PageView');${track ? `fbq('track',${JSON.stringify(track[0])},${JSON.stringify(track[1]).replace(/</g, '\\u003c')});` : ''}</script>`;
}

function layout({ title, desc = '', image = '', body, nav = '', active = '', catBar = true, currentCat = '', track = null }) {
  const name = shopName(), base = process.env.BASE_URL || '';
  const catbar = catBar ? `<nav class="cnav" aria-label="Catégories"><div><a href="/boutique" class="${!currentCat && active === 'home' ? 'on' : ''}"><span>🏠</span> Tous</a>
    ${categories().map(c => `<a href="/boutique?cat=${c.slug}" class="${currentCat === c.slug ? 'on' : ''}"><span>${c.icon}</span> ${esc(c.name)}</a>`).join('')}</div></nav>` : '';
  const bn = (k, href, icon, label, cls = '') => `<a href="${href}" class="${cls} ${active === k ? 'on' : ''}"><span>${icon}</span>${label}</a>`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><meta name="theme-color" content="#1A56DB"><link rel="icon" href="/icons/boutique-192.png">
<link rel="manifest" href="/manifests/boutique.json"><link rel="apple-touch-icon" href="/icons/boutique-apple.png">
<meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default"><meta name="apple-mobile-web-app-title" content="${esc(name)}">
<meta property="og:type" content="${nav === 'product' ? 'product' : 'website'}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
${image ? `<meta property="og:image" content="${esc(base + image)}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"><style>${CSS}</style>${pixel(track)}</head><body>
<header class="hd"><a href="/boutique" class="logo"><b>${esc(name.toUpperCase())}</b><small>COD STORE</small></a>
<form class="srch" action="/boutique" role="search"><input type="search" name="q" placeholder="Rechercher un produit..." aria-label="Rechercher un produit"><button aria-label="Rechercher">🔍</button></form>
<a href="/suivi" class="hic" aria-label="Suivi de commande">🚚</a><a href="/vendeur/" class="hic" aria-label="Espace vendeur">👤</a></header>
${catbar}<main class="wrap">${body}</main>
<div class="wrap"><div class="tr"><div><span>🚚</span>Livraison rapide</div><div><span>💵</span>Paiement à la réception</div><div><span>📞</span>Service client</div></div></div>
<footer class="ft"><b>${esc(name)}</b><br>Commandez en ligne, payez à la livraison.<br><br><a href="/suivi">Suivre ma commande</a> · <a href="/vendeur/#inscription">Vendre sur ${esc(name)}</a> · <a href="/confidentialite">Confidentialité</a>
<br><br><button type="button" class="btn r" data-pwa-install hidden>📲 Installer l'application</button></footer>
<nav class="bn" aria-label="Navigation">${bn('home', '/boutique', '🏠', 'Maison')}${bn('cats', '/boutique#categories', '☰', 'Catégories')}
${bn('', nav === 'product' ? '#mireb-commande" data-goto-form="1' : '/boutique?tout=1', '🛒', 'Commander', 'cmd')}${bn('suivi', '/suivi', '🚚', 'Suivi')}${bn('', '/vendeur/', '👤', 'Vendre')}</nav>
<script>${JS}</script><script src="/pwa.js" data-app="${esc(name)}" data-color="#E8342A" data-icon="/icons/boutique-192.png" data-offset="76"${nav === 'product' ? ' data-auto="0"' : ''}></script></body></html>`;
}

const NEW_DAYS = 14;
const newSince = () => new Date(Date.now() - NEW_DAYS * 864e5).toISOString().slice(0, 19).replace('T', ' ');
const isNewP = (p, since = newSince()) => (p.created_at || '') >= since;
function card(p, isNew = isNewP(p)) {
  const off = pct(p), img = photos(p)[0];
  return `<div class="card"><a href="/p/${esc(p.slug)}"><div class="iw">${img ? `<img src="${esc(img)}" alt="${esc(p.name)}" loading="lazy" decoding="async">` : '<div class="noimg">📦</div>'}
    ${off ? `<span class="bdg">-${off}%</span>` : isNew ? '<span class="bdg new">NOUVEAU</span>' : ''}</div>
    <div class="cb"><p class="ct">${esc(p.name)}</p><div class="pr"><span class="pn">${money(p.price)}</span>${off ? `<s class="po">${money(p.compare_price)}</s>` : ''}</div></div></a>
    <a href="/p/${esc(p.slug)}#mireb-commande" class="cod">🛒 Commander</a></div>`;
}
const section = (title, content, link = '', id = '') => `<section class="sec"${id ? ` id="${id}"` : ''}><div class="sh"><h2 class="st">${title}</h2>${link}</div>${content}</section>`;
const grid = (list, empty = 'Aucun produit pour le moment.') => list.length ? `<div class="grid">${list.map(p => card(p)).join('')}</div>` : `<p class="empty">${empty}</p>`;
const catGrid = () => `<div class="cats">${categories().map(c => `<a href="/boutique?cat=${c.slug}"><i>${c.icon}</i>${esc(c.name)}</a>`).join('')}</div>`;

// ---------- Accueil boutique / recherche / catégorie ----------
const SORTS = { recent: ['Nouveautés', 'p.id DESC'], prix_asc: ['Prix croissant', 'p.price ASC, p.id DESC'],
  prix_desc: ['Prix décroissant', 'p.price DESC, p.id DESC'], promo: ['Meilleures promos', 'CASE WHEN p.compare_price>p.price THEN (p.compare_price-p.price)/p.compare_price ELSE 0 END DESC, p.id DESC'] };
const plural = (n) => `${n} produit${n > 1 ? 's' : ''}`;

// ---------- Liste : tous les produits / catégorie / recherche / promotions (tri + filtres) ----------
function listing(req, res, CAT) {
  const q = String(req.query.q || '').trim().slice(0, 80), cat = CAT[req.query.cat] ? req.query.cat : '';
  const promo = req.query.promo === '1', sort = SORTS[req.query.tri] ? req.query.tri : (promo ? 'promo' : 'recent');
  const w = [VISIBLE], a = [];
  if (cat) { w.push('p.category=?'); a.push(cat); }
  if (promo) w.push('p.compare_price>p.price');
  if (q) { w.push('(p.name LIKE ? OR p.short_description LIKE ?)'); a.push(`%${q}%`, `%${q}%`); }
  const list = db.prepare(`SELECT p.* ${FROM} WHERE ${w.join(' AND ')} ORDER BY ${SORTS[sort][1]} LIMIT 400`).all(...a);
  // Liens qui gardent les autres filtres
  const url = (over) => '/boutique?' + new URLSearchParams(Object.entries({ tout: '1', q, cat, promo: promo ? '1' : '', tri: sort === 'recent' ? '' : sort, ...over })
    .filter(([, v]) => v)).toString();
  const counts = Object.fromEntries(db.prepare(`SELECT p.category c, COUNT(*) n ${FROM} WHERE ${VISIBLE} GROUP BY p.category`).all().map(r => [r.c, r.n]));
  const chips = `<div class="chips"><a href="${esc(url({ cat: '' }))}" class="${cat ? '' : 'on'}">Tout</a>
    ${Object.values(CAT).filter(c => counts[c.slug]).map(c => `<a href="${esc(url({ cat: c.slug }))}" class="${cat === c.slug ? 'on' : ''}">${c.icon} ${esc(c.name)} <small>${counts[c.slug]}</small></a>`).join('')}
    <a href="${esc(url({ promo: promo ? '' : '1' }))}" class="${promo ? 'on' : ''}">🏷️ Promos</a></div>`;
  const sorter = `<select class="sort" aria-label="Trier" onchange="location.href=this.value">${Object.entries(SORTS).map(([k, [l]]) =>
    `<option value="${esc(url({ tri: k === 'recent' ? '' : k }))}" ${k === sort ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const title = q ? `Résultats pour « ${esc(q)} »` : cat ? `${CAT[cat].icon} ${esc(CAT[cat].name)}` : promo ? '🏷️ Promotions' : '🏪 Tous les produits';
  res.send(layout({ title: `${q || (cat ? CAT[cat].name : promo ? 'Promotions' : 'Tous les produits')} — ${shopName()}`, active: 'cats', currentCat: cat,
    body: chips + section(title, grid(list, q ? 'Aucun produit trouvé. Essayez un autre mot.' : 'Aucun produit pour le moment.'),
      `<span class="sc">${plural(list.length)}</span>${sorter}`) }));
}

// ---------- Accueil : chaque produit n'apparaît qu'une fois (Nouveautés → Promotions → sa catégorie) ----------
router.get('/boutique', (req, res) => {
  const CAT = catMap();
  if (req.query.q || req.query.cat || req.query.tout || req.query.promo) return listing(req, res, CAT);
  const all = db.prepare(`SELECT p.* ${FROM} WHERE ${VISIBLE} ORDER BY p.id DESC LIMIT 1000`).all();
  const shown = new Set(), take = (list, n) => { const out = list.filter(p => !shown.has(p.id)).slice(0, n); out.forEach(p => shown.add(p.id)); return out; };
  const since = newSince();
  const news = take(all.filter(p => isNewP(p, since)), 10);
  const promos = take(all.filter(p => pct(p) > 0).sort((x, y) => pct(y) - pct(x)), 10);
  const scroll = (list) => `<div class="scroll">${list.map(p => card(p)).join('')}</div>`;
  const more = (href, n) => `<a class="sl" href="${href}">Voir tout${n ? ` (${n})` : ''}</a>`;
  // Une rangée par catégorie avec les produits pas encore montrés ; « Voir tout » ouvre la catégorie complète
  const rows = [...Object.values(CAT), { slug: '', name: 'Autres produits', icon: '📦' }].map(c => {
    const items = all.filter(p => c.slug ? p.category === c.slug : !CAT[p.category]), rest = take(items, 10);
    return rest.length ? section(`${c.icon} ${esc(c.name)}`, scroll(rest), c.slug ? more(`/boutique?cat=${c.slug}`, items.length) : more('/boutique?tout=1'), c.slug ? `cat-${c.slug}` : 'cat-autres') : '';
  }).join('');
  const nPromo = all.filter(p => pct(p) > 0).length;
  res.send(layout({ title: `${shopName()} — Paiement à la livraison`, desc: 'Commandez en ligne, payez à la réception. Livraison rapide.', active: 'home',
    body: `<section class="hero"><span class="hbadge">🚚 Paiement à la livraison</span>
      <h1>${esc(shopName())}<br><span>Commandez, payez à la réception</span></h1><p>Livraison rapide — aucun paiement en avance</p>
      <div class="hbtns"><a href="#categories" class="btn w">☰ Catégories</a><a href="/boutique?tout=1" class="btn r">🛒 Tous les produits</a></div></section>
    <div class="qi"><a href="#categories"><i>☰</i>Catégories</a><a href="${nPromo ? '/boutique?promo=1' : '/boutique?tout=1'}"><i>🏷️</i>Promotions</a>
      <a href="/boutique?tout=1"><i>🔥</i>Tous les produits</a><a href="/suivi"><i>🚚</i>Suivi commande</a></div>
    <div class="strip">⚡ <b>Paiement à la livraison</b> — vous payez seulement quand vous recevez le colis ⚡</div>
    ${section('Catégories', catGrid(), '', 'categories')}
    ${news.length ? section('🆕 Nouveautés', scroll(news), more('/boutique?tout=1')) : ''}
    ${promos.length ? section('🏷️ Promotions', scroll(promos), more('/boutique?promo=1', nPromo), 'promos') : ''}
    ${rows}
    ${all.length ? `<div class="allbtn"><a class="btn r" href="/boutique?tout=1">🏪 Voir tous les produits (${all.length})</a></div>` : '<p class="empty">Aucun produit pour le moment.</p>'}` }));
});

// ---------- Page produit ----------
router.get('/p/:slug', (req, res) => {
  const p = db.prepare(`SELECT p.*, v.shop_name, v.slug vslug ${FROM} WHERE p.slug=? AND ${VISIBLE}`).get(req.params.slug);
  if (!p) return res.status(404).send(layout({ title: 'Produit introuvable', body: `<p class="empty">Ce produit n'est plus disponible.<br><br><a class="btn r" href="/boutique">Voir la boutique</a></p>` }));
  const off = pct(p), imgs = photos(p), c = catMap()[p.category];
  const canal = /^\d+$/.test(req.query.canal || req.query.mireb_canal || '') ? (req.query.canal || req.query.mireb_canal) : '';
  const related = db.prepare(`SELECT p.* ${FROM} WHERE ${VISIBLE} AND p.id<>? AND (p.category=? OR p.vendor_id IS ?) ORDER BY (p.category=?) DESC, p.id DESC LIMIT 10`)
    .all(p.id, p.category || '#', p.vendor_id, p.category || '#');
  const plain = String(p.short_description || p.description || '').replace(/[#*_>`\[\]()!-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const track = ['ViewContent', { content_ids: [String(p.id)], content_type: 'product', content_name: p.name, value: +p.price,
    currency: (getSetting('currency_code') || 'USD').toUpperCase() }];
  res.send(layout({ title: p.name, desc: plain, image: imgs[0], nav: 'product', currentCat: p.category, track, body: `<div class="sp">
    <div class="gal"><div class="mi">${imgs[0] ? `<img id="mimg" src="${esc(imgs[0])}" alt="${esc(p.name)}" fetchpriority="high">` : '<div class="noimg" style="height:100%">📦</div>'}
      ${p.stock > 0 ? '<span class="stk">✅ En stock</span>' : ''}${off ? `<span class="spc">-${off}%</span>` : ''}</div>
      ${imgs.length > 1 ? `<div class="th">${imgs.map((u, i) => `<button type="button" class="${i ? '' : 'on'}" data-src="${esc(u)}" aria-label="Photo ${i + 1}"><img src="${esc(u)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}</div>
    <div class="inf">${c ? `<p class="cat"><a href="/boutique?cat=${c.slug}">${c.icon} ${esc(c.name)}</a></p>` : ''}<h1>${esc(p.name)}</h1>
      <div class="spr"><b>${money(p.price)}</b>${off ? `<s>${money(p.compare_price)}</s><span class="save">Économisez ${money(p.compare_price - p.price)}</span>` : ''}</div>
      ${p.vslug ? `<p class="by">Vendu par <a href="/boutique/${esc(p.vslug)}">${esc(p.shop_name)}</a></p>` : ''}
      ${p.short_description ? `<div class="short md">${md.render(p.short_description)}</div>` : ''}
      <div id="mireb-commande" data-mireb-form data-compact data-product="${p.id}" data-canal="${canal}"></div>
      <div class="perks"><span class="perk b">🚚 Livraison rapide</span><span class="perk g">💵 Paiement à la réception</span>${p.stock > 0 && p.stock <= 5 ? `<span class="perk o">🔥 Plus que ${p.stock} en stock</span>` : ''}</div></div></div>
    ${p.description ? `<section class="desc"><h2 class="dt">Description du produit</h2><div class="md">${md.render(p.description)}</div></section>
      <div class="cta"><a href="#mireb-commande" data-goto-form>🛒 Commander maintenant — paiement à la livraison</a></div>` : ''}
    ${related.length ? section('Produits similaires', `<div class="scroll">${related.map(r => card(r)).join('')}</div>`) : ''}
    <script src="/widget.js"></script>` }));
});

// ---------- Boutique d'un vendeur ----------
router.get('/boutique/:slug', (req, res) => {
  const v = db.prepare('SELECT * FROM vendors WHERE slug=? AND active=1').get(req.params.slug);
  if (!v) return res.status(404).send(layout({ title: 'Boutique introuvable', body: '<p class="empty">Cette boutique n\'existe pas.</p>' }));
  const list = db.prepare(`SELECT p.* ${FROM} WHERE p.vendor_id=? AND ${VISIBLE} ORDER BY p.id DESC`).all(v.id);
  res.send(layout({ title: `${v.shop_name} — ${shopName()}`, desc: String(v.description || '').slice(0, 160), body: `<div class="vhead">
    <div class="vav">${esc([...(v.shop_name || '?')][0].toUpperCase())}</div><div><h1>${esc(v.shop_name)}</h1><p>${list.length} produit${list.length > 1 ? 's' : ''} · Paiement à la livraison</p></div></div>
    ${v.description ? `<div class="desc" style="margin:0"><div class="md">${md.render(v.description)}</div></div>` : ''}
    ${section('Produits de la boutique', grid(list))}` }));
});

// ---------- Suivi de commande (n° + téléphone, les deux doivent correspondre) ----------
router.get('/suivi', (req, res) => {
  const n = String(req.query.n || '').replace(/\D/g, ''), tel = String(req.query.tel || '').replace(/\D/g, '');
  let result = '';
  if (n || tel) {
    const o = n && tel.length >= 8 ? db.prepare('SELECT * FROM orders WHERE id=?').get(n) : null;
    const match = o && String(o.phone || '').replace(/\D/g, '').slice(-8) === tel.slice(-8);
    if (!match) result = '<p class="err">Aucune commande trouvée avec ce numéro et ce téléphone.</p>';
    else {
      const hist = db.prepare('SELECT status, MIN(created_at) at FROM order_history WHERE order_id=? GROUP BY status').all(o.id);
      const at = Object.fromEntries(hist.map(h => [h.status, h.at]));
      const failed = ['annule', 'retourne'].includes(o.status);
      const flow = ['nouveau', 'confirme', 'expedie', 'en_livraison', 'livre'];
      const reached = s => at[s] || (s === 'livre' && at.paye) || STATUSES.indexOf(o.status) >= STATUSES.indexOf(s) && !failed;
      result = `<h2 style="font-size:1.05rem;margin:18px 0 0">Commande n°${o.id} — ${esc(o.product_name)} × ${o.qty} · <span style="color:var(--a)">${money(o.amount)}</span></h2>
        <ul class="steps">${flow.map(s => `<li class="${reached(s) ? 'ok' : ''}"><i>${reached(s) ? '✓' : ''}</i>${LABEL[s]}<small>${esc(at[s] || '')}</small></li>`).join('')}
        ${failed ? `<li class="ko ok"><i>✕</i>${LABEL[o.status]}<small>${esc(at[o.status] || '')}</small></li>` : ''}</ul>
        ${failed || reached('livre') ? '' : `<button type="button" class="btn w" id="pushbtn" style="border:1.5px solid var(--p);margin-top:10px">🔔 Me prévenir quand mon colis arrive</button>
        <script>addEventListener('load',function(){if(window.MirebPush)MirebPush.button(document.getElementById('pushbtn'),'/public/push/subscribe',{order_id:${o.id},token:'${push.orderToken(o.id)}'})})</script>`}`;
    }
  }
  res.send(layout({ title: `Suivi de commande — ${shopName()}`, active: 'suivi', catBar: false, body: `<div class="box"><h1>🚚 Suivre ma commande</h1>
    <p>Entrez le numéro reçu après votre commande et votre téléphone.</p>
    <form><input name="n" inputmode="numeric" placeholder="Numéro de commande (ex : 125)" value="${esc(n)}" required>
    <input name="tel" type="tel" placeholder="Votre téléphone" value="${esc(req.query.tel || '')}" required><button class="btn r">Voir le suivi</button></form>${result}</div>` }));
});

// ---------- Politique de confidentialité (obligatoire pour le Google Play Store) ----------
router.get('/confidentialite', (req, res) => {
  const name = esc(shopName()), mail = esc(process.env.ADMIN_EMAIL || 'admin@mireb.online');
  res.send(layout({ title: `Confidentialité — ${shopName()}`, catBar: false, body: `<div class="box md"><h1>Politique de confidentialité</h1>
    <p>Dernière mise à jour : ${new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</p>
    <h3>Données collectées</h3><ul><li><b>Commande</b> : nom, téléphone, adresse et ville de livraison, produit commandé.</li>
    <li><b>Vendeurs</b> : nom de boutique, email, téléphone, produits et photos publiés.</li>
    <li><b>Livreurs</b> : position GPS pendant l'utilisation de l'application livreur, pour le suivi des livraisons.</li>
    <li><b>Notifications</b> : si vous les activez, un identifiant technique d'appareil pour vous envoyer le suivi.</li></ul>
    <h3>Utilisation</h3><p>Ces données servent uniquement à confirmer, livrer et suivre les commandes (appel, SMS, WhatsApp, notifications).
    Elles ne sont ni vendues ni partagées à des fins publicitaires. Elles sont transmises au vendeur et au livreur concernés par la commande.</p>
    <h3>Paiement</h3><p>Le paiement se fait à la livraison : aucune donnée bancaire n'est collectée par l'application.</p>
    <h3>Conservation et suppression</h3><p>Les données sont conservées le temps nécessaire au suivi des commandes et à la comptabilité.
    Pour consulter, corriger ou supprimer vos données, écrivez à <a href="mailto:${mail}">${mail}</a>.</p>
    <h3>Contact</h3><p>${name} — <a href="mailto:${mail}">${mail}</a></p></div>` }));
});

module.exports = router;
