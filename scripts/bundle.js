/**
 * Lecteur de bundle LoreMind (.zip) — sans dépendance externe.
 *
 * On lit le ZIP via son "central directory" (tailles toujours fiables, contrairement
 * aux en-têtes locaux que Java écrit parfois avec des descripteurs de données), et on
 * décompresse le DEFLATE brut avec DecompressionStream (dispo dans le Chromium de
 * Foundry v13). Suffisant pour nos bundles : pas de chiffrement, pas de ZIP64.
 */

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

const utf8 = new TextDecoder("utf-8");

/** Liste les entrées du zip depuis le central directory. */
function listEntries(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

  // Recherche de l'End Of Central Directory en partant de la fin.
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("ZIP invalide : EOCD introuvable");

  const count = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);

  const entries = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== SIG_CEN) throw new Error("ZIP invalide : central directory corrompu");
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = utf8.decode(u8.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** Octets décompressés d'une entrée. */
async function readEntry(u8, entry) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const lo = entry.localOffset;
  if (dv.getUint32(lo, true) !== SIG_LOC) throw new Error("ZIP invalide : en-tête local corrompu");
  const nameLen = dv.getUint16(lo + 26, true);
  const extraLen = dv.getUint16(lo + 28, true);
  const start = lo + 30 + nameLen + extraLen;
  const comp = u8.subarray(start, start + entry.compSize);
  if (entry.method === 0) return comp.slice();         // stored
  if (entry.method === 8) return await inflateRaw(comp); // deflate
  throw new Error("Méthode de compression non supportée : " + entry.method);
}

/**
 * Charge un bundle depuis un File (.zip) et retourne un objet pratique :
 *  - manifest, data : objets JSON parsés
 *  - bytes(path)    : Uint8Array du fichier au chemin donné (ou null)
 *  - text(path)     : contenu texte (ou null)
 */
export async function loadBundle(file) {
  const u8 = new Uint8Array(await file.arrayBuffer());
  const entries = listEntries(u8);
  const byName = new Map(entries.map(e => [e.name, e]));

  const bytes = async (path) => {
    const e = byName.get(path);
    return e ? await readEntry(u8, e) : null;
  };
  const text = async (path) => {
    const b = await bytes(path);
    return b ? utf8.decode(b) : null;
  };

  const dataTxt = await text("data.json");
  const manifestTxt = await text("manifest.json");
  if (!dataTxt || !manifestTxt) {
    throw new Error("BAD_BUNDLE");
  }

  return {
    manifest: JSON.parse(manifestTxt),
    data: JSON.parse(dataTxt),
    bytes,
    text,
    has: (path) => byName.has(path)
  };
}
