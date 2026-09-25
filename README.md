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
- **Produits** : photo, prix, ancien prix barré, stock, description, visible/masqué.
- **Page produit** `https://votre-app/p/<nom-du-produit>` : fiche + formulaire de commande COD déjà lié au produit (ajoutez `?canal=ID` pour suivre une pub).
- **Boutique du vendeur** : `/boutique/<vendeur>` · **Marketplace** (tous les vendeurs) : `/boutique`.
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
