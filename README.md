# LoreMind Importer (Foundry VTT v13)

Importe un **bundle de campagne LoreMind / DM Loremind** dans Foundry VTT : dossiers,
**scènes** (battlemaps → fond + grille + murs + portes + lumières),
**journaux** (narration joueur + notes MJ), **PNJ** et **ennemis** (en journaux).

Formats de sidecar de battlemap gérés : **export « Foundry VTT » de Dungeon Alchemist**
(Scene à plat) et **Universal VTT** (.uvtt/.dd2vtt, Dungeondraft & co).

> Module compagnon de LoreMind. Le `.zip` se génère côté LoreMind via
> **Page d'une campagne → « Exporter pour Foundry »**.

## Installation

**Via URL de manifeste (recommandé)** — dans Foundry : *Add-on Modules → Install Module*,
coller l'URL du manifeste :

```
https://github.com/IGMLcreation/loremind-importer/releases/latest/download/module.json
```

**Manuel** — copier ce dossier dans `Data/modules/loremind-importer/`, puis activer le
module dans le monde.

> Remplace `IGMLcreation/loremind-importer` par ton dépôt GitHub réel (cf. `module.json`).

## Utilisation

1. Dans LoreMind : ouvre une campagne → **Exporter pour Foundry** → récupère le `.zip`.
2. Dans Foundry (en **MJ**), deux options :
   - **Bouton** « Importer LoreMind » dans l'onglet *Journaux* ;
   - **Macro / console** (toujours fiable) :
     ```js
     game.modules.get("loremind-importer").api.import();
     ```
3. Sélectionne le `.zip`. Le module crée dossiers, journaux et scènes, et lie chaque
   scène à son journal.

## Monstres : Foundry → LoreMind → tokens

Pont bidirectionnel basé sur la **référence** (UUID de compendium), pas la copie des
stats → **compatible tous systèmes**.

1. **Foundry → LoreMind** : onglet *Acteurs* → bouton « Exporter monstres → LoreMind »
   (ou `game.modules.get("loremind-importer").api.exportMonsters(["world", "nimble.monsters"])`).
   Coche les sources : **Acteurs du monde** (coché par défaut) et/ou compendiums d'acteurs
   → produit un `loremind-monsters-<system>.json` (`{ name, uuid, folder, stats, imgData }` par monstre).
   L'**arborescence de dossiers** est conservée et recréée sous un dossier `Foundry/` côté LoreMind.
   Le **portrait** de chaque acteur est embarqué en vignette (redimensionnée ≤ 512 px, webp/jpeg
   base64) → importé comme illustration de la fiche (les `.svg` génériques sont ignorés).
2. **LoreMind** : Bestiaire d'une campagne → « Importer des monstres Foundry » → choisis
   le `.json`. Crée des ennemis (nom + référence), upsert par référence (pas de doublon).
3. Lie ces ennemis à tes scènes dans LoreMind, exporte la campagne vers Foundry.
4. **À l'import du bundle** : pour chaque ennemi lié qui a une référence, le module
   ré-importe l'acteur du compendium dans le monde (une fois, réutilisé) et pose un
   **token** sur la battlemap à une **position aléatoire** (tu ajustes).

> Les stats restent natives Foundry. Le compendium source doit être installé dans le
> monde cible. Les acteurs importés sont conservés (réutilisés) ; les tokens sont
> nettoyés avec les scènes à la réimportation.

**Ennemis faits main (sans référence)** : un **acteur placeholder** nommé (type par
défaut du système, + portrait si dispo) est créé et un token posé quand même. Les
stats sont à remplir côté Foundry — et elles **persistent aux réimports** (l'acteur
placeholder est conservé, mémoïsé par ennemi).

## Structure du système → ennemis maison typés

Pour que les ennemis **créés dans LoreMind** sortent en **vrais acteurs typés** (PV,
armure, attributs — pas les capacités/sorts) :

1. Dans Foundry, **sélectionne un token** (acteur exemple du système, ex. un monstre
   Nimble) → onglet *Acteurs* → « Exporter structure → LoreMind » (ou
   `api.exportSystemStructure()`, ou `api.exportSystemStructure("uuid")`). Produit un
   `loremind-structure-<system>.json` (champs scalaires + chemins Foundry + type d'acteur).
2. Dans LoreMind : édite le **Système de jeu** → « Importer une structure Foundry » →
   choisis le `.json`. Le **template Ennemi** se remplit (champs mappés) + le type
   d'acteur est posé. Élague/renomme les champs, enregistre.
3. Crée tes monstres maison dans LoreMind en remplissant ces champs, lie-les aux scènes.
4. À l'import du bundle : un ennemi maison **mappé** (sans référence compendium) est créé
   comme **acteur du bon type** avec `system.<chemin> = valeur` → stats correctes. Sans
   mapping → placeholder vide. Les **capacités/sorts** restent à ajouter dans Foundry.

## Distribution (GitHub)

Le module se diffuse via **GitHub Releases** (URLs `latest/download/...` dans `module.json`) :

1. Dépôt GitHub `loremind-importer` (public).
2. Pour chaque version : créer une **Release** taggée (`v0.1.0`, …) avec **deux assets** :
   - `module.json` (ce fichier, avec la bonne `version`) ;
   - `module.zip` (zip du contenu du module : `module.json`, `scripts/`, `styles/`,
     `lang/`).
3. Les URLs `releases/latest/download/module.json` et `.../module.zip` se résolvent
   automatiquement → mise à jour in-app gérée par Foundry.

Un workflow GitHub Actions peut packager + publier la release à chaque tag (à ajouter).

## Périmètre v1 / limites (à itérer en jeu)

- **Acteurs** : les PNJ/ennemis partent en **journaux** (nom + portrait + champs résolus),
  pas en fiches d'acteur jouables (mapping système-dépendant → version ultérieure).
- **Lumières UVTT** : l'échelle (range cases → portée Foundry) est une **heuristique**
  (`distance` de grille = 5) à ajuster selon ton système.
- **Grille** : carrée, `distance = 5 ft` par défaut.
- **Scène sans sidecar UVTT** (média seul) : scène plate (fond + grille par défaut),
  sans murs/lumières.
- Non testé en CI (dépend de l'API Foundry) : **valider et ajuster dans Foundry v13**.

## Structure

```
loremind-importer/
├── module.json
├── scripts/
│   ├── main.js       # entrée : API + bouton sidebar + dialog fichier
│   ├── bundle.js     # lecture du .zip (sans dépendance)
│   ├── uvtt.js       # Universal VTT → données de Scene
│   └── importer.js   # orchestration (assets, dossiers, scènes, journaux)
├── styles/loremind.css
└── lang/{fr,en}.json
```
