# Comptes agents et livreurs : installation

Ce module permet de créer un accès pour chaque agent ou livreur : l'admin clique sur **✉️ Accès**, la personne reçoit un email avec son identifiant et un lien pour choisir son mot de passe. Elle peut ensuite se connecter sur `/compte.html`, et utiliser « Mot de passe oublié ».

- **Agent de confirmation** : il voit les nouvelles commandes, clique sur **Prendre en charge** (une seule personne par commande), appelle le client, corrige l'adresse, choisit le livreur, puis **Confirme**, met **À rappeler** ou **Annule**. Il ne peut jamais marquer « Livré » ou « Payé » : la commission de l'agent se déclenche seulement quand le livreur marque « Livré ».
- **Livreur** : après connexion, il est envoyé vers l'app livreur existante. Il y voit les commandes confirmées qui lui sont affectées, appelle le client, ouvre l'itinéraire GPS vers l'adresse, puis choisit En route, Livré ou Retour.
- Si l'email ne peut pas partir (SMTP non configuré), l'admin voit le lien et peut l'envoyer par WhatsApp.

## 1. Ajouter 2 fichiers (nouveaux, rien n'est écrasé)

| Fichier | Où le mettre |
|---|---|
| `accounts.js` | dans `src/`, à côté de `db.js` |
| `compte.html` | dans `public/`, à côté de `widget.js` |

## 2. Modifier 3 fichiers existants (petites modifications)

### `src/server.js`
Ajouter après `const conn = require('./connectors');` :
```js
const accounts = require('./accounts');
```
Ajouter après `app.use(cookieParser());` :
```js
app.set('trust proxy', 1);
```
Ajouter juste avant la ligne `app.use('/api', auth, require('./routes/api'));` :
```js
app.use('/api/accounts', auth, accounts.admin);
app.use('/compte', accounts.router);
```

### `src/routes/api.js`
Dans la ligne `crud('couriers', [...])`, ajouter `'email'` :
```js
crud('couriers', ['name', 'company', 'phone', 'email', 'fee_per_parcel', 'zones', 'auto_assign']);
```

### `public/app.js`
1. Dans la liste des agents, après le bouton `💰 Payer`, ajouter :
```html
<button class="sm" onclick="inviteAccount('agent',${a.id})">✉️ Accès</button>
```
2. Dans la liste des livreurs, après le bouton `💳 Paiement`, ajouter :
```html
<button class="sm" onclick="inviteAccount('courier',${c.id})">✉️ Accès</button>
```
3. Dans `courierForm`, après le champ téléphone, ajouter :
```html
<input name="email" type="email" placeholder="Email (identifiant de connexion)" value="${esc(c.email)}">
```
4. Coller à la fin du fichier la fonction `inviteAccount` (elle est à la fin de `comptes.patch`).

Le fichier `comptes.patch` contient ces 3 modifications exactes, testées sur le dépôt GitHub.

## 3. Variables à définir sur Hostinger (Node.js → variables d'environnement)

| Variable | Valeur |
|---|---|
| `SMTP_HOST` | serveur sortant de ta boîte mail (ex. `smtp.hostinger.com`) |
| `SMTP_PORT` | `465` (ou `587`) |
| `SMTP_USER` | l'adresse email d'envoi (ex. `contact@mireb.online`) |
| `SMTP_PASS` | le mot de passe de cette boîte mail |
| `SMTP_FROM` | `Mireb COD <contact@mireb.online>` |
| `BASE_URL` | `https://app.mireb.online` |
| `JWT_SECRET` | une longue phrase secrète aléatoire (obligatoire pour la sécurité) |

Vérifie les valeurs SMTP exactes dans hPanel → Emails.

## 4. Tester
1. Ouvre un agent (✏️) et renseigne son email, puis clique sur **✉️ Accès**.
2. Ouvre le lien reçu, choisis un mot de passe.
3. Connecte-toi sur `https://app.mireb.online/compte.html`.

## Notes
- Une fois la commande en livraison ou terminée, l'agent ne peut plus changer son statut ni son livreur (c'est le livreur et l'admin).
- Le livreur voit les nouvelles commandes à l'actualisation de son app (toutes les 60 secondes).
- Un email ne peut appartenir qu'à une seule fiche (agent ou livreur).
- Le lien d'accès est valable 48 h et ne sert qu'une fois ; une nouvelle invitation remplace l'ancien lien.
- Les mots de passe sont stockés hachés (bcrypt). 10 essais maximum toutes les 10 minutes par adresse IP.
- La base est mise à jour automatiquement au démarrage (colonnes ajoutées, aucune donnée supprimée). Fais une copie de `data/mireb.db` avant de déployer, par prudence.
