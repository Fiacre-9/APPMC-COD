# Publier Mireb sur le Google Play Store (PWABuilder)

L'application Android est une « Trusted Web Activity » : elle affiche le site `https://app.mireb.online` en plein écran,
sans barre d'adresse. **Tout ce que vous modifiez sur le site apparaît aussitôt dans l'app, sans nouvelle publication.**

Tout est déjà prêt côté site :

| Élément exigé | Où |
|---|---|
| Manifeste (nom, icônes 192/512, couleurs, catégorie) | `https://app.mireb.online/manifests/boutique.json` |
| Service worker + page hors connexion | `/sw.js`, `/offline.html` |
| Vérification Google (Digital Asset Links) | `https://app.mireb.online/.well-known/assetlinks.json` (rempli depuis l'admin) |
| Politique de confidentialité | `https://app.mireb.online/confidentialite` |
| Notifications push | incluses (Android les affiche comme une app normale) |

Vous pouvez publier **2 apps** : la **Boutique** (clients) et l'app **Vendeur**. Même procédure, avec l'adresse et le nom de package de chacune.

---

## Étape 1 — Compte développeur Google Play (25 $, une seule fois)
1. Allez sur <https://play.google.com/console/signup> avec votre compte Google.
2. Choisissez **Organisation** si vous avez une entreprise enregistrée (numéro D-U-N-S demandé), sinon **Personnel**.
3. Payez les 25 $ et validez votre identité (pièce d'identité, téléphone). La vérification prend de quelques heures à quelques jours.

> ⚠️ **Compte personnel créé après novembre 2023** : Google impose un **test fermé avec au moins 12 testeurs pendant 14 jours**
> avant de pouvoir publier en production. Préparez 12 adresses Gmail (équipe, vendeurs, livreurs, amis).

## Étape 2 — Générer l'app avec PWABuilder (gratuit)
1. Ouvrez <https://www.pwabuilder.com>, entrez **`https://app.mireb.online/boutique`** puis **Start**.
2. PWABuilder note le manifeste, le service worker et la sécurité : tout doit être vert.
3. Cliquez **Package For Stores** → **Android** → **Generate Package**, puis **All settings** :

   | Champ | Boutique | Vendeur |
   |---|---|---|
   | Package ID | `online.mireb.boutique` | `online.mireb.vendeur` |
   | App name | `Mireb — Boutique` | `Mireb Vendeur` |
   | Launcher name | `Mireb` | `Vendeur` |
   | Host | `app.mireb.online` | `app.mireb.online` |
   | Start URL | `/boutique?source=pwa` | `/vendeur/` |
   | Manifest URL | `https://app.mireb.online/manifests/boutique.json` | `https://app.mireb.online/manifests/vendeur.json` |
   | Theme / status bar color | `#1A56DB` | `#1D2330` |
   | Navigation / background color | `#F8FAFC` | `#F5F6F8` |
   | Notifications | ✅ **Enable** (délégation des notifications) | ✅ **Enable** |
   | Signing key | **Create new** | **Create new** |
   | Version | `1.0.0` (code 1) | `1.0.0` (code 1) |

4. **Download** : vous obtenez un `.zip` contenant notamment :
   - `app-release-bundle.aab` → le fichier à envoyer sur le Play Store ;
   - `app-release-signed.apk` → pour tester directement sur un téléphone Android ;
   - `signing.keystore` + `signing-key-info.txt` → **votre clé de signature** ;
   - `assetlinks.json` → contient l'empreinte SHA-256 de votre clé.

> 🔐 **Gardez `signing.keystore` et `signing-key-info.txt` en lieu sûr (2 copies, hors du téléphone).**
> Sans eux, vous ne pourrez plus jamais publier de mise à jour de l'app sous le même nom.
> Ne les mettez **jamais** dans le dépôt GitHub.

## Étape 3 — Enregistrer l'empreinte dans l'admin Mireb
1. Ouvrez `assetlinks.json` (du zip) et copiez la valeur de `sha256_cert_fingerprints` (format `AA:BB:…:FF`).
2. Admin Mireb → **⚙️ Paramètres** → **📱 Applications Android** → une ligne par app :
   ```
   online.mireb.boutique 14:6D:E9:…:44:E5
   online.mireb.vendeur  14:6D:E9:…:44:E5
   ```
3. **Enregistrer**, puis ouvrez <https://app.mireb.online/.well-known/assetlinks.json> : vos packages doivent apparaître.

## Étape 4 — Tester sur un téléphone Android
Installez `app-release-signed.apk` (autoriser « sources inconnues »). L'app doit s'ouvrir **sans barre d'adresse** en haut.
Si une barre d'adresse apparaît : l'empreinte de l'étape 3 est absente ou incorrecte.

## Étape 5 — Créer la fiche sur la Play Console
1. **Créer une application** → nom, langue **Français**, **Application**, **Gratuite**.
2. **Tester et publier → Test fermé** → créer un canal, ajouter vos 12 testeurs, envoyer `app-release-bundle.aab`.
3. **Play App Signing** (activé par défaut) : Google re-signe l'app avec **sa propre clé**. Allez dans
   **Tester et publier → Configuration → Intégrité de l'application → Signature de l'application**, copiez
   **l'empreinte SHA-256 de la clé de signature de l'application**, et **ajoutez-la sur la même ligne** dans l'admin Mireb :
   ```
   online.mireb.boutique 14:6D:E9:…(clé PWABuilder) 9A:3F:…(clé Google)
   ```
   Sans cette 2e empreinte, l'app téléchargée depuis le Play Store affichera une barre d'adresse.
4. **Fiche du Play Store** : description courte (80 caractères), description complète, icône 512×512
   (`public/icons/boutique-512.png`), image de présentation 1024×500, **au moins 2 captures d'écran** du téléphone
   (prenez-les dans l'app installée avec de vrais produits).
5. **Contenu de l'application** :
   - Politique de confidentialité : `https://app.mireb.online/confidentialite`
   - **Sécurité des données** : nom, téléphone, adresse (commandes), position approximative/précise (app livreur uniquement),
     identifiants d'appareil (notifications). Données **non vendues**, **chiffrées en transit** (HTTPS).
   - Public cible : 18 ans et plus · Publicités : **non** (sauf si vous en ajoutez).
6. Après les 14 jours de test fermé : **Production → Créer une version** → envoyer le même `.aab` → **Examen** (quelques jours).

## Mises à jour
- **Contenu, design, produits, fonctionnalités** : rien à faire, l'app affiche toujours le site à jour.
- **Nouvelle icône, nouveau nom, nouvelles couleurs de démarrage** : régénérez sur PWABuilder **avec la même clé**
  (« Use existing » + `signing.keystore`), augmentez le **version code** (2, 3…), puis envoyez le nouveau `.aab`.

## Et l'iPhone ?
L'App Store demande un compte Apple Developer (99 $/an) et Apple refuse souvent les apps qui ne sont qu'un site web.
Sur iPhone, l'installation depuis Safari (**Partager → Sur l'écran d'accueil**) donne la même app, notifications comprises.
