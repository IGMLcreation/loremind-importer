# LoreMind Importer

![Foundry v13](https://img.shields.io/badge/Foundry-v13-informational)
[![Dernière release](https://img.shields.io/github/v/release/IGMLcreation/loremind-importer)](https://github.com/IGMLcreation/loremind-importer/releases/latest)

> **English** — LoreMind Importer brings a campaign bundle exported from **DM Loremind** (a campaign-prep companion app) into Foundry VTT: folders, ready-to-play scenes (Universal VTT battlemaps with walls, doors and lights), journals (player narration + GM notes), roll tables, NPCs and enemies — including actor creation and token placement through a system-agnostic compendium bridge. The module UI is available in English and French. The documentation below is in French.

**LoreMind Importer** importe en un clic une campagne préparée dans **DM Loremind** vers Foundry VTT. Vous préparez votre campagne dans DM Loremind (narration, scènes, battlemaps, PNJ, ennemis, tables aléatoires) et le module recrée tout dans votre monde Foundry, prêt à jouer.

## Ce que le module importe

- **Dossiers** : l'arborescence de la campagne est recréée dans Foundry.
- **Scènes** : chaque battlemap devient une scène complète — fond, grille, **murs, portes et lumières** — à partir des fichiers Universal VTT (`.uvtt` / `.dd2vtt`, Dungeondraft & co) ou de l'export « Foundry VTT » de **Dungeon Alchemist**.
- **Journaux** : narration côté joueurs et notes MJ, chaque scène étant liée à son journal.
- **Tables aléatoires** : les tables LoreMind deviennent des RollTables Foundry.
- **PNJ et ennemis** : fiches en journaux (nom, portrait, champs), et pour les ennemis liés aux scènes, création d'**acteurs** et pose de **tokens** sur la battlemap (voir plus bas).

L'import est **réimportable** : relancer l'import d'un bundle nettoie et recrée les éléments, en conservant les acteurs déjà importés et les stats saisies à la main.

## Prérequis

- **Foundry VTT v13**
- L'application **DM Loremind** pour préparer la campagne et générer le bundle (`.zip`)

## Installation

Dans Foundry : **Add-on Modules → Install Module**, puis coller l'URL de manifeste :

```
https://github.com/IGMLcreation/loremind-importer/releases/latest/download/module.json
```

Activez ensuite le module dans votre monde (**Game Settings → Manage Modules**).

## Utilisation

1. Dans DM Loremind : page de la campagne → **« Exporter pour Foundry »** → récupérez le `.zip`.
2. Dans Foundry, connecté en **MJ** : bouton **« Importer LoreMind »** en haut de l'onglet *Journaux* (ou via macro : `game.modules.get("loremind-importer").api.import();`).
3. Sélectionnez le `.zip` : le module crée dossiers, scènes, journaux, tables et acteurs.

## Pont monstres : Foundry ⇄ LoreMind

Le pont fonctionne par **référence** (UUID de compendium), pas par copie de stats — il est donc **compatible avec tous les systèmes de jeu**.

1. **Foundry → LoreMind** : onglet *Acteurs* → **« Exporter monstres → LoreMind »**. Cochez les sources (acteurs du monde et/ou compendiums) : le module produit un `loremind-monsters-<système>.json` avec, pour chaque monstre, son nom, sa référence, son dossier et son portrait en vignette.
2. **Dans DM Loremind** : Bestiaire de la campagne → « Importer des monstres Foundry ». Les ennemis sont créés (ou mis à jour, sans doublon) avec leur arborescence de dossiers.
3. Liez ces ennemis à vos scènes dans DM Loremind, puis exportez la campagne.
4. **À l'import du bundle** : chaque ennemi référencé est ré-importé depuis son compendium (une seule fois, puis réutilisé) et un **token** est posé sur la battlemap.

> Le compendium source doit être installé dans le monde cible. Les stats restent 100 % natives Foundry.

**Ennemis créés dans LoreMind (sans référence)** : un acteur est créé quand même (avec portrait si disponible) et un token est posé. Les stats saisies ensuite dans Foundry **persistent aux réimports**.

## Ennemis maison avec vraies stats (mapping de structure)

Pour que les ennemis créés dans DM Loremind sortent en **acteurs typés** avec leurs stats (PV, armure, attributs) :

1. Dans Foundry, sélectionnez un token exemple → onglet *Acteurs* → **« Exporter structure → LoreMind »** : produit un `loremind-structure-<système>.json`.
2. Dans DM Loremind : édition du **Système de jeu** → « Importer une structure Foundry ». Le template Ennemi se remplit avec les champs mappés ; élaguez/renommez, enregistrez.
3. Créez vos monstres dans DM Loremind en remplissant ces champs et liez-les aux scènes.
4. À l'import, chaque ennemi mappé est créé comme **acteur du bon type** avec ses stats. Les capacités et sorts restent à ajouter côté Foundry.

## Limites connues

- Les PNJ et ennemis non liés à une scène restent des **journaux** (pas de fiche d'acteur).
- L'échelle des **lumières** UVTT est une heuristique (grille à 5 unités par case) : à ajuster selon votre système.
- La **grille** est carrée, `distance = 5 ft` par défaut.
- Une scène sans fichier UVTT (image seule) est importée à plat, sans murs ni lumières.

## Support

Un problème, une idée ? Ouvrez un ticket sur [GitHub Issues](https://github.com/IGMLcreation/loremind-importer/issues).

## Licence

Module propriétaire, © IGML Creation — utilisation libre et gratuite avec
Foundry VTT, redistribution et revente interdites. Voir [LICENSE](LICENSE).

---

Module compagnon de **DM Loremind**, © IGML Creation.
