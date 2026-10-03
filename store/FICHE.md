# Fiche Chrome Web Store — Regroupeur — Cardmarket & Vinted

Textes prêts à copier-coller dans le tableau de bord développeur
(https://chrome.google.com/webstore/devconsole), onglet par onglet.

Fichier à envoyer : `dist/store/regroupeur-1.0.0.zip` (`npm run zip` le régénère ; ce paquet n'a pas de champ « key », que les stores refusent).

---

## Onglet « Fiche du Chrome Web Store »

**Nom** (repris du manifeste) : Regroupeur — Cardmarket & Vinted

**Résumé** (132 caractères max, repris du manifeste) :
Trouve les vendeurs Cardmarket qui ont le plus de cartes de ta liste : moins de commandes, moins de port. Non officiel.

**Description** :

```
Tu veux acheter 20, 30 ou 50 cartes sur Cardmarket sans passer 20 commandes et payer 20 fois le port ?
Le Regroupeur cherche à ta place les vendeurs qui ont le plus de cartes de ta liste et te dit chez qui commander.

COMMENT ÇA MARCHE
1. Ajoute tes cartes : bouton « + Ajouter cette carte » sur une page Cardmarket, recherche par nom, ou colle une liste
   (« 065 — Tokotoro », « Houndoom (SFA 066) »…). L'extension est reconnue toute seule et chaque carte est retrouvée
   par son numéro.
2. Clique « Trouver les vendeurs ».
3. Lis la réponse : « Commande chez 3 vendeurs : 42,50 € port compris », avec les cartes à prendre chez chacun,
   puis « Tout ajouter au panier ».

CE QUI LE REND UTILE
• Prix maîtrisés : jamais plus de +10 % au-dessus de la carte la moins chère pour regrouper, ou « Toujours le moins cher ».
• État au choix (NM, EX ou mieux, GD ou mieux), langues au choix (français, japonais, anglais…), cartes loose ou gradées (PSA…).
• Coffrets, ETB, displays et boosters aussi.
• Port estimé selon la valeur de la commande (lettre, suivi, assuré), puis corrigé avec le port réel lu dans ton panier.
• Combinaisons de 1 à 3 vendeurs, tableau de tous les vendeurs, export CSV, plusieurs listes.

RESPECTUEUX DE CARDMARKET ET DE TA VIE PRIVÉE
• Une seule page lue à la fois, au moins 3 secondes d'écart, avec plafond par analyse et cache.
• Rien n'est acheté : les cartes vont dans ton panier, tu vérifies et tu paies toi-même.
• Aucune donnée envoyée à qui que ce soit : tout reste dans ton navigateur.

Extension indépendante, non affiliée à Cardmarket.
```

**Catégorie** : Achats (Shopping)

**Langue** : Français

**Images** (dossier `store/`) :
- Icône : `icons/icon-128.png` (déjà dans le paquet)
- Captures 1280×800 : `capture-1-liste.png`, `capture-2-resultats.png`, `capture-3-vendeurs.png`
- Petite vignette promotionnelle 440×280 : `promo-440x280.png`

**Site web / assistance** : facultatif (laisser vide ou mettre l'URL de la politique de confidentialité).

---

## Onglet « Confidentialité »

**Objectif unique** :

```
Aider à acheter une liste de cartes sur Cardmarket en trouvant les vendeurs qui permettent de passer le moins de
commandes et de payer le moins de frais de port, puis ajouter les cartes choisies au panier Cardmarket.
```

**Justification de « storage »** :

```
Enregistrer localement les listes de cartes, les réglages (langues, état, frais de port), les derniers résultats et un
cache temporaire des pages lues, pour ne pas relire Cardmarket inutilement. Rien n'est envoyé hors du navigateur.
```

**Justification de l'accès à l'hôte https://www.cardmarket.com/\*** :

```
L'extension ne fonctionne que sur Cardmarket : elle affiche son panneau sur les pages du site, lit les offres des cartes
de la liste de l'utilisateur (à sa demande, une page à la fois), et ajoute les cartes choisies à son panier quand il
clique sur « Ajouter au panier ». Aucun autre site n'est consulté.
```

**Code distant** : Non, je n'utilise pas de code distant (tout le JavaScript est dans le paquet).

**Utilisation des données** — Google demande de déclarer aussi ce qui est traité **uniquement sur l'appareil** :
- Cocher **« Contenu des sites Web »** : les offres Cardmarket lues pour le calcul (gardées en local, jamais transmises).
- Ne pas cocher : informations personnelles, santé, finances/paiement, authentification, localisation, historique
  Web, activité de l'utilisateur, communications.

Puis cocher les trois certifications : pas de vente de données à des tiers, pas d'usage sans rapport avec l'objectif
unique, pas d'usage pour évaluer un crédit.

**URL de la politique de confidentialité** : l'adresse publique où sera mise `store/confidentialite.html`
(voir « Héberger la politique de confidentialité » plus bas).

---

## Onglet « Distribution »

- **Visibilité** : *Privé* avec ton collègue en testeur de confiance, ou *Non répertorié* (seules les personnes qui
  ont le lien peuvent l'installer). Dans les deux cas, pas de page publique dans les résultats de recherche.
- **Pays** : tous, ou seulement la France.
- **Prix** : gratuit.

---

## Héberger la politique de confidentialité

Le store demande une URL publique. Le plus simple, sans exposer le code :
- un dépôt GitHub public **qui ne contient que** `confidentialite.html` (renommé `index.html`), avec GitHub Pages
  activé → `https://<ton-pseudo>.github.io/regroupeur-confidentialite/` ;
- ou une page Google Sites / Notion publique avec le même texte.

---

## Mettre à jour plus tard

1. Augmenter `version` dans `manifest.json` (ex. 1.0.1).
2. `npm test`, puis `npm run zip`.
3. Tableau de bord → l'extension → « Package » → « Importer un nouveau package » → envoyer pour examen.
   Les utilisateurs reçoivent la mise à jour automatiquement après validation.
