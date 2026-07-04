# Procédure de release (interne)

Le module se diffuse via **GitHub Releases** ; le champ `manifest` de `module.json`
pointe sur `releases/latest/download/module.json` (mises à jour in-app), le champ
`download` pointe sur le zip **de la version précise**.

## À chaque version

1. Dans `module.json` : bumper `version` **et** `download`
   (`.../releases/download/vX.Y.Z/module.zip`).
2. Commit + push (`main`).
3. Construire le zip (contenu à la racine, sans `.git`) :
   ```powershell
   Compress-Archive -Path .\module.json, .\scripts, .\styles, .\lang, .\README.md -DestinationPath .\module.zip -Force
   ```
4. Créer la release GitHub taggée `vX.Y.Z` avec **deux assets** : `module.json` + `module.zip`.
   ```powershell
   gh release create vX.Y.Z .\module.zip .\module.json --title "vX.Y.Z" --notes "..."
   ```
5. Si le module est référencé sur foundryvtt.com : page « Authored Packages » → Edit →
   **+ Add** une release, avec l'URL de manifeste **versionnée**
   (`https://github.com/IGMLcreation/loremind-importer/releases/download/vX.Y.Z/module.json`,
   surtout pas `/latest/`).

## Test

Dans Foundry : *Install Module* → manifeste
`https://github.com/IGMLcreation/loremind-importer/releases/latest/download/module.json`,
puis import d'un bundle dans un monde de test.
