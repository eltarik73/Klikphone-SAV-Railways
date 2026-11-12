import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Download, Printer, RefreshCw } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import {
  FORMATS, THEMES, contenuAffiche, dessinerAffiche, nomFichier, preparerRessources, texteAlternatif,
} from '../lib/afficheTombola';

/**
 * Affiche de la tombola ouverte, générée à partir de son titre, de ses lots et de sa date : à imprimer
 * en A4 pour la vitrine, ou à télécharger en image pour Instagram (4:5) et les stories (9:16).
 * Point focal : l'aperçu. Action primaire : « Imprimer » en A4, « Télécharger l'image » sinon.
 */
const IMPRESSION = `
@media print {
  @page { size: A4 portrait; margin: 0; }
  body * { visibility: hidden !important; }
  .affiche-impression, .affiche-impression * { visibility: visible !important; }
  .affiche-impression { position: fixed !important; inset: 0 !important; margin: 0 !important; padding: 0 !important;
    border: 0 !important; max-width: none !important; background: #fff !important; }
  .affiche-impression img { width: 210mm !important; height: 297mm !important; max-width: none !important; }
}`;

function Choix({ legende, valeur, options, onChange }) {
  return (
    <fieldset>
      <legend className="input-label">{legende}</legend>
      <div className="segmented">
        {options.map((o) => (
          <button key={o.id} type="button" aria-pressed={valeur === o.id} onClick={() => onChange(o.id)}
            className={`segmented-item ${valeur === o.id ? 'segmented-item-active' : ''}`}>
            {o.libelle}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export default function TombolaAffichePage() {
  const { user } = useAuth();
  const retour = `${user?.target === 'tech' ? '/tech' : '/accueil'}/tombola`;
  const [etat, setEtat] = useState({ chargement: true, tombola: null, boutique: {}, erreur: null });
  const [essai, setEssai] = useState(0);
  const [format, setFormat] = useState('a4');
  const [theme, setTheme] = useState('clair');
  const [image, setImage] = useState(null);       // data URL du PNG affiché
  const [sansCanvas, setSansCanvas] = useState(false);

  useEffect(() => {
    let vivant = true;
    setEtat((e) => ({ ...e, chargement: true, erreur: null }));
    Promise.all([api.getTombolaEnCours(), api.getPublicConfig().catch(() => ({}))])
      .then(([r, cfg]) => {
        if (!vivant) return;
        const c = cfg && typeof cfg === 'object' ? cfg : {};
        setEtat({
          chargement: false, erreur: null, tombola: r?.tombola || null,
          boutique: {
            nom: c.BOUTIQUE_NOM || c.NOM_BOUTIQUE, adresse: c.BOUTIQUE_ADRESSE || c.ADRESSE_BOUTIQUE,
            tel: c.BOUTIQUE_TEL || c.TEL_BOUTIQUE,
          },
        });
      })
      .catch((err) => { if (vivant) setEtat((e) => ({ ...e, chargement: false, erreur: err.message || 'Chargement impossible' })); });
    return () => { vivant = false; };
  }, [essai]);

  const contenu = useMemo(
    () => (etat.tombola ? contenuAffiche(etat.tombola, etat.boutique) : null),
    [etat.tombola, etat.boutique],
  );

  useEffect(() => {
    if (!contenu) return undefined;
    let vivant = true;
    preparerRessources().then((ressources) => {
      if (!vivant) return;
      const canvas = document.createElement('canvas');
      let ok = false;
      try {
        ok = dessinerAffiche(canvas, { format, theme, contenu, ressources });
      } catch {
        ok = false;
      }
      if (ok) {
        setImage(canvas.toDataURL('image/png'));
        setSansCanvas(false);
      } else {
        setImage(null);
        setSansCanvas(true);
      }
    });
    return () => { vivant = false; };
  }, [contenu, format, theme]);

  const f = FORMATS[format];
  const imprimable = format === 'a4';

  return (
    <div className="page max-w-5xl">
      <style>{IMPRESSION}</style>
      <div className="page-header">
        <div className="min-w-0">
          <Link to={retour} className="inline-flex items-center gap-1.5 min-h-11 text-sm font-medium text-brand-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Tombola
          </Link>
          <h1 className="page-header-title">Affiche de la tombola</h1>
          <p className="page-header-subtitle">Créée à partir du titre, des lots et de la date : elle suit chaque modification</p>
        </div>
        {image && (
          <div className="page-header-actions">
            {imprimable ? (
              <>
                <a href={image} download={nomFichier(format, theme)} className="btn-secondary">
                  <Download aria-hidden="true" /> Télécharger l’image
                </a>
                <button type="button" onClick={() => window.print()} className="btn-primary">
                  <Printer aria-hidden="true" /> Imprimer
                </button>
              </>
            ) : (
              <a href={image} download={nomFichier(format, theme)} className="btn-primary">
                <Download aria-hidden="true" /> Télécharger l’image
              </a>
            )}
          </div>
        )}
      </div>

      {etat.chargement && <div className="skeleton h-96 max-w-md" role="status" aria-label="Chargement de l’affiche" />}

      {etat.erreur && (
        <div role="alert" className="callout callout-danger items-center">
          <AlertCircle aria-hidden="true" />
          <p className="flex-1">L’affiche n’a pas pu être préparée : {etat.erreur}</p>
          <button type="button" onClick={() => setEssai((n) => n + 1)} className="btn-secondary btn-sm">
            <RefreshCw aria-hidden="true" /> Réessayer
          </button>
        </div>
      )}

      {!etat.chargement && !etat.erreur && !etat.tombola && (
        <div className="card">
          <div className="empty-state">
            <h2 className="t-h2">Aucune tombola ouverte</h2>
            <p className="t-body max-w-md">L’affiche se crée dès qu’une tombola est ouverte, avec ses lots et la date du tirage.</p>
            <Link to={retour} className="btn-secondary">Retour à la tombola</Link>
          </div>
        </div>
      )}

      {contenu && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px] items-start">
          <div className={`affiche-impression card overflow-hidden mx-auto w-full ${format === 'a4' ? 'max-w-lg' : 'max-w-sm'}`}>
            {image ? (
              <img src={image} alt={texteAlternatif(contenu)} width={f.largeur} height={f.hauteur} className="block w-full h-auto" />
            ) : sansCanvas ? (
              <p className="t-body p-5">L’aperçu ne peut pas être dessiné sur cet appareil. Ouvrez cette page sur l’ordinateur de la boutique.</p>
            ) : (
              <div className="skeleton rounded-none" style={{ aspectRatio: `${f.largeur} / ${f.hauteur}` }} role="status" aria-label="Dessin de l’affiche" />
            )}
          </div>
          <div className="space-y-5">
            <Choix legende="Format" valeur={format} onChange={setFormat} options={Object.values(FORMATS)} />
            <Choix legende="Fond" valeur={theme} onChange={setTheme} options={Object.values(THEMES)} />
            <p className="t-small">
              {imprimable
                ? 'A4 en 300 points par pouce : imprimez sans marges, à 100 %. Le fond clair consomme moins d’encre.'
                : 'Pour Instagram : téléchargez l’image, puis ajoutez-la comme photo dans Community Manager.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
