import { heureFr, jourTirage } from './tombola';

/**
 * Affiche de la tombola, dessinée sur un canvas à partir de la tombola ouverte : la même image sert à
 * l'impression (A4, 300 points par pouce), à Instagram (4:5) et aux stories ou à l'écran de vitrine (9:16).
 * Noir et blanc, typographie Inter, logo officiel tel quel (K orange) : aucune autre couleur, aucun dégradé.
 */
export const FORMATS = {
  a4: { id: 'a4', libelle: 'A4 à imprimer', largeur: 2480, hauteur: 3508 },
  instagram: { id: 'instagram', libelle: 'Instagram 4:5', largeur: 1080, hauteur: 1350 },
  story: { id: 'story', libelle: 'Story 9:16', largeur: 1080, hauteur: 1920 },
};

export const THEMES = {
  clair: {
    id: 'clair', libelle: 'Fond clair', fond: '#FFFFFF', encre: '#0F172A', discret: '#475569', filet: '#CBD5E1',
    bloc: '#0F172A', blocEncre: '#FFFFFF', blocDiscret: '#CBD5E1', blocFilet: '#475569',
    mot: '/brand/klikphone-wordmark-noir.png',
  },
  sombre: {
    id: 'sombre', libelle: 'Fond sombre', fond: '#0F172A', encre: '#FFFFFF', discret: '#CBD5E1', filet: '#334155',
    bloc: '#FFFFFF', blocEncre: '#0F172A', blocDiscret: '#475569', blocFilet: '#CBD5E1',
    mot: '/brand/klikphone-wordmark-blanc.png',
  },
};

const LOGO_K = '/brand/klikphone-k.svg';
const RAPPORT_MOT = 5.29;   // largeur / hauteur du mot « KlikPhone® » (components/LogoK.jsx)
const POLICE = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const AUTRES_LOTS_MAX = 4;

const texte = (v) => (typeof v === 'string' ? v.trim() : '');

/** Les textes de l'affiche, tirés de la tombola et de l'identité de la boutique (fonction pure). */
export function contenuAffiche(tombola, boutique = {}) {
  const lots = (Array.isArray(tombola?.lots) ? tombola.lots : []).map(texte).filter(Boolean);
  const suivants = lots.slice(1);
  const autres = suivants.slice(0, AUTRES_LOTS_MAX).map((lot, i) => `${i + 2}e lot — ${lot}`);
  const reste = suivants.length - autres.length;
  if (reste > 0) autres.push(`et ${reste} autre${reste > 1 ? 's' : ''} lot${reste > 1 ? 's' : ''}`);
  const nom = texte(boutique.nom) || 'Klikphone';
  return {
    surtitre: 'Tombola gratuite',
    titre: texte(tombola?.titre) || 'Tombola',
    aGagner: 'À gagner',
    lotPrincipal: lots[0] || '',
    autresLots: autres,
    tirage: 'Tirage au sort',
    jour: jourTirage(tombola?.tirage_le),
    heure: tombola?.tirage_le ? `à ${heureFr(tombola.tirage_le)}` : '',
    participerTitre: 'Pour participer',
    participer: 'Cochez la case « Je participe à la tombola » en déposant votre appareil, ou demandez-le au comptoir.',
    faits: ['Participation gratuite', 'Sans obligation d’achat', 'Une participation par personne'],
    pied: { nom, adresse: texte(boutique.adresse), tel: texte(boutique.tel) },
    mention: `Lots offerts par ${nom}. Règlement disponible en boutique.`,
  };
}

/** Description de l'image pour les lecteurs d'écran. */
export function texteAlternatif(c) {
  return [
    `Affiche : ${c.titre}, ${c.surtitre.toLowerCase()}.`,
    c.lotPrincipal ? `${c.aGagner} : ${[c.lotPrincipal, ...c.autresLots].join(', ')}.` : '',
    c.jour ? `${c.tirage} ${c.jour} ${c.heure}.` : '',
    `${c.faits.join(', ')}.`,
    [c.pied.nom, c.pied.adresse, c.pied.tel].filter(Boolean).join(', '),
  ].filter(Boolean).join(' ');
}

// ─── Ressources (police, logo) ───────────────────────────────────
const ATTENTE_IMAGE_MS = 5000;

function chargerImage(src) {
  // Jamais bloquant : une image absente ou trop lente donne une affiche sans logo, pas une page figée
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') { resolve(null); return; }
    const img = new Image();
    const delai = setTimeout(() => resolve(null), ATTENTE_IMAGE_MS);
    const finir = (valeur) => { clearTimeout(delai); resolve(valeur); };
    img.decoding = 'async';
    img.onload = () => finir(img);
    img.onerror = () => finir(null);
    img.src = src;
  });
}

let ressources = null;
/** Police Inter (4 graisses) et images du logo, chargées une fois (réessayées si le logo a manqué). */
export function preparerRessources() {
  if (!ressources) {
    const polices = typeof document !== 'undefined' && document.fonts?.load
      ? Promise.all([400, 500, 600, 700].map((g) => document.fonts.load(`${g} 48px Inter`).catch(() => null)))
      : Promise.resolve();
    const promesse = Promise.all([
      polices, chargerImage(LOGO_K), chargerImage(THEMES.clair.mot), chargerImage(THEMES.sombre.mot),
    ]).then(([, k, motClair, motSombre]) => {
      if (!k || !motClair || !motSombre) { if (ressources === promesse) ressources = null; }
      return { k, mots: { clair: motClair, sombre: motSombre } };
    });
    ressources = promesse;
  }
  return ressources;
}

// ─── Typographie sur canvas ──────────────────────────────────────
function police(ctx, graisse, taille, approche = 0) {
  ctx.font = `${graisse} ${Math.round(taille)}px ${POLICE}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(approche * taille).toFixed(2)}px`;
}

function couper(ctx, phrase, largeur) {
  const lignes = [];
  let ligne = '';
  String(phrase || '').split(/\s+/).filter(Boolean).forEach((mot) => {
    const essai = ligne ? `${ligne} ${mot}` : mot;
    if (ligne && ctx.measureText(essai).width > largeur) {
      lignes.push(ligne);
      ligne = mot;
    } else {
      ligne = essai;
    }
  });
  if (ligne) lignes.push(ligne);
  return lignes;
}

/** Plus grande taille (entre max et min) où `phrase` tient en `lignesMax` lignes de `largeur`. */
function ajuster(ctx, phrase, { graisse, max, min, largeur, lignesMax, approche = 0 }) {
  const pas = Math.max(1, (max - min) / 24);
  for (let taille = max; taille >= min; taille -= pas) {
    police(ctx, graisse, taille, approche);
    const lignes = couper(ctx, phrase, largeur);
    if (lignes.length <= lignesMax && lignes.every((l) => ctx.measureText(l).width <= largeur)) return { taille, lignes, tient: true };
  }
  police(ctx, graisse, min, approche);
  const lignes = couper(ctx, phrase, largeur);
  if (lignes.length > lignesMax) {
    lignes.length = lignesMax;
    let fin = lignes[lignesMax - 1];
    while (fin.length > 1 && ctx.measureText(`${fin}…`).width > largeur) fin = fin.slice(0, -1).trimEnd();
    lignes[lignesMax - 1] = `${fin}…`;
  }
  return { taille: min, lignes, tient: false };
}

/** Bloc de texte : mesure d'abord (hauteur), dessine ensuite à l'ordonnée voulue. */
function blocTexte(ctx, lignes, { graisse, taille, interligne = 1.15, couleur, approche = 0, capitales = false }) {
  const contenu = capitales ? lignes.map((l) => l.toUpperCase()) : lignes;
  return {
    hauteur: contenu.length ? taille * interligne * (contenu.length - 1) + taille : 0,
    dessiner(x, y) {
      police(ctx, graisse, taille, approche);
      ctx.fillStyle = couleur;
      ctx.textBaseline = 'top';
      contenu.forEach((l, i) => ctx.fillText(l, x, y + i * taille * interligne));
    },
  };
}

function empiler(blocs) {
  // [{ bloc, apres }] → hauteur totale et dessin en colonne
  const hauteur = blocs.reduce((h, b, i) => h + b.bloc.hauteur + (i < blocs.length - 1 ? b.apres || 0 : 0), 0);
  return {
    hauteur,
    dessiner(x, y) {
      let cy = y;
      blocs.forEach((b) => { b.bloc.dessiner(x, cy); cy += b.bloc.hauteur + (b.apres || 0); });
    },
  };
}

function ticket(ctx, x, y, largeur, hauteur, coupe, rayon, encoche) {
  // Billet de tombola : coins arrondis, deux encoches en demi-cercle à la hauteur de la ligne de coupe
  ctx.beginPath();
  ctx.moveTo(x + rayon, y);
  ctx.lineTo(x + largeur - rayon, y);
  ctx.arcTo(x + largeur, y, x + largeur, y + rayon, rayon);
  ctx.lineTo(x + largeur, coupe - encoche);
  ctx.arc(x + largeur, coupe, encoche, -Math.PI / 2, Math.PI / 2, true);
  ctx.lineTo(x + largeur, y + hauteur - rayon);
  ctx.arcTo(x + largeur, y + hauteur, x + largeur - rayon, y + hauteur, rayon);
  ctx.lineTo(x + rayon, y + hauteur);
  ctx.arcTo(x, y + hauteur, x, y + hauteur - rayon, rayon);
  ctx.lineTo(x, coupe + encoche);
  ctx.arc(x, coupe, encoche, Math.PI / 2, -Math.PI / 2, true);
  ctx.lineTo(x, y + rayon);
  ctx.arcTo(x, y, x + rayon, y, rayon);
  ctx.closePath();
}

/**
 * Dessine l'affiche. `ressources` : résultat de preparerRessources() (sans lui : pas de logo, police de repli).
 * Renvoie false si le canvas n'a pas de contexte 2D (navigateur sans canvas, tests).
 */
export function dessinerAffiche(canvas, { format = 'a4', theme = 'clair', contenu, ressources: res } = {}) {
  const f = FORMATS[format] || FORMATS.a4;
  const t = THEMES[theme] || THEMES.clair;
  canvas.width = f.largeur;
  canvas.height = f.hauteur;
  const ctx = canvas.getContext?.('2d');
  if (!ctx || !contenu) return false;

  const W = f.largeur;
  const H = f.hauteur;
  const u = W / 100;
  const M = 8 * u;
  const L = W - 2 * M;
  const dense = H / u < 132;   // Instagram 4:5 : moins de hauteur pour la même largeur

  ctx.fillStyle = t.fond;
  ctx.fillRect(0, 0, W, H);

  // ── En-tête : le logo officiel, tel quel
  const kTaille = 9 * u;
  const motHauteur = 4.3 * u;
  const entete = {
    hauteur: kTaille,
    dessiner(x, y) {
      if (res?.k) ctx.drawImage(res.k, x, y, kTaille, kTaille);
      const mot = res?.mots?.[t.id];
      if (mot) ctx.drawImage(mot, x + kTaille + 2.4 * u, y + (kTaille - motHauteur) / 2, motHauteur * RAPPORT_MOT, motHauteur);
    },
  };

  // ── Milieu : titre, billet (lot en haut, date sous la ligne de coupe), comment participer.
  // `e` réduit toute la typographie d'un même facteur quand un titre long ou plusieurs lots débordent.
  const milieuPour = (e, complet) => {
    const v = (n) => n * u * e;
    // Titre sur une ligne s'il y tient en grand, sinon sur deux
    const surUneLigne = ajuster(ctx, contenu.titre, { graisse: 700, max: v(15), min: v(9.5), largeur: L, lignesMax: 1, approche: -0.035 });
    const titre = surUneLigne.tient
      ? surUneLigne
      : ajuster(ctx, contenu.titre, { graisse: 700, max: v(13), min: v(7), largeur: L, lignesMax: 2, approche: -0.035 });
    const blocTitre = empiler([
      { bloc: blocTexte(ctx, [contenu.surtitre], { graisse: 600, taille: v(2.5), couleur: t.discret, approche: 0.14, capitales: true }), apres: v(2.6) },
      { bloc: blocTexte(ctx, titre.lignes, { graisse: 700, taille: titre.taille, interligne: 1.02, couleur: t.encre, approche: -0.035 }) },
    ]);

    const P = v(5);
    const interieur = L - 2 * P;
    const lot = ajuster(ctx, contenu.lotPrincipal, { graisse: 700, max: v(9.5), min: v(5), largeur: interieur, lignesMax: 3, approche: -0.03 });
    police(ctx, 500, v(3.1));
    const autres = contenu.autresLots.flatMap((l) => couper(ctx, l, interieur));
    const haut = empiler([
      { bloc: blocTexte(ctx, [contenu.aGagner], { graisse: 600, taille: v(2.3), couleur: t.blocDiscret, approche: 0.14, capitales: true }), apres: v(2.4) },
      { bloc: blocTexte(ctx, lot.lignes, { graisse: 700, taille: lot.taille, interligne: 1.05, couleur: t.blocEncre, approche: -0.03 }), apres: autres.length ? v(3) : 0 },
      { bloc: blocTexte(ctx, autres, { graisse: 500, taille: v(3.1), interligne: 1.35, couleur: t.blocEncre }) },
    ]);
    const jour = ajuster(ctx, contenu.jour, { graisse: 700, max: v(6.4), min: v(4), largeur: interieur, lignesMax: 1, approche: -0.02 });
    const bas = empiler([
      { bloc: blocTexte(ctx, [contenu.tirage], { graisse: 600, taille: v(2.3), couleur: t.blocDiscret, approche: 0.14, capitales: true }), apres: v(2.2) },
      { bloc: blocTexte(ctx, jour.lignes, { graisse: 700, taille: jour.taille, couleur: t.blocEncre, approche: -0.02 }), apres: v(1.4) },
      { bloc: blocTexte(ctx, contenu.heure ? [contenu.heure] : [], { graisse: 500, taille: v(3.8), couleur: t.blocEncre }) },
    ]);
    const billet = {
      hauteur: P + haut.hauteur + P + P + bas.hauteur + P,
      dessiner(x, y) {
        const coupe = y + P + haut.hauteur + P;
        ctx.fillStyle = t.bloc;
        ticket(ctx, x, y, L, this.hauteur, coupe, 2.2 * u, 2.4 * u);
        ctx.fill();
        ctx.save();
        ctx.strokeStyle = t.blocFilet;
        ctx.lineWidth = Math.max(2, 0.28 * u);
        ctx.setLineDash([1.6 * u, 1.4 * u]);
        ctx.beginPath();
        ctx.moveTo(x + 4.2 * u, coupe);
        ctx.lineTo(x + L - 4.2 * u, coupe);
        ctx.stroke();
        ctx.restore();
        haut.dessiner(x + P, y + P);
        bas.dessiner(x + P, coupe + P);
      },
    };

    // Les trois garanties figurent toujours sur l'affiche ; la phrase « pour participer » seulement s'il reste la place
    police(ctx, 600, v(3.1));
    const faitsEnLigne = contenu.faits.join('  ·  ');
    const faits = ctx.measureText(faitsEnLigne).width <= L ? [faitsEnLigne] : contenu.faits;
    const blocFaits = blocTexte(ctx, faits, { graisse: 600, taille: v(3.1), interligne: 1.45, couleur: t.encre });
    if (!complet) return [blocTitre, billet, blocFaits];
    police(ctx, 400, v(3.3));
    const participer = couper(ctx, contenu.participer, L);
    const blocParticiper = empiler([
      { bloc: blocTexte(ctx, [contenu.participerTitre], { graisse: 600, taille: v(2.3), couleur: t.discret, approche: 0.14, capitales: true }), apres: v(2) },
      { bloc: blocTexte(ctx, participer, { graisse: 400, taille: v(3.3), interligne: 1.4, couleur: t.encre }), apres: v(3.2) },
      { bloc: blocFaits },
    ]);
    return [blocTitre, billet, blocParticiper];
  };

  // ── Pied : la boutique
  const { nom, adresse, tel } = contenu.pied;
  police(ctx, 400, 2.5 * u);
  const coordonnees = couper(ctx, [adresse, tel].filter(Boolean).join('  ·  '), L);
  const mention = couper(ctx, contenu.mention, L);
  const textesPied = empiler([
    { bloc: blocTexte(ctx, [nom], { graisse: 700, taille: 3 * u, couleur: t.encre }), apres: 1.2 * u },
    { bloc: blocTexte(ctx, coordonnees, { graisse: 400, taille: 2.5 * u, interligne: 1.35, couleur: t.encre }), apres: coordonnees.length ? 1.6 * u : 0 },
    { bloc: blocTexte(ctx, mention, { graisse: 400, taille: 2.1 * u, interligne: 1.35, couleur: t.discret }) },
  ]);
  const pied = {
    hauteur: 3 * u + textesPied.hauteur,
    dessiner(x, y) {
      ctx.fillStyle = t.filet;
      ctx.fillRect(x, y, L, Math.max(2, 0.18 * u));
      textesPied.dessiner(x, y + 3 * u);
    },
  };

  // ── Mise en page : en-tête en haut, pied en bas, le milieu réparti. S'il déborde, on réduit la
  // typographie (jusqu'à 64 %) ; ensuite seulement on retire la phrase « pour participer ».
  const dispo = H - 2 * M - entete.hauteur - pied.hauteur;
  const ecartMin = dense ? 3.5 * u : 4.5 * u;
  const hauteurDe = (blocs) => blocs.reduce((h, b) => h + b.hauteur, 0);
  const tient = (blocs) => hauteurDe(blocs) + ecartMin * (blocs.length + 1) <= dispo;
  const echelles = (de, a) => Array.from({ length: Math.round((de - a) / 0.04) + 1 }, (_, i) => de - i * 0.04);
  let milieu = null;
  for (const [complet, mini] of [[true, 0.64], [false, 0.5]]) {
    for (const e of echelles(1, mini)) {
      const essai = milieuPour(e, complet);
      if (tient(essai)) { milieu = essai; break; }
    }
    if (milieu) break;
  }
  if (!milieu) milieu = milieuPour(0.5, false);
  const ecart = Math.max(2 * u, Math.min((dispo - hauteurDe(milieu)) / (milieu.length + 1), 13 * u));

  entete.dessiner(M, M);
  let y = M + entete.hauteur + ecart;
  milieu.forEach((b) => { b.dessiner(M, y); y += b.hauteur + ecart; });
  pied.dessiner(M, H - M - pied.hauteur);
  return true;
}

/** Nom de fichier de l'image : « affiche-tombola-a4-clair.png » */
export const nomFichier = (format, theme) => `affiche-tombola-${format}-${theme}.png`;
