# Mireb COD — Application Node.js

Application autonome de gestion des commandes **Cash-on-Delivery** (version Node.js du plugin WordPress Mireb COD).

## Fonctionnalités (identiques au guide)
| Menu | Rôle |
|---|---|
| Tableau de bord | Vue d'ensemble + 🔧 diagnostic des connecteurs |
| Commandes COD | Statuts (Nouveau → Payé), assignation agent/livreur, historique, notes |
| Pipeline Kanban | Glisser-déposer entre statuts |
| CRM Clients | Segments (Nouveau/Actif/Fidèle/VIP/Risque), score livraison 0-5★, blacklist, tags, notes |
| Agents | Taux de commission, calcul auto au statut « Livré », paiement sélectif |
| Livreurs | Tarif/colis, zones, solde dû, versements |
| Tracking GPS | Auto-assignation (livreur le moins chargé de la ville) + position temps réel |
| Stock | Entrées/sorties, décrément auto, restock sur annulation/retour |
| Canaux de vente | Suivi Facebook / TikTok… via `?canal=ID` |
| Statistiques | Par jour, canal, agent + export CSV |
| Automatisations | WhatsApp / SMS / Email sur changement de statut, avec délai (ex. alerte 24h) |
| Synchronisation | WooCommerce : import produits/commandes, push statuts, webhook temps réel |
| Paramètres | Personnalisation du formulaire COD |
| Vendeurs | Multivendeur : liste des boutiques, CA, suspension/réactivation |

## Boutique multivendeur
- **Inscription vendeur** : `https://votre-app/vendeur/#inscription` (connexion : `/vendeur/`). Chaque vendeur a un accès unique et ne voit que ses produits et ses commandes.
- **Produits** : jusqu'à 6 photos (galerie), catégorie, prix, ancien prix barré, stock, courte description et description complète en **Markdown** (barre d'outils + aperçu), visible/masqué.
- **Page produit** `https://votre-app/p/<nom-du-produit>` : fiche + formulaire de commande COD déjà lié au produit (ajoutez `?canal=ID` pour suivre une pub).
- **Boutique du vendeur** : `/boutique/<vendeur>` · **Marketplace** (tous les vendeurs) : `/boutique` — design du thème Mireb COD (en-tête avec recherche, catégories à icônes, nouveautés, promotions, grille 2/4 colonnes, menu du bas mobile). Recherche `?q=`, catégorie `?cat=`.
- **Accueil sans doublons** : chaque produit n'apparaît qu'une fois — 🆕 Nouveautés (ajoutés depuis moins de 14 jours) → 🏷️ Promotions → une rangée par catégorie (« Voir tout (N) »). Page complète `/boutique?tout=1` avec filtres par catégorie, 🏷️ promos (`promo=1`) et tri (`tri=prix_asc|prix_desc|promo`).
- **Suivi de commande** : `/suivi` (numéro de commande + téléphone).
- Markdown pris en charge : `## titre`, `**gras**`, `*italique*`, listes `-` / `1.` / `✅`, `> citation`, `---`, `[lien](https://…)`, `![image](https://…)`. Le HTML saisi n'est jamais interprété.
- Les commandes reçues via la page d'un vendeur lui sont attribuées ; l'admin les voit toutes (colonne 🏪) et peut suspendre un vendeur (ses pages et son formulaire sont alors désactivés).
- Les photos sont stockées dans `DATA_DIR/uploads` (hors du dossier de l'app, conservées aux redéploiements).

## Connecteurs (`.env`)
- **WooCommerce** REST v3 : `WC_URL`, `WC_KEY`, `WC_SECRET` (+ `WC_WEBHOOK_SECRET`)
- **WhatsApp Cloud API** : `WA_TOKEN`, `WA_PHONE_ID`
- **SMS Twilio** : `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`
- **Email SMTP** : `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`

Un connecteur non renseigné est simplement désactivé (visible dans le diagnostic).

## Installation
```bash
npm install
cp .env.example .env   # puis remplissez les valeurs
npm start              # http://localhost:3000
```
Connexion : `ADMIN_EMAIL` / `ADMIN_PASSWORD` du `.env` (défaut `admin@mireb.online` / `admin123` — changez-le dans Paramètres).
Base SQLite créée automatiquement dans `data/mireb.db`.

## Formulaire de commande
- Page hébergée : `https://votre-app/commande.html?product_id=1&canal=2&prix=24,99 $&prix_barre=59,99 $`
- Sur n'importe quel site (WordPress, landing) :
```html
<div data-mireb-form data-product="1" data-canal="1" data-titre="Mon produit" data-prix="24,99 $" data-prix-barre="59,99 $"></div>
<script src="https://votre-app/widget.js"></script>
```

## App livreur (PWA)
Tracking GPS → 🔑 Générer → envoyer le lien par WhatsApp. Le livreur voit ses commandes, Appeler / Itinéraire / ✅ Livré, et sa position est envoyée toutes les 30 s.

## Webhook WooCommerce
WooCommerce → Réglages → Avancé → Webhooks → sujet « Commande créée » → URL `https://votre-app/public/webhooks/woocommerce`.
Synchronisation automatique également toutes les 5 min.

## Applications installables (PWA) — Android et iPhone
| App | Adresse | Icône |
|---|---|---|
| Boutique (clients) | `/boutique` | bleue 🛍️ |
| Vendeur | `/vendeur/` | orange 🏪 |
| Livreur | lien personnel `/livreur/?t=…` (l'app installée garde le compte) | sombre 🚚 |
| Gestion (admin) | `/` | rouge 📊 |

- **Android (Chrome, Samsung Internet, Edge)** : bannière « Installer » ou bouton 📲 → installation native.
- **iPhone / iPad** : pas d'installation automatique chez Apple → un guide s'affiche : Partager → « Sur l'écran d'accueil » → Ajouter (Safari, iOS ≥ 16.4 aussi dans Chrome).
- Depuis Facebook / Instagram / TikTok (navigateur intégré), le guide indique d'ouvrir la page dans Safari ou Chrome.
- **Hors connexion** : les pages et photos déjà vues restent disponibles ; commandes, connexions et données passent toujours par le réseau (jamais mises en cache).
- Fichiers : `src/routes/pwa.js` (manifestes), `public/sw.js` (service worker), `public/pwa.js` (bouton/guide d'installation), `public/icons/`.
- Après une modification des fichiers du site, augmenter `VERSION` dans `public/sw.js` pour vider les anciens caches.

## Marketing Meta (Facebook / Instagram) — Admin → 📣 Marketing
- **Catégories** gérées par l'admin (icône, nom, catégorie Google transmise à Meta) : utilisées par la boutique, les vendeurs et le catalogue.
- **Catalogue** : flux programmé `https://votre-app/feeds/meta.csv` (Gestionnaire de ventes, toutes les heures, sans jeton) **ou** synchronisation directe par l'API (bouton + automatique à chaque modification de produit + chaque heure ; les produits masqués sont retirés).
- **Ensembles de produits** créés automatiquement : un par catégorie (`custom_label_0`) + « Promotions » (`custom_label_2 = promo`) → pour les campagnes catalogue Advantage+.
- **Pixel** : PageView, ViewContent (page produit, `content_ids` = ID catalogue) et Purchase (commande) ; **API Conversions** côté serveur avec le même `event_id` (dédupliqué), téléphone/prénom/ville hachés en SHA-256.
- Jeton d'accès (utilisateur système, `catalog_management` + `ads_management`) stocké côté serveur, jamais renvoyé au navigateur.
- Produits exclus du catalogue : sans photo ; stock 0 = « out of stock » (non diffusé en pub). `BASE_URL` doit être défini.

## Notifications push
| Qui | Quand | Activation |
|---|---|---|
| Vendeur | 🛒 nouvelle commande sur ses produits | 🔔 dans l'espace vendeur (menu + tableau de bord) |
| Admin | 🛒 chaque nouvelle commande | 🔔 dans le menu de l'admin |
| Livreur | 📦 livraison assignée (auto ou manuelle) | 🔔 en haut de l'app livreur |
| Client | ✅ confirmée · 📦 expédiée · 🚚 « votre colis arrive » · 🎉 livrée · annulée | bouton après la commande et sur `/suivi` |

- Android / ordinateur : fonctionne dans le navigateur et dans l'app installée. **iPhone (iOS ≥ 16.4) : uniquement dans l'app installée** sur l'écran d'accueil (le bouton affiche alors le guide d'installation).
- Clés VAPID créées automatiquement au premier démarrage et gardées en base (ou `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`).
- Un client ne peut s'abonner qu'au suivi de sa propre commande (jeton signé reçu après la commande ou sur `/suivi` avec son téléphone).
- Code : `src/push.js` (envoi), `public/sw.js` (affichage), `public/pwa.js` (`MirebPush.button`).

## Google Play Store (Android)
Guide pas à pas : [`docs/ANDROID-PLAY-STORE.md`](docs/ANDROID-PLAY-STORE.md) (PWABuilder → empreinte SHA-256 dans ⚙️ Paramètres → Play Console).
Vérification Google servie sur `/.well-known/assetlinks.json` ; politique de confidentialité sur `/confidentialite`.

## Déploiement (Hostinger / VPS)
Node ≥ 22.13 (SQLite intégré `node:sqlite`, aucune compilation native), commande de démarrage `npm start`, variables d'environnement à définir dans le panneau (ne pas committer `.env`).

## Structure
```
src/server.js           serveur Express, auth, cron
src/db.js               schéma SQLite
src/services.js         logique métier (statuts, commissions, auto-assign, CRM, automatisations, sync)
src/connectors/         WooCommerce, WhatsApp, SMS, Email
src/routes/api.js       API admin (protégée)
src/routes/public.js    formulaire, webhook, API livreur
src/routes/vendor.js    espace vendeur (inscription, produits, commandes)
src/routes/shop.js      pages publiques : /p/:produit, /boutique, /boutique/:vendeur
public/                 admin SPA, widget.js, commande.html, livreur/ (PWA), vendeur/ (espace vendeur)
```
