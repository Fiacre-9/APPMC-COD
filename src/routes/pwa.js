// Manifestes PWA : une application installable par espace (boutique, vendeur, livreur, gestion)
const router = require('express').Router();
const { getSetting } = require('../db');

const icons = (app) => [
  { src: `/icons/${app}-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: `/icons/${app}-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: `/icons/${app}-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

// Applications Android (Play Store) : une ligne « nom.du.package EMPREINTE_SHA256 » par app (Paramètres admin)
function parseAndroidApps(text) {
  return String(text || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const [pkg, ...fps] = l.split(/[\s,;]+/);
    if (!/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(pkg) || !fps.length || !fps.every(f => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/i.test(f)))
      throw new Error(`Ligne Android invalide : « ${l.slice(0, 60)} » (attendu : nom.du.package AA:BB:…:FF)`);
    return { pkg, fps: fps.map(f => f.toUpperCase()) };
  });
}
// Vérification Google « Digital Asset Links » : prouve que l'app Android et le site ont le même propriétaire
// (sans ce fichier, l'app du Play Store affiche une barre d'adresse)
router.get('/.well-known/assetlinks.json', (req, res) => {
  let apps = []; try { apps = parseAndroidApps(getSetting('android_apps', process.env.ANDROID_APPS || '')); } catch {}
  res.set('Cache-Control', 'public, max-age=300').json(apps.map(a => ({ relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: a.pkg, sha256_cert_fingerprints: a.fps } })));
});

router.get('/manifests/:app.json', (req, res) => {
  const shop = getSetting('shop_name', '') || 'Mireb';
  // Le lien personnel du livreur est gardé dans l'app installée (iOS n'y partage pas les données de Safari)
  const t = /^[a-f0-9]{32}$/.test(req.query.t || '') ? req.query.t : '';
  const APPS = {
    boutique: { id: '/boutique', name: `${shop} — Boutique`, short_name: shop, start_url: '/boutique?source=pwa', scope: '/',
      theme_color: '#1A56DB', background_color: '#F8FAFC', description: 'Commandez en ligne, payez à la livraison.',
      shortcuts: [{ name: 'Suivre ma commande', url: '/suivi', icons: [{ src: '/icons/boutique-192.png', sizes: '192x192' }] },
        { name: 'Catégories', url: '/boutique#categories', icons: [{ src: '/icons/boutique-192.png', sizes: '192x192' }] }] },
    vendeur: { id: '/vendeur/', name: `${shop} — Espace vendeur`, short_name: 'Vendeur', start_url: '/vendeur/', scope: '/vendeur/',
      theme_color: '#1d2330', background_color: '#F5F6F8', description: 'Gérez vos produits et vos commandes.' },
    livreur: { id: '/livreur/', name: `${shop} — Livreur`, short_name: 'Livreur', start_url: `/livreur/${t ? `?t=${t}` : ''}`, scope: '/livreur/',
      theme_color: '#1d2330', background_color: '#F5F6F8', description: 'Vos livraisons, itinéraires et encaissements.' },
    admin: { id: '/admin', name: `${shop} — Gestion COD`, short_name: 'Gestion', start_url: '/', scope: '/',
      theme_color: '#1d2330', background_color: '#F5F6F8', description: 'Commandes, CRM, livreurs, stock et statistiques.' },
  };
  const m = APPS[req.params.app];
  if (!m) return res.status(404).end();
  res.type('application/manifest+json').set('Cache-Control', 'no-cache')
    .json({ lang: 'fr', dir: 'ltr', display: 'standalone', display_override: ['standalone', 'minimal-ui'], orientation: 'portrait',
      categories: req.params.app === 'boutique' ? ['shopping'] : ['business', 'productivity'], prefer_related_applications: false,
      launch_handler: { client_mode: 'focus-existing' }, ...m, icons: icons(req.params.app) });
});

module.exports = router;
module.exports.parseAndroidApps = parseAndroidApps;
