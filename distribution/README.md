# Regroupeur pour Cardmarket

Extension Chrome qui trouve les vendeurs Cardmarket ayant le plus de cartes de ta liste : moins de commandes,
moins de frais de port. Extension indépendante, non affiliée à Cardmarket.

Version actuelle : **__VERSION__**

## Installation (une seule fois, Windows)

1. Appuie sur **Windows + R**, colle cette ligne, puis **Entrée** :

   ```
   powershell -ep bypass -c "iwr -useb https://raw.githubusercontent.com/__REPO__/main/installer.ps1 -OutFile $env:TEMP\ri.ps1; & $env:TEMP\ri.ps1"
   ```

   *Ou* : clic droit sur **[Installer-Regroupeur.cmd](https://github.com/__REPO__/raw/main/Installer-Regroupeur.cmd)**
   → « Enregistrer le lien sous… », puis double-clique sur le fichier. Si Windows affiche « Windows a protégé votre
   ordinateur », clique **Informations complémentaires → Exécuter quand même**.

2. Dans Chrome, ouvre `chrome://extensions`, active **Mode développeur** (en haut à droite), clique **Charger
   l'extension non empaquetée** et choisis le dossier indiqué par l'installateur
   (`%LOCALAPPDATA%\Regroupeur-pour-Cardmarket\extension` ; son chemin est déjà copié, colle-le avec Ctrl+V).

3. Va sur [cardmarket.com](https://www.cardmarket.com) : le bouton **Regroupeur** apparaît en bas à droite.

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
www.cardmarket.com, avec ta session, et n'ajoute des cartes à ton panier que quand tu le demandes ; elle n'achète
jamais rien. Le seul autre accès réseau est la lecture de `version.json` sur ce dépôt, pour savoir si une nouvelle
version existe.
