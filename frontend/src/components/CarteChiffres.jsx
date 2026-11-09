/**
 * Carte de chiffres clés : une seule carte, des cellules séparées par un filet (plus de rangée de
 * cartes KPI à tuile d'icône). Chaque cellule : libellé (13 px, slate-600, tronqué), valeur (24 px
 * tabulaire, 20 px pour un montant) et, au besoin, une variation à côté de la valeur ou un détail
 * dessous (12 px).
 *
 * Filets : bordures gauche et haute sur chaque cellule, grille décalée d'1 px (-ml-px -mt-px) dans une
 * carte overflow-hidden. Les traits du bord gauche et du haut tombent sous la bordure de la carte : pas
 * de trait parasite quand la grille passe à la ligne (2, 3, 4 ou 5 colonnes), ni de fond gris dans une
 * dernière ligne incomplète (ce que laisserait une grille gap-px).
 *
 * Pendant le chargement (`chargement`), les mêmes cellules portent un squelette à la place de la valeur :
 * la carte garde sa taille, rien ne saute. Un libellé absent (chiffres encore inconnus) devient lui aussi
 * un squelette.
 *
 * Props
 *  - label        nom de la région (aria-label de la <section>), ex. « Chiffres des devis »
 *  - chiffres     [{ cle?, label, valeur, montant?, ton?, variation?, detail?, contenu?, onClick?, actif? }]
 *      · montant  : valeur en 20 px sans retour à la ligne (prix, chiffre d'affaires)
 *      · ton      : 'neutre' (défaut, slate-900) | 'attention' (amber-700) | 'danger' (red-700)
 *      · variation: nœud posé à droite de la valeur, sur sa ligne de base (« +12 % »)
 *      · detail   : nœud sous la valeur, en légende (« 3 visiteurs uniques »)
 *      · contenu  : nœud libre à la place de la valeur (petite liste), rare
 *      · onClick  : la cellule devient un bouton (cible 44 px) ; actif → aria-pressed (filtre en cours)
 *  - chargement   squelettes à la place des valeurs, aria-busy sur la région
 *  - colonnes     { base: 2, sm?, md?, lg?, xl? } (1 à 6), défaut { base: 2, xl: nombre de chiffres }
 *  - sombre       variante du kiosque (surface slate-800, texte slate-300 / blanc, filets white/10)
 *  - dense        variante d'aperçu dans une modale ou un panneau : marges 12 / 8 px, valeurs 20 px,
 *                 libellés longs sur plusieurs lignes au lieu d'être tronqués
 *  - className    classes de la carte (marges)
 */

// Classes écrites en entier : Tailwind ne génère que ce qu'il lit dans le code
const GRILLE = {
  base: ['', 'grid-cols-1', 'grid-cols-2', 'grid-cols-3', 'grid-cols-4', 'grid-cols-5', 'grid-cols-6'],
  sm: ['', 'sm:grid-cols-1', 'sm:grid-cols-2', 'sm:grid-cols-3', 'sm:grid-cols-4', 'sm:grid-cols-5', 'sm:grid-cols-6'],
  md: ['', 'md:grid-cols-1', 'md:grid-cols-2', 'md:grid-cols-3', 'md:grid-cols-4', 'md:grid-cols-5', 'md:grid-cols-6'],
  lg: ['', 'lg:grid-cols-1', 'lg:grid-cols-2', 'lg:grid-cols-3', 'lg:grid-cols-4', 'lg:grid-cols-5', 'lg:grid-cols-6'],
  xl: ['', 'xl:grid-cols-1', 'xl:grid-cols-2', 'xl:grid-cols-3', 'xl:grid-cols-4', 'xl:grid-cols-5', 'xl:grid-cols-6'],
};

// Contrastes : sur blanc slate-900 17,9:1, amber-700 5,0:1, red-700 6,5:1 ;
// sur slate-800 blanc 14,6:1, amber-300 10,7:1, red-300 7,9:1
const TONS = {
  neutre: ['text-slate-900', 'text-white'],
  attention: ['text-amber-700', 'text-amber-300'],
  danger: ['text-red-700', 'text-red-300'],
};

const borne = (n) => Math.min(6, Math.max(1, Math.round(Number(n) || 1)));

function classesColonnes(colonnes, nombre) {
  const c = { base: 2, ...(colonnes || { xl: borne(nombre) }) };
  return ['base', 'sm', 'md', 'lg', 'xl']
    .map((bp) => (c[bp] ? GRILLE[bp][borne(c[bp])] : ''))
    .filter(Boolean)
    .join(' ');
}

const present = (v) => v !== undefined && v !== null && v !== false && v !== '';

function Cellule({ chiffre, chargement, sombre, dense, enListe }) {
  const {
    label, valeur, montant = false, ton = 'neutre', variation, detail, contenu, onClick, actif,
  } = chiffre;
  const cliquable = typeof onClick === 'function';
  // <dl> : <div><dt/><dd/></div> ; dès qu'une cellule est un bouton, des <span> (contenu phrasé)
  const Terme = enListe ? 'dt' : 'span';
  const Definition = enListe ? 'dd' : 'span';

  const filet = sombre ? 'border-white/10' : 'border-slate-200';
  const marge = dense ? 'px-3 py-2' : 'px-4 py-3';
  const couleurValeur = (TONS[ton] || TONS.neutre)[sombre ? 1 : 0];
  const tailleValeur = montant || dense ? 'text-xl' : 'text-2xl';
  const classeValeur = `font-semibold tabular-nums ${dense ? 'leading-tight' : 'leading-none'} ${tailleValeur} ${montant ? 'whitespace-nowrap' : ''} ${couleurValeur}`;
  const classeLibelle = `block t-small ${sombre ? 'text-slate-300' : 'text-slate-600'} ${dense ? '' : 'truncate'}`;
  // Dense : valeur et détail collés au libellé, comme dans les aperçus d'origine
  const ecart = dense ? '' : 'mt-1';
  const classeDetail = `block t-caption ${ecart} ${sombre ? 'text-slate-300' : ''}`;

  const corps = (
    <>
      <Terme className={classeLibelle}>
        {present(label) ? label : <span className="skeleton-line block w-24" aria-hidden="true" />}
      </Terme>
      {chargement ? (
        <Definition className={`block ${ecart}`} aria-hidden="true">
          <span className={`skeleton-line block ${montant || dense ? 'h-5' : 'h-6'} ${contenu ? 'w-24' : 'w-14'}`} />
        </Definition>
      ) : present(contenu) ? (
        <Definition className="block mt-2">{contenu}</Definition>
      ) : (
        <Definition className={`${ecart} flex flex-wrap items-baseline gap-x-2 min-w-0`}>
          <span className={classeValeur}>{present(valeur) ? valeur : '—'}</span>
          {present(variation) && variation}
        </Definition>
      )}
      {present(detail) && !chargement && <Definition className={classeDetail}>{detail}</Definition>}
      {chargement && present(detail) && (
        <Definition className="block mt-1.5" aria-hidden="true"><span className="skeleton-line block h-3 w-24" /></Definition>
      )}
    </>
  );

  const base = `min-w-0 border-l border-t ${filet} ${marge}`;
  if (cliquable) {
    const fond = actif
      ? (sombre ? 'bg-white/10' : 'bg-slate-100')
      : (sombre ? 'hover:bg-white/5' : 'hover:bg-slate-50');
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={actif === undefined ? undefined : !!actif}
        className={`${base} ${fond} block w-full min-h-11 text-left transition-colors duration-150 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500`}
      >
        {corps}
      </button>
    );
  }
  return <div className={base}>{corps}</div>;
}

export default function CarteChiffres({
  label, chiffres = [], chargement = false, colonnes, sombre = false, dense = false, className = '',
}) {
  const enListe = !chiffres.some((c) => typeof c.onClick === 'function');
  const Grille = enListe ? 'dl' : 'div';
  const surface = sombre ? 'rounded-lg border border-slate-700 bg-slate-800' : 'card';
  return (
    <section aria-label={label} aria-busy={chargement} className={`${surface} overflow-hidden ${className}`}>
      <Grille className={`-ml-px -mt-px grid ${classesColonnes(colonnes, chiffres.length)}`}>
        {chiffres.map((chiffre, i) => (
          <Cellule
            key={chiffre.cle ?? (typeof chiffre.label === 'string' ? chiffre.label : i)}
            chiffre={chiffre}
            chargement={chargement}
            sombre={sombre}
            dense={dense}
            enListe={enListe}
          />
        ))}
      </Grille>
    </section>
  );
}
