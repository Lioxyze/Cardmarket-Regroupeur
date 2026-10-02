# Regroupeur Cardmarket

Extension Chrome / Edge / Brave qui cherche, pour une liste de cartes, **la
combinaison de vendeurs Cardmarket la moins chère frais de port compris**, et
celle qui demande **le moins de commandes**.

Elle ne cherche pas seulement le vendeur le moins cher carte par carte. Payer une
carte 0,20 € de plus chez un vendeur qui a déjà le reste de ta liste revient
souvent moins cher qu'un colis de plus.

## Installation (mode développeur)

1. Ouvrir `chrome://extensions` (ou `edge://extensions`).
2. Activer le **mode développeur**.
3. **Charger l'extension non empaquetée** et choisir ce dossier (celui qui contient `manifest.json`).
4. Aller sur [cardmarket.com](https://www.cardmarket.com/fr/Pokemon) : un bouton
   **Regroupeur** apparaît en bas à droite. L'icône de l'extension ouvre et ferme aussi le panneau.

Après une modification du code, cliquer ↻ sur la carte de l'extension, puis recharger l'onglet Cardmarket.

## Utilisation

**1. Ajouter les cartes à acheter** (onglet *1 · Mes cartes*)

- Taper le nom d'une carte dans **Ajouter une carte ou un coffret** puis **Chercher**, et cliquer
  **+ Ajouter** sur la bonne version (ou **+ PSA** pour la vouloir gradée).
- Pour un produit scellé, choisir **Coffrets, ETB, tins**, **Displays** ou *Autres… → Boosters /
  Lots* avant de chercher.
- Ou, sur la page d'une carte Cardmarket, cliquer **+ Ajouter cette carte** (en bas à droite).
- Ou importer une wants list (bouton **Importer** sur la page de la wants list).
- **Coller une liste** (dans le champ de recherche ou dans *Coller une liste de cartes*), une carte par
  ligne. Le format le plus fiable est **numéro — nom** :

  ```
  065 — Tokotoro
  080 — Hyporoi-ex
  2x 085 — Pêchaminus-ex
  Houndoom (SFA 066)        ← format des noms Cardmarket, code d'extension compris
  ```

  L'extension est reconnue toute seule : 2 ou 3 noms sont cherchés, et l'extension qui a la bonne carte
  au bon numéro l'emporte. La liste complète de l'extension est ensuite lue (100 cartes par page) et
  chaque ligne est associée **par son numéro**. Les cartes au même nom (Pêchaminus-ex en 085, 093,
  095…) ne sont donc jamais confondues. Un aperçu « 065 Tokotoro → carte trouvée » permet de vérifier
  avant d'ajouter. Une liste de 35 cartes coûte ainsi 3 à 5 pages au lieu de 35. Si l'extension n'est
  pas reconnue, on la choisit dans la liste. Avec le code d'extension (« (SFA 066) »), une seule
  recherche suffit par extension, et une liste qui mélange plusieurs extensions est traitée extension
  par extension. Les lignes sans numéro sont cherchées une par une ; au-delà de 8, l'extension demande
  ton accord avant de lancer les recherches. `Nom | Numéro | Extension | Langue | État | Qté` reste
  possible.

Par défaut, l'extension cherche des cartes **loose** (non gradées) en français, Near Mint ou mieux
(bouton **Réglages**). La quantité se règle avec **− / +** sur chaque ligne ; **Modifier** donne
accès à la langue, au type (loose / gradée, société de gradation, note minimum), à l'état,
à la version (normale ou reverse/foil) et au prix max.

**2. Cliquer « Trouver les vendeurs »** : l'extension lit les offres de chaque carte, puis
interroge le stock des vendeurs les plus prometteurs sur les cartes qu'ils
n'affichaient pas parmi les moins chères (*vérification approfondie*).

**3. Lire les résultats**

| Bloc | Contenu |
| --- | --- |
| Le meilleur choix | La réponse en une phrase (« Commande chez 2 vendeurs », total port compris, économie), avec la liste des cartes à prendre chez chaque vendeur, et les boutons **Tout ajouter au panier** / **Ajouter ces cartes au panier** (par vendeur). |
| Autres options | *Encore moins de colis* (si ça coûte un peu plus) et la référence *chaque carte au moins cher*. **Copier** met une liste d'achat dans le presse-papiers. |
| Combinaisons | Meilleures combinaisons de 1, 2 ou 3 vendeurs : cartes couvertes, manquantes, prix des cartes, port, total. |
| Vendeurs | Tous les vendeurs trouvés, triables et filtrables (pays, type, nombre de cartes) : cartes couvertes, manquantes, prix, **score de pertinence** (70 % couverture de la liste, 30 % compétitivité prix). Un vendeur peut être exclu d'un clic. |
| Détail par carte | Offres retenues, prix mini, tendance, et raisons des offres écartées. |

Les réglages « côté client » (prix max, ventes minimum, exclusions, frais de port,
pénalité par commande) recalculent les résultats **instantanément**, sans relire Cardmarket.

## Les réglages qui font le prix

En haut de ta liste et des résultats, trois choix en un clic :

- **État** : `NM`, `EX ou mieux`, `GD ou mieux`. EX ou GD font baisser les prix ; le NM reste
  pris quand il est moins cher.
- **Langues** : français et japonais par défaut (anglais ou toutes en un clic).
- **Prix** : *Toujours le moins cher* (aucun surcoût) ou *Regrouper (+10 % max)*.

Changer l'état ou les langues demande de relancer la recherche : les pages déjà lues ne
contiennent que les offres des anciens critères. Un bouton **Relancer la recherche** apparaît.

## Prix : toujours proches du moins cher

Pour regrouper, l'extension accepte de payer une carte un peu plus que la moins chère,
mais **jamais plus de +10 % (ou +0,30 € pour les petites cartes)** au-dessus de la moins
chère qui respecte tes critères (état, langue…). Chaque ligne du plan affiche son écart
(« +0,06 € ») ou « min » si c'est le prix le plus bas. Le bouton **Toujours le moins cher**
supprime tout surcoût ; le réglage est dans *Réglages → Surcoût max pour regrouper*.

En haut des résultats, *Prix basés sur* rappelle les filtres qui fixent les prix. **Français
uniquement** coûte souvent bien plus cher que **Toutes langues** : un clic suffit à changer,
puis on relance la recherche.

## Ajout au panier

Il faut être **connecté à Cardmarket**. Rien n'est acheté : les articles vont dans ton panier,
tu vérifies et tu paies toi-même.

Pour chaque carte, l'extension ouvre la page où se trouve l'offre retenue (stock du vendeur,
sinon page de la carte) et rejoue le formulaire « ajouter au panier » que Cardmarket affiche
dans la ligne de l'offre. Si l'offre a été vendue entre-temps, elle prend chez le même vendeur
une offre équivalente (mêmes critères, au plus 25 % plus chère), sinon elle le signale. À la
fin, elle relit ton panier pour confirmer que chaque article y est.

En cas d'échec, **Copier le diagnostic** copie un résumé anonymisé (sans ton jeton de
session) à me renvoyer pour corriger.

## Frais de port réels

Après un ajout au panier, l'extension relit la page panier de Cardmarket, prend les frais de
port réellement affichés pour chaque vendeur et en fait une moyenne par pays d'expédition
(lettre / suivi). Ces moyennes remplacent l'estimation aux calculs suivants (*Réglages → Frais
vus au panier*, bouton **Oublier** pour revenir aux estimations). Un montant illisible ou
aberrant (hors 0,30 € – 15 €) est ignoré.

## Repères sur les pages Cardmarket

Sans aucune requête (à partir des derniers résultats) :

- sur la page d'une carte, les vendeurs de ton plan sont marqués **★ ton plan**, ceux qui ont
  plusieurs cartes de ta liste **« 12 cartes de ta liste »** ;
- dans le stock d'un vendeur, les cartes de ta liste sont marquées **✓ dans ta liste** ;
- sur la page d'un vendeur, le bouton en bas à droite indique combien de tes cartes il a.

## Plusieurs listes, export, annulation

- **Listes** : menu *Liste* en haut de *Mes cartes* (« ＋ Nouvelle liste… », Renommer,
  Supprimer). Chaque liste garde ses cartes et ses derniers résultats.
- **Exporter (CSV)** : le plan d'achat pour un tableur (vendeur, carte, état, prix, moins
  chère, port, total).
- Retirer une carte ou vider la liste propose **Annuler** pendant quelques secondes.

## Tester sur le vrai Cardmarket

*Réglages → Tester sur Cardmarket* vérifie en environ 5 pages ce qui dépend du site :
- recherche en français ;
- lecture des offres, y compris qu'elles sont bien triées du moins cher au plus cher ;
- bouton panier, sans rien ajouter ;
- stock d'un vendeur ;
- liste d'une extension ;
- lecture du port au panier.

**Copier le rapport** donne un texte anonymisé à envoyer pour corriger ce qui ne passe pas.

## Loose ou gradée (PSA…)

Cardmarket n'a pas de case « carte gradée » : les vendeurs l'écrivent dans leur commentaire.
L'extension lit ce commentaire (« PSA 10 », « psa10 gem mint », « CGC 9.5 », « BGS 9,5 »,
« slab »…) et ignore les annonces du type « PSA ready », « candidate PSA 10 », « parfaite pour
grading » ou « non gradée », qui sont des cartes loose.

- **Loose** (par défaut) : les cartes gradées sont écartées.
- **Gradée** : seules les gradées sont gardées, avec au besoin la société (PSA, BGS, CGC…) et
  la note minimum. L'état n'est pas filtré (une carte gradée peut être déclarée dans n'importe
  quel état), et l'extension lit jusqu'à 300 offres, car les gradées arrivent loin derrière les
  loose dans un classement par prix.

## Coffrets et produits scellés

Les coffrets, ETB, displays, boosters et lots s'ajoutent comme les cartes, et peuvent être
mélangés aux cartes dans une même liste. Pour eux, seuls la langue, le prix max et la quantité
comptent. La vérification approfondie (stock des vendeurs) ne concerne que les cartes à l'unité.

## Nombre de requêtes

L'extension lit Cardmarket comme une personne le ferait, en restant sobre :

- **une seule page à la fois pour tout l'onglet** (recherche, analyse et panier passent par la
  même file), avec **3 s minimum** entre deux pages (réglable, jamais moins de 2 s) ;
- si Cardmarket répond « trop de requêtes », pause (30 s, 1 min, 2 min…) puis rythme ralenti jusqu'au
  rechargement de la page ;
- **1 page (50 offres) par carte** par défaut. La vérification approfondie est plafonnée à
  4 vendeurs et 20 pages ;
- **plafond de 120 pages par analyse** (réglable) : au-delà, l'analyse s'arrête proprement avec des
  résultats partiels ;
- cache d'une heure : relancer ou changer un réglage ne relit pas les pages déjà vues ;
- l'estimation du nombre de pages s'affiche avant de lancer (« 35 cartes · ≈ 50 pages ·
  environ 4 min »).

## Frais de port

Cardmarket ne publie pas de barème exploitable par vendeur. L'extension utilise une
**estimation par commande en 3 paliers**, selon sa valeur :

| Commande | Même pays | Autre pays |
| --- | --- | --- |
| moins de 25 € (lettre) | 1,60 € | 2,20 € |
| 25 à 100 € (suivi) | 3,50 € | 5,50 € |
| 100 € et plus (recommandé / assuré) | 7,00 € | 12,00 € |

Tout est réglable. Dès qu'un ajout au panier a eu lieu, le **port réel** lu sur Cardmarket
remplace ces estimations (voir plus bas). Après l'ajout, le bloc *Panier Cardmarket* compare
le panier réel des vendeurs du plan (cartes + port) à l'estimation. Il signale aussi les
articles en trop (doublons, reste d'un ancien panier) et les autres vendeurs déjà présents
dans ton panier.

La **pénalité par commande** est une préférence : à 1 €, une commande supplémentaire
doit faire gagner plus d'1 € (en plus du port) pour être retenue. Elle n'est jamais
ajoutée aux totaux affichés.

## Comment ça marche

- **Lecture** (`src/cm.js`, `src/fetcher.js`) : les pages sont lues depuis l'onglet
  Cardmarket, avec ta session, **une par une** (2,5 s entre deux pages par défaut,
  pause automatique si le site demande de ralentir). Pages lues en anglais pour des
  libellés stables, liens affichés dans ta langue. Filtres envoyés dans l'URL
  (`language`, `minCondition`, `sellerCountry`, `sellerType`, `isReverseHolo`…),
  puis revérifiés offre par offre, car Cardmarket ignore silencieusement un filtre inconnu.
  Cache d'une heure : relancer après une interruption ne relit pas les cartes déjà vues.
- **Optimisation** (`src/optimizer.js`) : c'est un problème de localisation
  d'entrepôts (chaque vendeur retenu coûte son port). Il est résolu par glouton puis
  recherche locale (ajout / retrait / échange de vendeurs) à partir de plusieurs
  départs. Sur 200 cas aléatoires, le résultat est identique à la recherche exhaustive.
  Les combinaisons à 1 ou 2 vendeurs sont énumérées exactement.
- **Quantités** : un vendeur ne « couvre » une carte que s'il en a assez d'exemplaires
  (en cumulant ses offres, des moins chères aux plus chères).

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

## Développement

```bash
npm install
npm test           # optimiseur, parseurs (vraies pages enregistrées), analyse
npm run ui-check   # parcours complet dans Chrome sans fenêtre, sur un faux Cardmarket (captures dans tests/screenshots)
npm run icons      # régénère les icônes
npm run zip        # dist/ : paquet à donner (avec LISEZ-MOI) + paquet pour les stores
npm run store-assets  # captures 1280×800 et vignette 440×280 pour la fiche du store
```

| Fichier | Rôle |
| --- | --- |
| `manifest.json`, `background.js` | Déclaration de l'extension, clic sur l'icône |
| `src/cm.js` | Identifiants Cardmarket (langues, états, pays), URL, lecture des pages |
| `src/fetcher.js` | File de requêtes : délai, pauses 429, détection Cloudflare |
| `src/storage.js` | Liste, réglages, cache (`chrome.storage.local`) |
| `src/analyzer.js` | Filtres, coût par carte et par vendeur, analyse réseau, saisie texte |
| `src/cart.js` | Ajout au panier (formulaire de la ligne, remplacement, vérification) |
| `src/optimizer.js` | Plans, combinaisons, statistiques vendeurs (sans dépendance, testé sous Node) |
| `src/panel.js`, `src/panel.css` | Interface (shadow DOM, thème clair/sombre) |
| `tests/harness/` | Faux Cardmarket pour tester l'interface hors ligne |

Si Cardmarket change sa mise en page, les parseurs sont regroupés dans `src/cm.js`
et testés sur les pages de `tests/fixtures/` : enregistrer une page à jour et relancer `npm test`.
#   C a r d m a r k e t - R e g r o u p e u r  
 #   C a r d m a r k e t - R e g r o u p e u r  
 