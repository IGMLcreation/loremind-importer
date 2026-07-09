/**
 * Point d'entrée du module LoreMind Importer (Foundry v13).
 *
 * Deux façons de lancer l'import :
 *  1. l'API globale (fiable, marche en macro) :
 *       game.modules.get("loremind-importer").api.import()
 *  2. un bouton "Importer LoreMind" injecté (best-effort) dans l'onglet Journaux.
 */

import { loadBundle } from "./bundle.js";
import { importBundle } from "./importer.js";

const MODULE_ID = "loremind-importer";

// Marqueur de build : si tu ne vois PAS ce log dans la console (F12) au lancement
// du monde, c'est que Foundry sert encore l'ancien JS -> recharge (Ctrl+F5) ou
// relance le monde.
const BUILD = "0.2.9 (placeholder sur réf Foundry morte + notifications, type mappé validé)";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init — build ${BUILD}`);
});

Hooks.once("ready", () => {
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = {
    import: promptImport,
    exportMonsters: promptExportMonsters,
    exportSystemStructure: promptExportStructure
  };
});

/** Ouvre le sélecteur de fichier puis lance l'import (réservé au MJ). */
async function promptImport() {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("LOREMIND.notGM"));
    return;
  }
  const file = await pickZip();
  if (file) await runImport(file);
}

function pickZip() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip,application/zip";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.click();
  });
}

async function runImport(file) {
  try {
    ui.notifications.info(game.i18n.localize("LOREMIND.importing"));
    const bundle = await loadBundle(file);
    const res = await importBundle(bundle, (msg) => ui.notifications.info(msg));
    ui.notifications.info(game.i18n.format("LOREMIND.done", res));
    console.log(`${MODULE_ID} | import terminé`, res);
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (msg === "BAD_BUNDLE") {
      ui.notifications.error(game.i18n.localize("LOREMIND.errorBadBundle"));
    } else if (msg.startsWith("VERSION:")) {
      ui.notifications.error(game.i18n.format("LOREMIND.errorVersion", { version: msg.slice(8) }));
    } else {
      ui.notifications.error(msg);
    }
    console.error(`${MODULE_ID} | échec import`, e);
  }
}

// ─────────────── Export Foundry -> LoreMind : catalogue de monstres ───────────────
// Sélectionne des compendiums d'Acteurs et produit un .json { name, uuid } à importer
// dans le bestiaire LoreMind. Réservé au MJ.
//   game.modules.get("loremind-importer").api.exportMonsters()            // sélecteur
//   game.modules.get("loremind-importer").api.exportMonsters(["nimble.monsters"]) // direct

async function promptExportMonsters(packIds) {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("LOREMIND.notGM"));
    return;
  }
  let ids = packIds;
  if (!ids || !ids.length) ids = await pickActorPacks();
  if (!ids || !ids.length) return;
  try {
    ui.notifications.info(game.i18n.localize("LOREMIND.exportingMonsters"));
    const catalog = await buildMonsterCatalog(ids);
    downloadJson(`loremind-monsters-${game.system.id}.json`, catalog);
    ui.notifications.info(game.i18n.format("LOREMIND.monstersExported", { count: catalog.monsters.length }));
    console.log(`${MODULE_ID} | ${catalog.monsters.length} monstre(s) exporté(s)`);
  } catch (e) {
    ui.notifications.error(String(e?.message ?? e));
    console.error(`${MODULE_ID} | export monstres échoué`, e);
  }
}

// sourceIds accepte : "world" (tous les acteurs du monde), un id de compendium
// d'Acteurs (pack entier), ou un UUID d'acteur individuel (monde ou compendium).
async function buildMonsterCatalog(sourceIds) {
  const actors = [];
  const seen = new Set(); // dédup par UUID (évite les doublons monde ↔ compendium)
  const add = (a) => { if (a && a.uuid && !seen.has(a.uuid)) { seen.add(a.uuid); actors.push(a); } };
  for (const id of sourceIds) {
    if (id === "world") {
      for (const a of game.actors) add(a);
      continue;
    }
    const pack = game.packs.get(id);
    if (pack?.metadata?.type === "Actor") {
      const docs = await pack.getDocuments();
      for (const a of docs) add(a);
      continue;
    }
    // Sinon : UUID d'acteur individuel.
    try { add(await fromUuid(id)); } catch (e) { /* ignore */ }
  }
  // Vignettes des portraits récupérées en parallèle (fetch + redimensionnement).
  const monsters = await Promise.all(actors.map(toMonsterEntry));
  return { generator: MODULE_ID, system: game.system.id, monsters };
}

/** Convertit un acteur (monde ou compendium) en entrée de catalogue (avec vignette). */
async function toMonsterEntry(a) {
  const img = a.img ?? a.prototypeToken?.texture?.src ?? null;
  return {
    name: a.name,
    uuid: a.uuid,
    type: a.type ?? null,
    img,
    // Vignette base64 du portrait (data URL) -> illustration côté LoreMind.
    imgData: await imageToThumbnail(img),
    // Chemin de dossier ("Bestiaire/Briarban") -> conservé côté LoreMind pour
    // garder la même catégorisation qu'en Foundry.
    folder: folderPath(a),
    // Instantané système-agnostique des stats (aplati en clé->valeur), pour
    // l'affichage dans LoreMind. Les stats "vivantes" restent côté Foundry.
    stats: flattenStats(a.system)
  };
}

/**
 * Récupère l'image `src` (chemin Foundry ou URL), la redimensionne (max 512 px) et
 * la renvoie en data URL webp/jpeg pour l'embarquer dans le catalogue. Null si échec
 * ou image vide/placeholder (.svg ignoré : silhouette générique inutile).
 */
async function imageToThumbnail(src) {
  if (!src || src.toLowerCase().endsWith(".svg")) return null;
  try {
    const resp = await fetch(src);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await downscaleToDataUrl(blob, 512);
  } catch (e) {
    return null;
  }
}

/** Dessine `blob` redimensionné (max `maxSize` px) sur un canvas -> data URL, ou null. */
function downscaleToDataUrl(blob, maxSize) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = document.createElement("img");
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height || 1));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      try {
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        let out = canvas.toDataURL("image/webp", 0.8);
        if (!out || !out.startsWith("data:image/webp")) out = canvas.toDataURL("image/jpeg", 0.8);
        resolve(out || null);
      } catch (e) {
        resolve(null); // canvas "tainted" (CORS) : on abandonne la vignette
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

/** Chemin de dossier d'un document dans son compendium ("Bestiaire/Briarban"), ou "". */
function folderPath(doc) {
  const names = [];
  let f = doc.folder;
  let guard = 0;
  while (f && guard++ < 20) {
    if (f.name) names.unshift(f.name);
    f = f.folder ?? null; // dossier parent
  }
  return names.join("/");
}

/**
 * Visite chaque feuille SCALAIRE (string/number/boolean) d'un objet imbriqué :
 * `visit(path, key, value, type)`. Les tableaux ne sont pas parcourus récursivement —
 * le caller décide quoi en faire via `onArray(path, key, array)` (omis = ignorés).
 * Mutualise la récursion de flattenStats et flattenStructure.
 */
function walkScalars(obj, visit, onArray, prefix = "") {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v === null || v === undefined) continue;
    const t = typeof v;
    if (t === "string" || t === "number" || t === "boolean") visit(path, k, v, t);
    else if (Array.isArray(v)) { if (onArray) onArray(path, k, v); }
    else if (t === "object") walkScalars(v, visit, onArray, path);
  }
}

/** Aplati un objet en { "chemin.feuille": "valeur" } (primitives ; chaînes vides ignorées). */
function flattenStats(obj) {
  const out = {};
  walkScalars(obj,
    (path, _k, v, t) => {
      if (t === "string") { if (v.trim() !== "") out[path] = v; }
      else out[path] = String(v);
    },
    // Tableau de primitives -> liste courte ; tableau d'objets -> ignoré (trop complexe).
    (path, _k, v) => { if (v.length && v.every((x) => x === null || typeof x !== "object")) out[path] = v.join(", "); }
  );
  return out;
}

function downloadJson(filename, obj) {
  const data = JSON.stringify(obj, null, 2);
  // Méthode Foundry : déclenche un vrai téléchargement (sinon l'app/desktop ouvre
  // le JSON dans une fenêtre au lieu de l'enregistrer).
  const save = foundry?.utils?.saveDataToFile ?? globalThis.saveDataToFile;
  if (typeof save === "function") {
    save(data, "application/json", filename);
    return;
  }
  // Fallback hors Foundry (navigateur seul).
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Sélecteur de sources d'acteurs (DialogV2). Acteurs du MONDE regroupés par dossier
 * (en-tête de dossier cochable + acteurs cochables individuellement), case « tout »,
 * et compendiums d'Acteurs entiers. Sélection fine = on évite de dédoubler un monstre
 * déjà présent dans un compendium. Retourne les valeurs cochées (UUID / collections).
 */
async function pickActorPacks() {
  const esc = foundry.utils.escapeHTML;
  const L = (k) => game.i18n.localize("LOREMIND." + k);
  const packs = game.packs.filter((p) => p.metadata.type === "Actor");
  const worldActors = [...(game.actors ?? [])];
  if (!packs.length && !worldActors.length) {
    ui.notifications.warn(L("noActorPacks"));
    return [];
  }
  console.log(`${MODULE_ID} | acteurs du monde : ${worldActors.length} ; compendiums :`, packs.map((p) => p.collection));

  // Regroupe les acteurs du monde par dossier.
  const groups = new Map();
  for (const a of worldActors) {
    const fp = folderPath(a) || "";
    if (!groups.has(fp)) groups.set(fp, []);
    groups.get(fp).push(a);
  }
  const folders = [...groups.keys()].sort((a, b) => a.localeCompare(b));

  // NB : DialogV2 supprime les blocs <style> -> on stylise tout en INLINE (conservé),
  // sinon la liste coule en ligne et la zone de défilement disparaît.
  const ROW = "display:block;margin:.05rem 0 .05rem 1.5rem;font-size:.95em";
  const FOLDER = "display:block;margin:.2rem 0 .1rem";
  const FIELDSET = "border:1px solid #8884;border-radius:4px;margin:.3rem 0;padding:.25rem .6rem";
  const COUNT = "opacity:.55;font-size:.85em";

  let worldSection = "";
  if (worldActors.length) {
    let gi = 0;
    const blocks = folders.map((fp) => {
      const gid = `g${gi++}`;
      const list = groups.get(fp).sort((a, b) => a.name.localeCompare(b.name));
      const title = fp ? fp.split("/").join(" / ") : L("noFolder");
      const rows = list.map((a) =>
        `<label style="${ROW}"><input type="checkbox" name="src" value="${esc(a.uuid)}" data-folder="${gid}" data-world="1" /> ${esc(a.name)}</label>`
      ).join("");
      return `<div style="margin:.1rem 0 .35rem">
        <label style="${FOLDER}"><input type="checkbox" data-group="${gid}" /> <strong>${esc(title)}</strong> <span style="${COUNT}">${list.length}</span></label>
        ${rows}
      </div>`;
    }).join("");
    worldSection = `<fieldset style="${FIELDSET}">
      <legend><strong>${esc(L("worldActors"))}</strong> (${worldActors.length})</legend>
      <label style="display:block;margin:.1rem 0 .3rem"><input type="checkbox" data-group="all" /> <em>${esc(L("allWorldActors"))}</em></label>
      ${blocks}
    </fieldset>`;
  }

  let packSection = "";
  if (packs.length) {
    const rows = packs.map((p) =>
      `<label style="display:block;margin:.05rem 0;font-size:.95em"><input type="checkbox" name="src" value="${esc(p.collection)}" /> ${esc(p.metadata.label)} <span style="opacity:.5;font-size:.8em">${esc(p.collection)}</span></label>`
    ).join("");
    packSection = `<fieldset style="${FIELDSET}">
      <legend><strong>${esc(L("compendiums"))}</strong></legend>
      ${rows}
    </fieldset>`;
  }

  // Conteneur de défilement = un <div> (PAS un <form> : DialogV2 enveloppe déjà le
  // contenu dans un form, et un form imbriqué est supprimé par le navigateur -> son
  // max-height/overflow serait perdu et l'ascenseur disparaîtrait).
  const content = `<p>${esc(L("pickPacks"))}</p>
    <div style="max-height:60vh;overflow-y:auto;overflow-x:hidden;padding-right:.25rem">${worldSection}${packSection}</div>`;

  try {
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: L("exportMonstersTitle") },
      position: { width: 480 },
      content,
      rejectClose: false,
      // Câble les cases « tout » / « par dossier » qui pilotent les cases d'acteurs.
      render: (event, dialog) => {
        const root = dialog?.element;
        if (!root) return;
        root.querySelectorAll("input[data-group]").forEach((master) => {
          master.addEventListener("change", () => {
            if (master.dataset.group === "all") {
              root.querySelectorAll('input[name="src"][data-world="1"]').forEach((cb) => { cb.checked = master.checked; });
              root.querySelectorAll("input[data-group]").forEach((m) => { if (m !== master) m.checked = master.checked; });
            } else {
              root.querySelectorAll(`input[name="src"][data-folder="${master.dataset.group}"]`).forEach((cb) => { cb.checked = master.checked; });
            }
          });
        });
      },
      buttons: [
        {
          action: "ok",
          default: true,
          label: L("exportButton"),
          callback: (event, button) =>
            Array.from(button.form.querySelectorAll('input[name="src"]:checked')).map((i) => i.value)
        },
        { action: "cancel", label: L("cancel"), callback: () => [] }
      ]
    });
    return result || [];
  } catch (e) {
    console.warn(`${MODULE_ID} | sélecteur indisponible — appelle api.exportMonsters(['Actor.<id>' | 'pack.id' | 'world'])`, e);
    ui.notifications.warn(L("pickFallback"));
    return [];
  }
}

// ─────────────── Export de la STRUCTURE d'un système (Foundry -> LoreMind) ───────────────
// Aplati le `system` d'un acteur exemple en { path, label, type } pour servir de
// gabarit de template ennemi côté LoreMind (champs scalaires + chemins Foundry).
//   game.modules.get("loremind-importer").api.exportSystemStructure()            // token sélectionné
//   game.modules.get("loremind-importer").api.exportSystemStructure("Compendium...Actor.id")

async function promptExportStructure(uuid) {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("LOREMIND.notGM"));
    return;
  }
  let actor = null;
  if (uuid) {
    try { actor = await fromUuid(uuid); } catch (e) { /* ignore */ }
  }
  if (!actor) actor = canvas?.tokens?.controlled?.[0]?.actor ?? null;
  if (!actor) {
    ui.notifications.warn(game.i18n.localize("LOREMIND.noSampleActor"));
    return;
  }
  try {
    const structure = {
      generator: MODULE_ID,
      system: game.system.id,
      actorType: actor.type ?? null,
      fields: flattenStructure(actor.system)
    };
    downloadJson(`loremind-structure-${game.system.id}.json`, structure);
    ui.notifications.info(game.i18n.format("LOREMIND.structureExported", { count: structure.fields.length }));
  } catch (e) {
    ui.notifications.error(String(e?.message ?? e));
    console.error(`${MODULE_ID} | export structure échoué`, e);
  }
}

/** Aplati un objet en liste de champs scalaires { path, label, type } (tableaux ignorés). */
function flattenStructure(obj) {
  const out = [];
  walkScalars(obj, (path, k, _v, t) => out.push({ path, label: k, type: t }));
  return out;
}

// Boutons best-effort dans l'onglet Acteurs : export monstres + export structure.
Hooks.on("renderActorDirectory", (app, html) => {
  try {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root || root.querySelector(".loremind-export-btn")) return;
    const header = root.querySelector(".directory-header") || root.querySelector("header") || root;

    const exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.className = "loremind-export-btn";
    exportBtn.innerHTML = `<i class="fas fa-file-export"></i> ${game.i18n.localize("LOREMIND.exportMonstersButton")}`;
    exportBtn.addEventListener("click", () => promptExportMonsters());

    const structBtn = document.createElement("button");
    structBtn.type = "button";
    structBtn.className = "loremind-structure-btn";
    structBtn.innerHTML = `<i class="fas fa-sitemap"></i> ${game.i18n.localize("LOREMIND.structureExportButton")}`;
    structBtn.addEventListener("click", () => promptExportStructure());

    header.prepend(structBtn);
    header.prepend(exportBtn);
  } catch (e) {
    console.warn(`${MODULE_ID} | boutons Acteurs non injectés — utilise l'API/macro`, e);
  }
});

// Bouton best-effort dans l'onglet Journaux (le sidebar v13 est en ApplicationV2 :
// on gère élément natif ou jQuery, et on échoue silencieusement -> l'API/macro reste).
Hooks.on("renderJournalDirectory", (app, html) => {
  try {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root || root.querySelector(".loremind-import-btn")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "loremind-import-btn";
    btn.innerHTML = `<i class="fas fa-file-import"></i> ${game.i18n.localize("LOREMIND.importButton")}`;
    btn.addEventListener("click", promptImport);
    const header = root.querySelector(".directory-header") || root.querySelector("header") || root;
    header.prepend(btn);
  } catch (e) {
    console.warn(`${MODULE_ID} | injection du bouton sidebar échouée — utilisez l'API/macro`, e);
  }
});
