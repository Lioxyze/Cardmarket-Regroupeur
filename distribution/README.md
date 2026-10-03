# Regroupeur pour Cardmarket

Extension Chrome pour acheter des cartes plus simplement :

- **Cardmarket** : trouve les vendeurs ayant le plus de cartes de ta liste (moins de commandes, moins de frais de port) ;
- **Vinted** : recherche dans le dressing d'un vendeur, lot prérempli en un clic, prix avec envoi et nom de l'annonce
  sous chaque vignette.

Extension indépendante, non affiliée à Cardmarket ni à Vinted.

Version actuelle : **__VERSION__**

## Installation (une seule fois, Windows)

1. Appuie sur **Windows + R**, colle cette ligne, puis **Entrée** :

   ```
   powershell -ep bypass -c "iwr -useb https://raw.githubusercontent.com/__REPO__/main/installer.ps1 -OutFile $env:TEMP\ri.ps1; & $env:TEMP\ri.ps1"
   ```

   *Ou* : clic droit sur **[Installer-Regroupeur.cmd](https://raw.githubusercontent.com/__REPO__/main/Installer-Regroupeur.cmd)**
   → « Enregistrer le lien sous… », puis double-clique sur le fichier. Si Windows affiche « Windows a protégé votre
   ordinateur », clique **Informations complémentaires → Exécuter quand même**.

2. Dans Chrome, ouvre `chrome://extensions`, active **Mode développeur** (en haut à droite), clique **Charger
   l'extension non empaquetée** et choisis le dossier indiqué par l'installateur
   (`%LOCALAPPDATA%\Regroupeur-pour-Cardmarket\extension` ; son chemin est déjà copié, colle-le avec Ctrl+V).

3. Va sur [cardmarket.com](https://www.cardmarket.com) : le bouton **Regroupeur** apparaît en bas à droite.
   Sur [vinted.fr](https://www.vinted.fr), ouvre le dressing d'un vendeur : bouton **Chercher dans ce dressing**.

Laisse le **Mode développeur** activé : sinon Chrome désactive l'extension.

## Mises à jour

Automatiques : ton PC vérifie toutes les 3 heures (et à chaque ouverture de session) s'il existe une nouvelle
version, la télécharge et contrôle son empreinte SHA-256. Le Regroupeur affiche alors **« Mise à jour prête →
Activer maintenant »** ; sinon, elle s'active au prochain redémarrage de Chrome. Tes listes et réglages sont conservés.

Journal : `%LOCALAPPDATA%\Regroupeur-pour-Cardmarket\mise-a-jour.log`.

## Désinstallation

Clic droit sur `%LOCALAPPDATA%\Regroupeur-pour-Cardmarket\desinstaller.ps1` → **Exécuter avec PowerShell**, puis
**Supprimer** l'extension dans `chrome://extensions`.

## Confidentialité

Aucune donnée n'est envoyée à qui que ce soit : tout reste dans ton navigateur. L'extension ne lit que des pages de
www.cardmarket.com et de www.vinted.fr, avec ta session. Elle n'ajoute des cartes à ton panier Cardmarket ou à un
lot Vinted que quand tu le demandes, et n'achète jamais rien. Le seul autre accès réseau est la lecture de
`version.json` sur ce dépôt, pour savoir si une nouvelle version existe.
