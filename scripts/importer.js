/**
 * Orchestration de l'import d'un bundle LoreMind dans Foundry v13.
 *
 * Étapes : upload des assets (images + battlemaps) -> dossiers -> journaux
 * (arcs, quêtes, scènes, PNJ, ennemis) -> scènes (UVTT). Les acteurs jouables
 * sont volontairement HORS périmètre v1 (les PNJ/ennemis partent en journaux).
 */

import { buildSceneData } from "./uvtt.js";

const MODULE_ID = "loremind-importer";

// ---------------------------------------------------------------------------
// Helpers texte
// ---------------------------------------------------------------------------

function esc(s) {
  const str = String(s ?? "");
  // Aligné sur main.js : on délègue à l'utilitaire Foundry quand il est dispo,
  // avec un repli local identique (échappe &, <, >).
  return foundry?.utils?.escapeHTML
    ? foundry.utils.escapeHTML(str)
    : str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Texte brut (format LoreMind = "plain") -> HTML : paragraphes + <br>. */
function plainToHtml(text) {
  if (!text) return "";
  return esc(text).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
}

function section(title, body) {
  if (!body) return "";
  return `<h3>${esc(title)}</h3>${plainToHtml(body)}`;
}

function textPage(name, html, level = 1) {
  return {
    name,
    type: "text",
    title: { show: true, level },
    text: { content: html || "<p></p>", format: 1 } // 1 = HTML
  };
}

function imagePage(name, src) {
  return { name, type: "image", src };
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

function assetIndex(data) {
  const map = new Map();
  for (const a of data.assets ?? []) map.set(a.id, a);
  return map;
}

/** Classe FilePicker (v13 : sous foundry.applications.apps ; global = alias). */
function filePicker() {
  return foundry?.applications?.apps?.FilePicker ?? globalThis.FilePicker;
}

/** Upload tous les assets dans le dossier data du monde, retourne assetId -> src. */
async function uploadAssets(bundle, targetDir) {
  const FP = filePicker();
  await ensureDir(targetDir);
  const out = {};
  for (const asset of bundle.data.assets ?? []) {
    const bytes = await bundle.bytes(asset.path);
    if (!bytes) continue;
    const filename = `${asset.id}${extOf(asset.path)}`;
    const file = new File([bytes], filename, { type: asset.mime || "application/octet-stream" });
    try {
      // FilePicker.upload renvoie un objet {path} en cas de succès, ou false en cas
      // d'échec (il NE lève PAS). On ne référence le fichier que s'il est réellement uploadé.
      const res = await FP.upload("data", targetDir, file, {}, { notify: false });
      if (res && res.path) out[asset.id] = res.path;
      else console.error(`${MODULE_ID} | upload échoué : ${filename}`, res);
    } catch (e) {
      console.error(`${MODULE_ID} | upload échoué : ${filename}`, e);
    }
  }
  return out;
}

/**
 * Crée l'arborescence cible NIVEAU PAR NIVEAU : FilePicker.createDirectory ne crée
 * PAS les parents manquants et échoue si le dossier existe déjà -> on itère chaque
 * segment, on ignore "déjà présent" et on loggue les vraies erreurs.
 */
async function ensureDir(dir) {
  const FP = filePicker();
  const parts = dir.split("/").filter(Boolean);
  let cur = "";
  for (const part of parts) {
    cur = cur ? `${cur}/${part}` : part;
    try {
      await FP.createDirectory("data", cur, {});
      console.log(`${MODULE_ID} | dossier créé : ${cur}`);
    } catch (e) {
      const msg = String(e?.message ?? e);
      if (/exist/i.test(msg)) continue; // déjà présent : normal
      console.warn(`${MODULE_ID} | createDirectory("${cur}") a échoué : ${msg}`);
    }
  }
}

function extOf(path) {
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  return dot > slash ? path.substring(dot) : "";
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function arcPages(arc, src) {
  const pages = [];
  let overview = section("Description", arc.description)
    + section("Thèmes", arc.themes)
    + section("Enjeux", arc.stakes)
    + section("Récompenses", arc.rewards)
    + section("Résolution", arc.resolution)
    + section("Notes MJ", arc.gmNotes);
  pages.push(textPage(arc.name, overview));
  for (const id of arc.illustrationAssetIds ?? []) if (src[id]) pages.push(imagePage("Illustration", src[id]));
  return pages;
}

function renderPrereqs(prereqs) {
  if (!prereqs?.length) return "";
  const items = prereqs.map(p => {
    if (p.type === "questCompleted") return `quête #${esc(p.questId)} terminée`;
    if (p.type === "sessionReached") return `séance ≥ ${esc(p.minSessionNumber)}`;
    if (p.type === "flagSet") return `flag « ${esc(p.flagName)} » posé`;
    return esc(JSON.stringify(p));
  });
  return `<h3>Se débloque quand</h3><ul>${items.map(i => `<li>${i}</li>`).join("")}</ul>`;
}

function questPages(quest, src) {
  const html = section("Synopsis", quest.description)
    + section("Objectifs des joueurs", quest.playerObjectives)
    + section("Enjeux narratifs", quest.narrativeStakes)
    + section("Notes MJ", quest.gmNotes)
    + renderPrereqs(quest.prerequisites);
  const pages = [textPage(quest.name, html)];
  for (const id of quest.illustrationAssetIds ?? []) if (src[id]) pages.push(imagePage("Illustration", src[id]));
  return pages;
}

function roomsHtml(rooms) {
  if (!rooms?.length) return "";
  const sorted = [...rooms].sort((a, b) => (a.floor ?? 0) - (b.floor ?? 0) || (a.order ?? 0) - (b.order ?? 0));
  return "<h3>Pièces</h3>" + sorted.map(r =>
    `<h4>${esc(r.name)}</h4>`
    + plainToHtml(r.description)
    + (r.enemies ? `<p><em>Ennemis :</em> ${esc(r.enemies)}</p>` : "")
    + (r.loot ? `<p><em>Butin :</em> ${esc(r.loot)}</p>` : "")
    + (r.traps ? `<p><em>Pièges :</em> ${esc(r.traps)}</p>` : "")
    + (r.gmNotes ? plainToHtml(r.gmNotes) : "")
  ).join("");
}

function scenePages(scene, src) {
  const playerHtml = section("Lieu", scene.location)
    + section("Moment", scene.timing)
    + section("Ambiance", scene.atmosphere)
    + section("Narration", scene.playerNarration);
  const gmHtml = section("Notes secrètes", scene.gmSecretNotes)
    + section("Choix & conséquences", scene.choicesConsequences)
    + section("Difficulté de combat", scene.combatDifficulty)
    + (scene.enemies ? section("Ennemis", scene.enemies) : "")
    + roomsHtml(scene.rooms);

  const pages = [
    textPage("Joueurs", playerHtml || "<p></p>"),
    textPage("MJ", gmHtml || "<p></p>")
  ];
  for (const id of scene.illustrationAssetIds ?? []) if (src[id]) pages.push(imagePage("Illustration", src[id]));
  return pages;
}

function fieldsHtml(fields) {
  if (!fields?.length) return "";
  return fields.map(f => {
    if (f.type === "text" || f.type === "number") {
      return `<h4>${esc(f.label)}</h4>${plainToHtml(f.value)}`;
    }
    if (f.type === "keyValueList") {
      const rows = (f.entries ?? []).map(e => `<tr><th>${esc(e.label)}</th><td>${esc(e.value)}</td></tr>`).join("");
      return `<h4>${esc(f.label)}</h4><table>${rows}</table>`;
    }
    return ""; // image -> géré en pages séparées
  }).join("");
}

function personaPages(persona, src) {
  const pages = [];
  if (persona.portraitAssetId && src[persona.portraitAssetId]) {
    pages.push(imagePage("Portrait", src[persona.portraitAssetId]));
  }
  let html = "";
  if (persona.level) html += `<p><em>Niveau / FP :</em> ${esc(persona.level)}</p>`;
  html += fieldsHtml(persona.fields);
  pages.push(textPage(persona.name, html || "<p></p>"));
  // Galeries d'images des champs IMAGE.
  for (const f of persona.fields ?? []) {
    if (f.type === "image") for (const id of f.assetIds ?? []) if (src[id]) pages.push(imagePage(f.label, src[id]));
  }
  return pages;
}

// ---------------------------------------------------------------------------
// Import principal
// ---------------------------------------------------------------------------

export async function importBundle(bundle, onProgress = () => {}) {
  const data = bundle.data;

  // Garde de version (major).
  const major = parseInt(String(data.formatVersion || "1").split(".")[0], 10);
  if (major > 1) throw new Error("VERSION:" + data.formatVersion);

  // Périmètre choisi à l'export (bundle ancien sans `options` = tout inclus).
  const wantJournals = data.options?.journals !== false;
  const wantMaps = data.options?.maps !== false;

  const campaignId = data.campaign?.id ?? null;
  const campName = data.campaign?.name || "Campagne LoreMind";
  const targetDir = `worlds/${game.world.id}/loremind/${slug(campName)}`;
  const idx = assetIndex(data);

  // Création taguée : chaque document porte le flag {campaignId, sourceId} du module
  // -> purge ciblée à la réimportation (cf. purgePreviousImport).
  const flagData = (sourceId) => ({ flags: { [MODULE_ID]: { campaignId, ...(sourceId ? { sourceId } : {}) } } });
  const mkFolder = (name, type, parentId) => Folder.create({ name, type, folder: parentId ?? null, ...flagData() });
  const mkJournal = (sourceId, doc) => JournalEntry.create({ ...doc, ...flagData(sourceId) });
  const mkScene = (sourceId, doc) => Scene.create({ ...doc, ...flagData(sourceId) });
  const mkTable = (sourceId, doc) => RollTable.create({ ...doc, ...flagData(sourceId) });

  // Dédup : on supprime l'import précédent de CETTE campagne avant de recréer.
  onProgress(game.i18n.localize("LOREMIND.purging"));
  await purgePreviousImport(campaignId);

  onProgress(game.i18n.localize("LOREMIND.uploadingAssets"));
  const src = await uploadAssets(bundle, targetDir);

  onProgress(game.i18n.localize("LOREMIND.creatingFolders"));
  // Dossiers Journal : uniquement si les journaux font partie du périmètre exporté.
  const arcFolderId = {};
  const questFolderId = {};
  let journalRoot = null, npcFolder = null, enemyFolder = null;
  if (wantJournals) {
    journalRoot = await mkFolder(campName, "JournalEntry", null);
    for (const arc of data.arcs ?? []) {
      arcFolderId[arc.id] = (await mkFolder(arc.name, "JournalEntry", journalRoot.id)).id;
    }
    // Sous-dossier Journal par chapitre/quête (sous son arc) : aperçu de la quête +
    // journaux de ses scènes -> regroupement par chapitre.
    for (const quest of data.quests ?? []) {
      const parent = arcFolderId[quest.arcId] ?? journalRoot.id;
      questFolderId[quest.id] = (await mkFolder(quest.name, "JournalEntry", parent)).id;
    }
    npcFolder = await mkFolder("PNJ", "JournalEntry", journalRoot.id);
    enemyFolder = await mkFolder("Bestiaire", "JournalEntry", journalRoot.id);
  }
  const sceneRoot = wantMaps ? await mkFolder(campName, "Scene", null) : null;

  // quête -> arc (pour ranger les journaux de scène sous l'arc).
  const questArc = {};
  for (const q of data.quests ?? []) questArc[q.id] = q.arcId;
  const arcById = new Map((data.arcs ?? []).map(a => [a.id, a]));
  const questById = new Map((data.quests ?? []).map(q => [q.id, q]));

  // Dossiers Scene imbriqués Campagne / Arc / Quête, créés À LA DEMANDE
  // (uniquement pour les scènes qui ont réellement une battlemap -> pas de vides).
  const sceneFolderCache = new Map();
  const ensureSceneFolder = async (key, name, parentId) => {
    if (sceneFolderCache.has(key)) return sceneFolderCache.get(key);
    const f = await mkFolder(name, "Scene", parentId);
    sceneFolderCache.set(key, f.id);
    return f.id;
  };
  const sceneFolderFor = async (scene) => {
    const quest = questById.get(scene.questId);
    const arc = quest ? arcById.get(quest.arcId) : null;
    let parent = sceneRoot.id;
    if (arc) parent = await ensureSceneFolder("arc:" + arc.id, arc.name, parent);
    if (quest) parent = await ensureSceneFolder("quest:" + quest.id, quest.name, parent);
    return parent;
  };

  // Pour le placement des tokens : ennemi par id (porte le foundryRef) + cache d'acteurs.
  const enemyById = new Map((data.enemies ?? []).map(e => [e.id, e]));
  const worldActorCache = new Map(); // sourceUuid -> Actor (importé une seule fois)

  let journals = 0, scenes = 0, tables = 0;

  const sceneJournalId = {};
  if (wantJournals) {
    onProgress(game.i18n.localize("LOREMIND.creatingJournals"));
    for (const arc of data.arcs ?? []) {
      await mkJournal("arc:" + arc.id, { name: arc.name, folder: arcFolderId[arc.id], pages: arcPages(arc, src) });
      journals++;
    }
    for (const quest of data.quests ?? []) {
      const folder = questFolderId[quest.id] ?? arcFolderId[quest.arcId] ?? journalRoot.id;
      await mkJournal("quest:" + quest.id, { name: quest.name, folder, pages: questPages(quest, src) });
      journals++;
    }

    for (const scene of data.scenes ?? []) {
      const folder = questFolderId[scene.questId] ?? arcFolderId[questArc[scene.questId]] ?? journalRoot.id;
      const j = await mkJournal("scene:" + scene.id, { name: scene.name, folder, pages: scenePages(scene, src) });
      sceneJournalId[scene.id] = j.id;
      journals++;
    }

    for (const persona of data.npcs ?? []) {
      await mkJournal("npc:" + persona.id, { name: persona.name, folder: npcFolder.id, pages: personaPages(persona, src) });
      journals++;
    }
    for (const persona of data.enemies ?? []) {
      await mkJournal("enemy:" + persona.id, { name: persona.name, folder: enemyFolder.id, pages: personaPages(persona, src) });
      journals++;
    }
  }

  // Tables aléatoires -> RollTable (dans un dossier RollTable dédié à la campagne).
  if ((data.randomTables ?? []).length) {
    onProgress(game.i18n.localize("LOREMIND.creatingTables"));
    const tableRoot = await mkFolder(campName, "RollTable", null);
    for (const t of data.randomTables) {
      await mkTable("table:" + t.id, {
        name: t.name,
        description: t.description ?? "",
        formula: t.diceFormula || "",
        folder: tableRoot.id,
        results: (t.entries ?? []).map(e => ({
          type: CONST.TABLE_RESULT_TYPES.TEXT,
          text: e.detail ? `${e.label} — ${e.detail}` : e.label,
          range: [e.minRoll, e.maxRoll],
          weight: 1
        }))
      });
      tables++;
    }
  }

  if (wantMaps) {
    onProgress(game.i18n.localize("LOREMIND.creatingScenes"));
    for (const scene of data.scenes ?? []) {
      // Variantes multiples (Jour/Nuit, étages…) : une Scene Foundry PAR carte.
      // Repli sur l'ancien champ `battlemap` (bundle antérieur, carte unique).
      const maps = scene.battlemaps?.length
        ? scene.battlemaps
        : (scene.battlemap ? [scene.battlemap] : []);
      for (const bm of maps) {
        if (!bm?.mediaAssetId || !src[bm.mediaAssetId]) continue;
        const mediaSrc = src[bm.mediaAssetId];

        const label = bm.label ? `${scene.name} — ${bm.label}` : scene.name;
        const sidecar = await readSidecar(bundle, idx, bm.dataAssetId);
        const sceneData = buildSceneData(sidecar, mediaSrc, label);
        sceneData.folder = await sceneFolderFor(scene);
        if (sceneJournalId[scene.id]) sceneData.journal = sceneJournalId[scene.id];

        try {
          const created = await mkScene("scene:" + scene.id + (bm.label ? ":" + bm.label : ""), sceneData);
          scenes++;
          // Lien retour : page "Carte" dans le journal de la scène pour ouvrir la Scene.
          await addSceneLinkPage(sceneJournalId[scene.id], created, label,
            bm.label ? `Carte — ${bm.label}` : "Carte");
          // Tokens : ennemis liés (acteur de compendium si réf, sinon placeholder nommé).
          await placeEnemyTokens(created, scene.enemyIds, enemyById, worldActorCache, src);
        } catch (e) {
          console.error(`${MODULE_ID} | échec création scène "${label}"`, e, sceneData);
        }
      }
    }
  }

  return { scenes, journals, tables, actors: 0 };
}

/** Ajoute au journal d'une scène une page "Carte" avec un lien cliquable vers la Scene. */
async function addSceneLinkPage(journalId, createdScene, sceneName, pageName = "Carte") {
  if (!journalId || !createdScene?.id) return;
  const journal = game.journal.get(journalId);
  if (!journal) return;
  try {
    await journal.createEmbeddedDocuments("JournalEntryPage", [{
      name: pageName,
      type: "text",
      title: { show: true, level: 1 },
      sort: -100000, // en tête du journal
      text: { content: `<p>@UUID[Scene.${createdScene.id}]{${esc(sceneName)}}</p>`, format: 1 }
    }]);
  } catch (e) {
    console.warn(`${MODULE_ID} | lien scène->journal échoué`, e);
  }
}

/**
 * Pose sur une scène les tokens des ennemis liés qui référencent un acteur Foundry
 * (compendium). Position ALÉATOIRE (snappée à la grille) — le MJ ajuste.
 */
async function placeEnemyTokens(sceneDoc, enemyIds, enemyById, actorCache, src) {
  if (!sceneDoc || !enemyIds?.length) return;
  const grid = sceneDoc.grid?.size || 100;
  const width = sceneDoc.width || grid * 10;
  const height = sceneDoc.height || grid * 10;

  const tokens = [];
  for (const eid of enemyIds) {
    const enemy = enemyById.get(eid);
    if (!enemy) continue;
    // Avec référence -> acteur du compendium (stats natives) ;
    // sans référence -> acteur placeholder nommé (stats à remplir côté Foundry).
    const actor = enemy.foundryRef
      ? await ensureWorldActor(enemy.foundryRef, actorCache)
      : await ensurePlaceholderActor(enemy, src, actorCache);
    if (!actor) continue;
    try {
      const td = await actor.getTokenDocument({ x: randCell(width, grid), y: randCell(height, grid) });
      tokens.push(td.toObject());
    } catch (e) {
      console.warn(`${MODULE_ID} | token non préparé pour "${enemy.name}"`, e);
    }
  }
  if (tokens.length) {
    try { await sceneDoc.createEmbeddedDocuments("Token", tokens); }
    catch (e) { console.warn(`${MODULE_ID} | placement des tokens échoué`, e); }
  }
}

/**
 * Garantit un acteur DU MONDE pour un UUID. Si l'UUID pointe vers un compendium,
 * l'acteur est importé dans le monde UNE SEULE FOIS (flagué sourceUuid, réutilisé
 * aux imports suivants). Les acteurs importés ne sont PAS purgés (partagés).
 */
async function ensureWorldActor(uuid, cache) {
  if (cache.has(uuid)) return cache.get(uuid);

  const already = game.actors.find(a => a.getFlag(MODULE_ID, "sourceUuid") === uuid);
  if (already) { cache.set(uuid, already); return already; }

  let src = null;
  try { src = await fromUuid(uuid); } catch (e) { /* introuvable */ }
  if (!src) {
    console.warn(`${MODULE_ID} | acteur introuvable (compendium absent ?) : ${uuid}`);
    cache.set(uuid, null);
    return null;
  }
  // Déjà un acteur du monde : on l'utilise tel quel.
  if (!src.pack) { cache.set(uuid, src); return src; }

  const obj = src.toObject();
  delete obj._id;
  obj.flags = { ...(obj.flags || {}), [MODULE_ID]: { ...(obj.flags?.[MODULE_ID] || {}), sourceUuid: uuid } };
  let actor = null;
  try { actor = await Actor.create(obj); }
  catch (e) { console.warn(`${MODULE_ID} | import de l'acteur échoué : ${uuid}`, e); }
  cache.set(uuid, actor);
  return actor;
}

/**
 * Garantit un acteur « placeholder » pour un ennemi LoreMind SANS référence Foundry.
 * Acteur vide (type par défaut du système) juste nommé d'après l'ennemi + portrait
 * si dispo. PERSISTE entre imports (flag placeholderEnemyId) -> les stats remplies à
 * la main côté Foundry survivent aux réimportations. Token re-posé à chaque import.
 */
async function ensurePlaceholderActor(enemy, src, cache) {
  const key = "placeholder:" + enemy.id;
  if (cache.has(key)) return cache.get(key);

  const existing = game.actors.find(a => a.getFlag(MODULE_ID, "placeholderEnemyId") === enemy.id);
  if (existing) { cache.set(key, existing); return existing; }

  // Si l'ennemi maison est mappé (template calqué sur le système Foundry), on crée
  // un acteur TYPÉ avec ses stats ; sinon un placeholder vide du type par défaut.
  const fa = enemy.foundryActor; // { type, system } ou absent
  const type = (fa && fa.type) || defaultActorType();
  if (!type) {
    console.warn(`${MODULE_ID} | aucun type d'acteur pour "${enemy.name}"`);
    cache.set(key, null);
    return null;
  }

  const data = {
    name: enemy.name || "Ennemi",
    type,
    flags: { [MODULE_ID]: { placeholderEnemyId: enemy.id } }
  };
  if (fa && fa.system) data.system = fa.system;
  const img = enemy.portraitAssetId && src ? src[enemy.portraitAssetId] : null;
  if (img) data.img = img;

  let actor = null;
  try { actor = await Actor.create(data); }
  catch (e) { console.warn(`${MODULE_ID} | acteur placeholder échoué : "${enemy.name}"`, e); }
  cache.set(key, actor);
  return actor;
}

/** Type d'acteur par défaut du système (préfère un type PNJ/monstre si présent). */
function defaultActorType() {
  const types = (game.documentTypes?.Actor ?? []).filter(t => t !== "base");
  if (!types.length) return null;
  return types.find(t => /npc|monster|creature|enemy|monstre|pnj/i.test(t)) || types[0];
}

/** Coordonnée aléatoire snappée à la grille, dans les limites de la map. */
function randCell(extent, grid) {
  const cells = Math.max(1, Math.floor(extent / grid) - 1);
  return Math.floor(Math.random() * cells) * grid;
}

/** Lit et parse le sidecar JSON d'une battlemap (format DA-Foundry ou UVTT), ou null. */
async function readSidecar(bundle, idx, dataAssetId) {
  if (!dataAssetId) return null;
  const asset = idx.get(dataAssetId);
  if (!asset) return null;
  try {
    const txt = await bundle.text(asset.path);
    return txt ? JSON.parse(txt) : null;
  } catch (e) {
    console.error(`${MODULE_ID} | sidecar battlemap illisible`, e);
    return null;
  }
}

/**
 * Dédup : supprime tout ce qu'un import précédent de CETTE campagne a créé (repéré
 * par le flag du module), avant de recréer. Documents d'abord, dossiers ensuite.
 */
async function purgePreviousImport(campaignId) {
  if (!campaignId) return;
  const mine = (d) => d.getFlag(MODULE_ID, "campaignId") === campaignId;

  const sceneIds = game.scenes.filter(mine).map(d => d.id);
  if (sceneIds.length) await Scene.deleteDocuments(sceneIds);

  const journalIds = game.journal.filter(mine).map(d => d.id);
  if (journalIds.length) await JournalEntry.deleteDocuments(journalIds);

  const tableIds = game.tables.filter(mine).map(d => d.id);
  if (tableIds.length) await RollTable.deleteDocuments(tableIds);

  const folderIds = game.folders.filter(mine).map(d => d.id);
  if (folderIds.length) {
    await Folder.deleteDocuments(folderIds, { deleteSubfolders: false, deleteContents: false });
  }
}

function slug(s) {
  return String(s || "campagne").trim().toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "campagne";
}
