/**
 * Construction des données de Scene Foundry v13 à partir du sidecar d'une battlemap.
 *
 * Deux formats de sidecar sont gérés :
 *  - **Export "Foundry VTT" de Dungeon Alchemist** (cas réel observé) : un Scene
 *    à plat, ancien schéma — `width/height/grid/walls/lights/img/gridDistance/...`.
 *    Murs/lumières déjà presque en forme Foundry, mais valeurs et imbrication
 *    d'un schéma ancien -> on traduit vers le v13 (grid{}, light.config{}, env{}).
 *  - **Universal VTT** (.uvtt/.dd2vtt) : `resolution` + `line_of_sight` + `portals`
 *    en unités de grille -> conversion en pixels.
 *
 * À AFFINER en jeu (échelle des lumières, sens des murs limités, etc.).
 */

const GRID_SQUARE = 1;       // CONST.GRID_TYPES.SQUARE
const SENSE_NONE = 0;        // CONST.WALL_SENSE_TYPES.NONE
const SENSE_NORMAL = 20;     // CONST.WALL_SENSE_TYPES.NORMAL (idem WALL_MOVEMENT_TYPES.NORMAL)
const DEFAULT_PPG = 100;
const DEFAULT_DISTANCE = 5;

/** Dispatcher : détecte le format du sidecar et produit les données de Scene. */
export function buildSceneData(sidecar, backgroundSrc, name) {
  if (!sidecar) return plainSceneData(backgroundSrc, name);
  if (Array.isArray(sidecar.line_of_sight) || sidecar.resolution) {
    return uvttToSceneData(sidecar, backgroundSrc, name);
  }
  if (Array.isArray(sidecar.walls) || sidecar.width || sidecar.grid) {
    return daSceneToSceneData(sidecar, backgroundSrc, name);
  }
  return plainSceneData(backgroundSrc, name);
}

// ---------------------------------------------------------------------------
// Format "Foundry VTT" de Dungeon Alchemist (Scene à plat, ancien schéma)
// ---------------------------------------------------------------------------

/**
 * Sens (sight/light/sound) : l'ancien schéma v9 va de 0 à 2 (NONE/LIMITED/NORMAL),
 * la v13 attend 0/10/20/30/40 -> les valeurs 0-2 sont multipliées par 10 (0/10/20),
 * les valeurs déjà en enum v10+ passent telles quelles. DA exporte bien les deux
 * niveaux (1 = terrain/chariots, 2 = murs pleins) : un 2 non converti fait rejeter
 * le mur par la validation Foundry ("light: 2 is not a valid choice").
 */
function senseLevel(v) {
  if (typeof v !== "number") return SENSE_NORMAL;
  return v <= 2 ? v * 10 : v;
}

/** Mouvement : échelle v9 = 0/1, v13 = 0/20 (pas de niveau LIMITED en déplacement). */
function moveLevel(v) {
  if (typeof v !== "number") return SENSE_NORMAL;
  return v === 0 ? SENSE_NONE : SENSE_NORMAL;
}

function daSceneToSceneData(da, src, name) {
  const size = da.grid || DEFAULT_PPG;

  const walls = (da.walls ?? []).map(w => ({
    c: w.c,
    move: moveLevel(w.move),
    sight: senseLevel(w.sense ?? w.sight),
    light: senseLevel(w.light ?? w.sense ?? w.sight),
    sound: senseLevel(w.sound),
    door: w.door ?? 0,
    ds: w.ds ?? 0
  }));

  const lights = (da.lights ?? []).map(l => ({
    x: l.x,
    y: l.y,
    config: {
      dim: l.dim ?? 0,
      bright: l.bright ?? 0,
      ...(l.tintColor ? { color: l.tintColor } : {}),
      ...(typeof l.tintAlpha === "number" ? { alpha: l.tintAlpha } : {})
    }
  }));

  return {
    name,
    width: da.width,
    height: da.height,
    padding: typeof da.padding === "number" && da.padding <= 0.5 ? da.padding : 0,
    background: { src },
    grid: {
      type: GRID_SQUARE,
      size,
      distance: da.gridDistance || DEFAULT_DISTANCE,
      units: da.gridUnits || "ft",
      ...(da.gridColor ? { color: da.gridColor } : {}),
      ...(typeof da.gridAlpha === "number" ? { alpha: da.gridAlpha } : {})
    },
    walls,
    lights,
    environment: {
      darknessLevel: da.darkness ?? 0,
      globalLight: { enabled: !!da.globalLight }
    }
  };
}

// ---------------------------------------------------------------------------
// Universal VTT (.uvtt / .dd2vtt) — coordonnées en unités de grille
// ---------------------------------------------------------------------------

/**
 * Couleur UVTT -> "#rrggbb". DungeonDraft exporte en AARRGGBB (alpha DEVANT :
 * "ffeccd8b" = torche sable) -> on garde les 6 DERNIERS caractères ; en prenant
 * les 6 premiers, toutes les lumières deviennent quasi blanches et saturent.
 */
function normalizeColor(c) {
  if (!c || typeof c !== "string") return undefined;
  const h = c.replace("#", "").trim().toLowerCase();
  if (h.length >= 8) return "#" + h.slice(-6);
  return h.length === 6 ? "#" + h : undefined;
}

function uvttToSceneData(uvtt, src, name) {
  const res = uvtt?.resolution ?? {};
  const ppg = res.pixels_per_grid || DEFAULT_PPG;
  const mapSize = res.map_size ?? { x: 0, y: 0 };
  const origin = res.map_origin ?? { x: 0, y: 0 };

  const width = Math.max(1, Math.round((mapSize.x || 0) * ppg));
  const height = Math.max(1, Math.round((mapSize.y || 0) * ppg));
  const toPx = (pt) => [
    Math.round(((pt?.x ?? 0) - (origin.x || 0)) * ppg),
    Math.round(((pt?.y ?? 0) - (origin.y || 0)) * ppg)
  ];

  const walls = [];
  const addPolyline = (poly) => {
    if (!Array.isArray(poly)) return;
    for (let i = 0; i < poly.length - 1; i++) {
      const [x1, y1] = toPx(poly[i]);
      const [x2, y2] = toPx(poly[i + 1]);
      if (x1 !== x2 || y1 !== y2) walls.push({ c: [x1, y1, x2, y2] });
    }
  };
  (uvtt.line_of_sight ?? []).forEach(addPolyline);
  (uvtt.objects_line_of_sight ?? []).forEach(addPolyline);
  (uvtt.portals ?? []).forEach((p) => {
    const b = p?.bounds ?? [];
    if (b.length >= 2) {
      const [x1, y1] = toPx(b[0]);
      const [x2, y2] = toPx(b[b.length - 1]);
      walls.push({ c: [x1, y1, x2, y2], door: 1, ds: p.closed === false ? 1 : 0 });
    }
  });

  // baked_lighting : la lueur est déjà peinte dans l'image exportée -> la lumière
  // Foundry ne sert qu'à la visibilité des tokens, sa teinte doit rester discrète
  // (l'alpha par défaut de 0.5 s'additionne entre lumières et éblouit la scène).
  const baked = uvtt.environment?.baked_lighting === true;
  const lights = (uvtt.lights ?? []).map((l) => {
    const [x, y] = toPx(l.position ?? { x: 0, y: 0 });
    const dim = (l.range || 0) * DEFAULT_DISTANCE;
    const color = normalizeColor(l.color);
    const intensity = typeof l.intensity === "number" && l.intensity > 0 ? l.intensity : 1;
    const alpha = Math.min(0.5, (baked ? 0.1 : 0.25) * intensity);
    return { x, y, config: { dim, bright: dim / 2, ...(color ? { color, alpha } : {}) } };
  });

  return {
    name, width, height, padding: 0,
    background: { src },
    grid: { type: GRID_SQUARE, size: ppg, distance: DEFAULT_DISTANCE, units: "ft" },
    walls, lights
  };
}

// ---------------------------------------------------------------------------
// Repli : média sans sidecar exploitable
// ---------------------------------------------------------------------------

export function plainSceneData(src, name) {
  return {
    name,
    padding: 0,
    background: { src },
    grid: { type: GRID_SQUARE, size: DEFAULT_PPG, distance: DEFAULT_DISTANCE, units: "ft" }
  };
}
