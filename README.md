# Regroupeur — Cardmarket & Vinted

Extension navigateur pour acheter des cartes plus simplement sur deux sites :

- **Cardmarket** : le meilleur plan d'achat pour une liste de cartes (voir ci-dessous) ;
- **Vinted** : recherche dans le dressing d'un vendeur, lot prérempli, prix avec envoi sous les annonces,
  « Voir sur Cardmarket » pour comparer le prix d'une carte, messages en direct, suppression de conversations
  (voir [Vinted](#vinted)).

Un clic sur l'icône de l'extension ouvre son panneau sur ces deux sites ; ailleurs, il ouvre une page qui explique
ce qu'elle fait sur chacun.

Sur Cardmarket, elle aide à construire le meilleur plan d'achat pour une liste de cartes, en minimisant à la fois :

- le coût total avec frais de port ;
- le nombre de commandes ;
- le temps de recherche et de vérification.

L'idée centrale est simple : il ne suffit pas d'acheter chaque carte chez le vendeur le moins cher. Parfois, payer un peu plus sur une carte permet de regrouper le reste de la liste chez le même vendeur et de faire baisser les frais de port globaux.

---

## Sommaire

- [Présentation](#présentation)
- [Fonctionnalités clés](#fonctionnalités-clés)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Utilisation rapide](#utilisation-rapide)
- [Réglages et stratégie d'achat](#réglages-et-stratégie-dachat)
- [Développement](#développement)
- [Tests](#tests)
- [Structure du projet](#structure-du-projet)
- [Contribuer](#contribuer)

---

## Présentation

Cardmarket Regroupeur est une extension Chrome / Edge / Brave destinée aux collectionneurs qui achètent souvent plusieurs cartes en une seule liste. Elle analyse les offres disponibles, compare les vendeurs, puis propose les meilleures combinaisons de commande en fonction de :

- condition et langue recherchées ;
- prix max autorisé ;
- frais de port estimés et réels ;
- nombre de commandes à éviter ;
- cartes gradées ou non gradées ;
- coffrets, boosters, ETB, displays et lots.

Le but n'est pas seulement de trouver le plus bas prix unitaire, mais le meilleur plan d'achat global.

---

## Fonctionnalités clés

- Analyse automatique d'une liste de cartes depuis Cardmarket
- Recherche du meilleur regroupement de vendeurs selon le coût final
- Prise en compte des frais de port et des pénalités par commande
- Comparaison de plusieurs scénarios :
  - moins de colis ;
  - prix unitaire minimal ;
  - meilleur compromis global
- Support des cartes gradées (PSA, BGS, CGC, etc.)
- Gestion des produits scellés : boosters, lots, ETB, displays, coffrets
- Import de listes, collage de listes, ajout depuis une fiche produit
- Export CSV du plan d'achat
- Plusieurs listes de collection sauvegardées
- Vérification approfondie du stock des vendeurs les plus prometteurs
- Compatibilité avec les pages de cartes, vendeurs et panier Cardmarket
- Sur Vinted : recherche dans le dressing d'un vendeur, lot prérempli, prix avec envoi sous les annonces

---

## Prérequis

Pour utiliser l'extension :

- un navigateur compatible : Chrome, Edge ou Brave ;
- un compte Cardmarket connecté ;
- l'extension chargée en mode développeur.

Pour développer ou générer les artefacts du projet :

- Node.js 18+ ;
- npm ;
- Git.

---

## Installation

### 1) Cloner le dépôt

```bash
git clone git@github.com:Lioxyze/Cardmarket-Regroupeur.git
cd Cardmarket-Regroupeur
```

### 2) Installer les dépendances

```bash
npm install
```

### 3) Charger l'extension dans le navigateur

1. Ouvrir `chrome://extensions` (ou `edge://extensions` / `brave://extensions`)
2. Activer le mode développeur
3. Cliquer sur "Charger l'extension non empaquetée"
4. Sélectionner le dossier du projet, celui qui contient `manifest.json`
5. Ouvrir un site Cardmarket et utiliser le panneau de l'extension

### 4) Recharger après modification

Après un changement de code, il suffit de :

- recharger la carte de l'extension dans la page des extensions ;
- puis recharger la page Cardmarket concernée.

---

## Utilisation rapide

### Ajouter des cartes

Plusieurs méthodes sont possibles :

- recherche manuelle dans l'onglet "Mes cartes" ;
- ajout depuis une fiche produit Cardmarket ;
- import d'une wants list ;
- collage d'une liste de cartes, exemple :

```text
065 — Tokotoro
080 — Hyporoi-ex
2x 085 — Pêchaminus-ex
Houndoom (SFA 066)
```

Le système tente de reconnaître automatiquement l'extension, le numéro et le nom de la carte pour limiter les erreurs de matching.

### Lancer la recherche

Une fois la liste remplie :

1. choisir les critères souhaités ;
2. choisir l'état recherché ;
3. choisir la langue ;
4. lancer la recherche de vendeurs ;
5. consulter les meilleures combinaisons.

### Lire les résultats

L'interface affiche généralement :

- la meilleure option globale ;
- les meilleures combinaisons par nombre de vendeurs ;
- les vendeurs pertinents ;
- un détail par carte ;
- le coût total avec port ;
- les différences de prix entre scénarios.

### Ajouter au panier

L'extension peut ouvrir les offres retenues et relancer l'ajout au panier sur Cardmarket. Il ne s'agit pas d'un achat automatique : l'utilisateur vérifie le panier avant finalisation.

---

## Réglages et stratégie d'achat

### États et langues

Les réglages permettent d'affiner fortement la recherche :

- état minimum : NM, EX ou mieux, GD ou mieux ;
- langues : FR / JP / EN / toutes ;
- prix max ;
- tolérance de surcoût pour regrouper les achats ;
- exclusions de vendeurs ;
- pénalité par commande ;
- frais de port estimés ou réels.

Les règles peuvent être ajustées "à la volée" sans relire toutes les pages déjà chargées, selon le contexte de calcul.

### Stratégie de regroupement

L'extension ne cherche pas seulement la carte la moins chère. Elle regarde si le coût total final est meilleur quand :

- une carte est légèrement plus chère chez un vendeur déjà pertinent ;
- les frais de port sont réduits grâce à un packaging plus dense ;
- la commande est consolidée chez moins de vendeurs.

Cela permet souvent d'obtenir un plan plus rentable que le simple "prix unitaire minimum".

---

## Développement

### Scripts disponibles

```bash
npm test
npm run ui-check
npm run icons
npm run zip
npm run store-assets
npm run publier
```

Description des scripts :

| Script | Description |
| --- | --- |
| `npm test` | Lance la suite de tests automatisés du projet |
| `npm run ui-check` | Vérifie les éléments de l'interface et certains points de cohérence |
| `npm run icons` | Génère les icônes de l'extension |
| `npm run zip` | Prépare une archive prête à distribuer |
| `npm run store-assets` | Génère les ressources nécessaires au dépôt de mise en ligne |
| `npm run publier` | Script de publication / packaging |

### Procédure de travail

- développer en gardant le comportement de Cardmarket en tête ;
- tester les changements sur des cas réels ou représentatifs ;
- valider le comportement avant publication ;
- éviter d'introduire de nouvelles requêtes inutiles sur le site.

---

## Tests

Le dépôt contient une suite de tests unitaires et de validation autour des principaux modules :

```bash
npm test
```

Les tests couvrent notamment :

- l'analyse des offres ;
- la gestion des listes ;
- les calculs d'optimisation ;
- le parcours des cartes gradées ;
- les frais de port premium ;
- le comportement global des requêtes et des filtres.

---

## Structure du projet

```text
.
├── src/
│   ├── analyzer.js
│   ├── cart.js
│   ├── cm.js
│   ├── content.js
│   ├── fetcher.js
│   ├── optimizer.js
│   ├── panel.css
│   ├── panel.js
│   └── storage.js
├── scripts/
│   ├── build-zip.js
│   ├── make-icons.js
│   ├── publier.js
│   ├── store-assets.js
│   └── ui-check.js
├── tests/
│   ├── fixtures/
│   ├── harness/
│   └── *.test.js
├── distribution/
├── icons/
├── store/
├── background.js
├── manifest.json
├── package.json
├── README.md
└── .gitignore
```

### Composants principaux

- `src/cm.js` : interactions avec les pages Cardmarket
- `src/fetcher.js` : récupération et parsing des offres
- `src/optimizer.js` : calcul de la meilleure combinaison de vendeurs
- `src/analyzer.js` : logique d'analyse de données et de sélection
- `src/panel.js` : interface utilisateur de l'extension
- `background.js` : gestion du background de l'extension

---

## Contribuer

Les contributions sont les bienvenues. Avant de proposer une modification :

1. créer une branche dédiée ;
2. faire un correctif ou une amélioration ciblée ;
3. lancer la suite de tests ;
4. vérifier que le comportement Cardmarket reste cohérent ;
5. ouvrir une pull request claire avec un résumé de la modification.

Un bon correctif est toujours :

- lisible ;
- testable ;
- aligné avec les objectifs du projet ;
- respectueux des contraintes du site Cardmarket.

---

## À retenir

Cardmarket Regroupeur est conçu pour transformer une simple liste d'achats en plan d'achat optimisé, avec une logique orientée vers le coût total réel, et non seulement le prix d'une carte isolée.

Si tu veux acheter intelligemment sur Cardmarket, cette extension est pensée pour faire gagner du temps, réduire les colis et maximiser l'intérêt de chaque commande.

## Limites connues

- **Offres lues** : par défaut, les 50 offres les moins chères de chaque carte
  (réglable jusqu'à 300, la limite du site). La vérification approfondie compense
  pour les meilleurs vendeurs, mais un vendeur cher et absent de ces offres peut
  échapper à l'analyse.
- **Vérification Cloudflare** : si Cardmarket en affiche une, l'analyse s'arrête.
  Recharge la page, passe la vérification toi-même, puis relance.
- **Changer de page pendant l'analyse l'interrompt.** Garde l'onglet ouvert (on
  peut utiliser un autre onglet pendant ce temps).
- **Ajout au panier**, **import de wants list** et **recherche dans le stock d'un vendeur**
  (`?name=`) : écrits d'après la structure connue du site et testés sur un faux Cardmarket,
  pas encore vérifiés sur le vrai site (le formulaire panier n'est visible qu'une fois
  connecté). Si la recherche vendeur ne répond pas comme prévu, l'extension désactive la
  vérification approfondie ; si l'ajout au panier échoue, elle le dit et propose le diagnostic.
- **Détection des gradées** : elle dépend de ce que le vendeur a écrit. Une gradée sans mention
  dans le commentaire passe pour une loose.
- Prix et stocks changent vite : le panier Cardmarket fait foi.

> Cardmarket encadre l'usage automatisé de son site. L'extension reste à un rythme
> de lecture humain et n'agit que sur demande. Évite de baisser le délai entre deux
> pages sous 2 secondes : ton compte risque un blocage temporaire.

## Et l'assistant d'achat de Cardmarket ?

Cardmarket propose son propre [Shopping Wizard](https://help.cardmarket.com/en/ShoppingWizard)
sur les wants lists, avec deux stratégies : *Reduce Price* et *Reduce Shipments*. Il
remplit le panier directement, mais donne peu de visibilité sur ses choix.

Le Regroupeur ne remplace pas cet outil, il le complète :
- tableau de tous les vendeurs ;
- classement des combinaisons de 1 à 3 vendeurs ;
- réglages par carte ;
- frais de port et arbitrage prix / nombre de colis réglables ;
- fonctionne sans wants list.

Les deux se comparent facilement sur une même liste.

## Vinted

Sur `www.vinted.fr`, la même extension ajoute ce qui manque au site quand on achète des cartes :

- **Recherche dans le dressing d'un vendeur.** Barre « Chercher une carte dans ce dressing… » juste au-dessus des
  annonces, sur la page d'un membre et sur sa page « Créer un lot ». Le dressing est lu par pages de 96 articles (10 requêtes pour 936 annonces), puis la
  recherche est instantanée : accents ignorés, numéro de carte avec ou sans zéros (`67` trouve `067/064`), une faute
  de frappe tolérée, les annonces en double triées de la moins chère à la plus chère.
- **Une liste d'un coup.** Onglet « Une liste » : une carte par ligne, chaque ligne est cherchée chez ce vendeur ;
  « Reprendre ma liste Cardmarket » y recopie la liste du Regroupeur.
- **Lot prérempli.** Les annonces cochées (« + Lot ») ouvrent la page « Créer un lot » de Vinted avec ces articles
  déjà ajoutés, sans faire défiler des centaines d'annonces. Sur la page du lot, le panneau suit le lot affiché par
  Vinted et peut encore y ajouter des annonces. L'extension n'achète rien : elle s'arrête à la page du lot.
- **Prix avec envoi.** Sous chaque annonce : le total avec la protection acheteurs et l'envoi le moins cher vers le
  compte connecté (en orange à partir de 4 € d'envoi), y compris sur la page d'accueil et dans les résultats de
  recherche. Même ligne sous le prix sur la page d'une annonce, et estimation du total du lot dans le panneau.
- **Nom de l'annonce** sous chaque vignette (Vinted ne l'affiche pas).
- **Voir sur Cardmarket.** Sur la page d'une annonce de carte, un bouton sous le prix ; sous les vignettes et dans
  les résultats du panneau, un lien « Cardmarket ↗ ». Il ouvre Cardmarket sur la même carte, avec **la langue et
  l'état de l'annonce**, et un bandeau y compare les deux prix (détail ci-dessous). Se désactive en bas du panneau.
- **Messages en direct.** La messagerie web de Vinted ne se rafraîchit jamais toute seule (relectures
  automatiques désactivées dans son code). L'extension lit régulièrement le compteur de messages non lus — la
  requête de la pastille du bandeau, quelques octets — et, quand il augmente, demande à Vinted de relire avec son
  propre code la conversation ouverte, puis la liste si le message est arrivé ailleurs : le message apparaît sans
  recharger, le fil reste en bas, le texte en cours de saisie est conservé. Hors messagerie : avis « Nouveau
  message de X » et « (n) » dans le titre de l'onglet. Indicateur « en direct » dans la messagerie ; se désactive
  en bas du panneau.
- **Messagerie : supprimer des conversations.** Une corbeille sur chaque conversation (un clic, puis « Supprimer ? »
  pour confirmer) et « Supprimer plusieurs conversations » pour en cocher plusieurs. L'extension déroule le parcours
  de Vinted avec ses propres boutons (détails → « Supprimer la conversation » → « Oui, supprimer ») ; les
  conversations que Vinted ne permet pas de supprimer (commande en cours) sont signalées et laissées.

Messages en direct, en détail : dans la messagerie, l'extension lit toutes les 2,5 s environ (utilisateur actif,
onglet visible) la « tête de liste », c'est-à-dire la conversation la plus récente (une requête de 4 Ko). Elle
change dès qu'un message arrive ou part, y compris un message envoyé depuis un autre appareil. Si c'est la
conversation ouverte, Vinted la relit ; sinon il relit sa liste. Une conversation n'est relue que si tu es devant
l'écran (fenêtre active, ou souris dans la page), car la relire la marque comme lue.

Message reçu dans une autre conversation : la ligne s'illumine, reste teintée en vert et porte une pastille verte
« Nouveau » à gauche de la corbeille, jusqu'à ce que tu ouvres la conversation (ou qu'elle soit lue sur un autre
appareil). Un message que tu envoies toi-même depuis un autre appareil n'est pas un message reçu : la ligne se met
à jour et s'illumine un instant, sans pastille.

La cadence ralentit sans activité (6 s après 2 min, 20 s après 5 min, arrêt après 30 min), et dans une seconde
fenêtre sans le focus (20 s) ; le compteur de non-lus n'est plus lu que toutes les 30 s, pour la pastille du
bandeau et le titre de l'onglet. Plafond de 1 800 requêtes par heure : quand il approche, la tête de liste
ralentit pour étaler ce qui reste sur la fin de l'heure, au lieu de tout couper. Hors messagerie : compteur toutes
les 60 s. Si Vinted ne sert plus la tête de liste (ou la refuse deux fois), l'extension retombe sur le compteur
seul ; si son code change, l'indicateur le dit et propose « Actualiser ».

Voir sur Cardmarket, en détail (`src/compare.js`, chargé sur les deux sites) :

- **La carte** : nom et numéro lus dans le titre (« Carte Pokémon Tokotoro 065/64 SV6a JP – Illustration rare »
  → Tokotoro, n° 065). Les lots et les objets qui ne sont pas des cartes n'ont pas de lien.
- **La langue** : lue dans le titre, sinon dans la description (« japonaise », « JP », « 🇯🇵 », « VF », « (EN) »,
  codes d'extension comme EV4.5 ou SV6a…). Sous les vignettes, où la description n'est pas visible, la langue lue
  sur une annonce déjà ouverte du même vendeur est reprise. Sans indice : français supposé, et c'est écrit.
- **L'état** : celui du menu de Vinted, traduit dans l'échelle de Cardmarket — Neuf → Near Mint, Très bon état →
  Excellent, Bon état → Good, Satisfaisant → Light Played — sauf si le vendeur écrit lui-même « NM », « near
  mint », « played »… Le filtre veut dire « cet état ou mieux ». Carte gradée (PSA 10…) : pas de filtre d'état.
- **À l'arrivée sur Cardmarket** : la recherche part avec le nom et le numéro ; la carte qui porte ce numéro est
  ouverte toute seule, filtres langue et état posés (si plusieurs cartes ont ce numéro, elles sont encadrées et tu
  choisis). Si la langue n'était que supposée et qu'aucune offre n'existe dans cette langue, le filtre est retiré.
- **Le bandeau** : prix Vinted (protection et envoi compris) à côté de l'offre Cardmarket la moins chère port
  compris (mêmes estimations de port que le reste de l'extension), l'écart, et des boutons pour changer de langue
  ou d'état en un clic. Quand l'envoi Vinted n'est pas connu, les deux prix sont comparés hors envoi.

Aucune requête n'est faite en arrière-plan : seules les pages que tu vois sont chargées (une recherche, puis la
fiche). Ce que l'annonce a appris voyage dans le fragment de l'adresse (`#cmrv=…`), qui n'est pas envoyé à
Cardmarket et quitte la barre d'adresse dès qu'il est lu.

Vinted n'envoie au navigateur ni indicateur « en train d'écrire » ni notification en temps réel (aucun canal de
ce type dans sa version web) : l'extension ne peut donc pas l'afficher.

Un refus de Vinted (403 / 429) met en pause **toutes** les lectures de l'extension (direct, prix d'envoi,
dressing) pendant 10 minutes, dans tous les onglets, même après un rechargement.

Sobriété : rien n'est lu tant que le panneau n'est pas ouvert ; les frais d'envoi ne sont demandés que pour les
annonces visibles, une à la fois, et gardés 24 h ; dans un dressing, 3 lectures suffisent quand le vendeur a le même
tarif partout ; après un refus de Vinted, la recherche continue sur les annonces affichées. Les deux affichages se désactivent en bas du panneau.

Tests : `npm test` (recherche, lecture des vignettes) et `npm run vinted-check` (vraie extension dans Chrome sans
fenêtre, sur un faux Vinted servi localement : aucune requête réelle).

## Partager l'extension (sans donner le dépôt)

`npm run zip` fabrique deux paquets dans `dist/` :

- **`Regroupeur-pour-Cardmarket-<version>.zip` — à donner directement (gratuit).** Il contient le dossier de
  l'extension et un `LISEZ-MOI.txt`. La personne décompresse, puis l'ajoute via `chrome://extensions` → *Mode
  développeur* → *Charger l'extension non empaquetée*. Son identifiant est fixe (clé de `store/cle-publique.txt`) :
  ses listes sont gardées même si elle déplace le dossier ou installe une mise à jour (remplacer le contenu du
  dossier, puis ↻). Le mode développeur doit rester activé.
- **`store/regroupeur-<version>.zip` — pour un store**, sans clé :
  - Chrome Web Store : 5 $ une fois, visibilité *Privé* ou *Non répertorié*, mises à jour automatiques ;
  - Microsoft Edge Add-ons : gratuit, visibilité *Hidden*, mais installable seulement dans Edge.

  Textes de fiche et justifications : `store/FICHE.md` ; visuels : `npm run store-assets` ; politique de
  confidentialité : `store/confidentialite.html`.

Hors Chrome Web Store, Chrome sous Windows ou Mac n'accepte aucun fichier d'installation (.crx) : le chargement en
mode développeur est la seule voie gratuite. Le code JavaScript reste lisible dans tout paquet d'extension ; seuls
le dépôt, l'historique et les outils de test restent privés.

## Diffusion avec mises à jour automatiques (GitHub)

Les versions prêtes à l'emploi sont publiées sur la branche
[`diffusion`](https://github.com/Lioxyze/Cardmarket-Regroupeur/tree/diffusion) de ce dépôt : zip, `version.json`
(version + empreinte SHA-256) et scripts d'installation. Configuration : `diffusion.json`.

**Chez la personne (une fois)** : Windows + R, puis coller la ligne indiquée dans le README de la branche
`diffusion`. L'installateur met l'extension dans `%LOCALAPPDATA%\Regroupeur-pour-Cardmarket\extension` et crée une
tâche planifiée (sans droits administrateur) qui vérifie les nouvelles versions toutes les 3 heures et à
l'ouverture de session. Reste à la charger une fois dans `chrome://extensions` (mode développeur).

**Publier une version** :

1. augmenter `"version"` dans `manifest.json` ;
2. `npm run publier -- "Ce qui change"` : tests, paquet, `version.json`, commit et envoi sur la branche `diffusion`
   (dossier de travail `../Cardmarket-Regroupeur-diffusion`, créé avec
   `git worktree add ../Cardmarket-Regroupeur-diffusion diffusion`).

Le PC équipé télécharge la nouvelle version, vérifie l'empreinte et remplace les fichiers ; le Regroupeur affiche
alors « Mise à jour prête → Activer maintenant » (sinon elle s'active au prochain démarrage de Chrome). Journal :
`%LOCALAPPDATA%\Regroupeur-pour-Cardmarket\mise-a-jour.log`.

## Développement

```bash
npm install
npm test           # optimiseur, parseurs (vraies pages enregistrées), analyse
npm run ui-check   # parcours complet dans Chrome sans fenêtre, sur un faux Cardmarket (captures dans tests/screenshots)
npm run vinted-check  # parcours Vinted avec la vraie extension, sur un faux Vinted
npm run icons      # régénère les icônes
npm run zip        # dist/ : paquet à donner (avec LISEZ-MOI) + paquet pour les stores
npm run publier -- "notes"  # publie une nouvelle version sur la branche diffusion (mises à jour automatiques)
npm run store-assets  # captures 1280×800 et vignette 440×280 pour la fiche du store
```

| Fichier | Rôle |
| --- | --- |
| `manifest.json`, `background.js` | Déclaration de l'extension, clic sur l'icône, détection des mises à jour |
| `distribution/`, `scripts/publier.js` | Installateur Windows, programme de mise à jour, publication sur la branche `diffusion` |
| `src/cm.js` | Identifiants Cardmarket (langues, états, pays), URL, lecture des pages |
| `src/fetcher.js` | File de requêtes : délai, pauses 429, détection Cloudflare |
| `src/storage.js` | Liste, réglages, cache (`chrome.storage.local`) |
| `src/analyzer.js` | Filtres, coût par carte et par vendeur, analyse réseau, saisie texte |
| `src/cart.js` | Ajout au panier (formulaire de la ligne, remplacement, vérification) |
| `src/optimizer.js` | Plans, combinaisons, statistiques vendeurs (sans dépendance, testé sous Node) |
| `src/panel.js`, `src/panel.css` | Interface (shadow DOM, thème clair/sombre) |
| `src/vinted.js` | Vinted : recherche dans un dressing, lot prérempli, prix avec envoi, messagerie (fichier autonome) |
| `src/vinted-page.js` | Vinted, dans la page : fait relire à Vinted ses propres données (messages en direct) |
| `tests/harness/` | Faux Cardmarket pour tester l'interface hors ligne |

Si Cardmarket change sa mise en page, les parseurs sont regroupés dans `src/cm.js`
et testés sur les pages de `tests/fixtures/` : enregistrer une page à jour et relancer `npm test`.
