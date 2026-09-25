// Manifestes PWA : une application installable par espace (boutique, vendeur, livreur, gestion)
const router = require('express').Router();
const { getSetting } = require('../db');

const icons = (app) => [
  { src: `/icons/${app}-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: `/icons/${app}-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: `/icons/${app}-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

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
    .json({ lang: 'fr', dir: 'ltr', display: 'standalone', orientation: 'portrait', ...m, icons: icons(req.params.app) });
});

module.exports = router;
