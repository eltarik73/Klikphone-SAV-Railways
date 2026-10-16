import { useState, useEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { ArrowLeft, ShieldCheck, RefreshCw, X, ExternalLink } from 'lucide-react';

export const RETENTION_MOIS_DEFAUT = 36;
export const PURGE_JOURS_DEFAUT = 30;

const entier = (v, defaut) => {
  const n = parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : defaut;
};

/** 36 → « 3 ans », 18 → « 18 mois », 12 → « 1 an » */
export function dureeMois(mois) {
  const n = entier(mois, RETENTION_MOIS_DEFAUT);
  if (n > 0 && n % 12 === 0) {
    const ans = n / 12;
    return `${ans} an${ans > 1 ? 's' : ''}`;
  }
  return `${n} mois`;
}

/** Valeurs utiles à l'information courte, depuis /api/config/public (repli si absentes). */
export function infosRgpd(cfg = {}) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const texte = (k) => (typeof c[k] === 'string' ? c[k].trim() : '');
  return {
    nom: texte('BOUTIQUE_NOM') || texte('NOM_BOUTIQUE') || 'Klikphone',
    contact: texte('RGPD_CONTACT_EMAIL') || texte('BOUTIQUE_EMAIL'),
    retention: dureeMois(c.RGPD_RETENTION_MOIS),
    purgeJours: entier(c.PURGE_CODES_JOURS, PURGE_JOURS_DEFAUT),
  };
}

// Une seule lecture de la configuration publique par chargement de page (borne : plusieurs dépôts)
let configPublique = null;
function lireConfigPublique() {
  if (!configPublique) {
    configPublique = Promise.resolve()
      .then(() => api.getPublicConfig())
      .catch(() => {
        configPublique = null;
        return {};
      });
  }
  return configPublique;
}
export function _oublierConfigPublique() { configPublique = null; }

function useInfosRgpd() {
  const [infos, setInfos] = useState(() => infosRgpd());
  useEffect(() => {
    let actif = true;
    lireConfigPublique().then((cfg) => { if (actif) setInfos(infosRgpd(cfg)); });
    return () => { actif = false; };
  }, []);
  return infos;
}

function useConfidentialite(actif = true) {
  const [etat, setEtat] = useState({ data: null, error: null, loading: actif });
  const [essai, setEssai] = useState(0);
  useEffect(() => {
    if (!actif) return undefined;
    let vivant = true;
    setEtat((e) => ({ ...e, error: null, loading: true }));
    api.getConfidentialite()
      .then((data) => { if (vivant) setEtat({ data, error: null, loading: false }); })
      .catch((error) => { if (vivant) setEtat({ data: null, error, loading: false }); });
    return () => { vivant = false; };
  }, [actif, essai]);
  return { ...etat, recharger: () => setEssai((n) => n + 1) };
}

function Paragraphes({ texte }) {
  const blocs = String(texte || '').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return blocs.map((b, i) => (
    <p key={i} className="text-sm leading-relaxed text-slate-700 whitespace-pre-line [overflow-wrap:anywhere]">{b}</p>
  ));
}

/** Contenu de la politique (titres de section au niveau `niveau`). */
export function PolitiqueContenu({ data, niveau = 2 }) {
  const Titre = `h${Math.min(6, Math.max(2, niveau))}`;
  const sections = Array.isArray(data?.sections) ? data.sections : [];
  return (
    <div className="space-y-6">
      {sections.map((s, i) => (
        <section key={`${i}-${s?.titre || ''}`} className="space-y-2">
          {s?.titre && <Titre className="text-base font-bold text-slate-900">{s.titre}</Titre>}
          <Paragraphes texte={s?.texte} />
        </section>
      ))}
    </div>
  );
}

function EtatChargement({ loading, error, onRetry }) {
  if (loading) {
    return (
      <div role="status" className="py-10 flex flex-col items-center gap-3 text-slate-600">
        <RefreshCw className="w-5 h-5 motion-safe:animate-spin" aria-hidden="true" />
        <p className="text-sm">Chargement de la politique de confidentialité…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div role="alert" className="py-8 text-center">
        <p className="text-sm text-slate-700">La politique de confidentialité n'a pas pu être chargée.</p>
        <button type="button" onClick={onRetry} className="btn-secondary mt-4 min-h-[44px]">
          <RefreshCw className="w-4 h-4" aria-hidden="true" /> Réessayer
        </button>
      </div>
    );
  }
  return null;
}

/**
 * Fenêtre de la politique : la borne garde le formulaire en cours (pas de changement de page).
 * Rendue dans <body> : les cartes animées (.animate-in) gardent un transform qui servirait sinon
 * de référence au position: fixed. `kiosque` : pas de lien vers un nouvel onglet (tablette en
 * boutique : le client ne doit pas quitter un dépôt à moitié saisi).
 */
export function PolitiqueDialog({ open, onClose, kiosque = false }) {
  const boxRef = useRef(null);
  const titreId = useId();
  const { data, error, loading, recharger } = useConfidentialite(open);
  useFocusTrap(boxRef, open, { onEscape: () => onClose?.() });
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-slate-900/60 p-0 sm:p-4" onClick={onClose}>
      <div ref={boxRef} role="dialog" aria-modal="true" aria-labelledby={titreId}
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-2xl max-h-[90vh] rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col">
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-100 shrink-0">
          <h2 id={titreId} className="text-base font-bold text-slate-900">
            {data?.titre || 'Politique de confidentialité'}
          </h2>
          <button type="button" onClick={onClose} aria-label="Fermer la politique de confidentialité"
            className="w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain px-5 py-4">
          <EtatChargement loading={loading} error={error} onRetry={recharger} />
          {data && <PolitiqueContenu data={data} niveau={3} />}
          {data?.maj && <p className="mt-6 text-xs text-slate-600">Mise à jour : {data.maj}</p>}
        </div>
        <div className={`flex flex-wrap items-center gap-2 px-5 py-3 border-t border-slate-100 shrink-0 ${kiosque ? 'justify-end' : 'justify-between'}`}>
          {!kiosque && (
            <a href="/confidentialite" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 min-h-[44px] text-sm font-medium text-brand-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded">
              Ouvrir dans une page <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="sr-only">(nouvel onglet)</span>
            </a>
          )}
          <button type="button" onClick={onClose} className="btn-primary min-h-[44px]">J'ai compris</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Information courte (art. 13 RGPD) affichée au dépôt : qui, pourquoi, combien de temps, droits,
 * contact, et lien vers la politique complète. `codes` : le formulaire recueille les codes d'accès ;
 * `kiosque` : voir PolitiqueDialog.
 */
export function MentionRgpd({ codes = true, kiosque = false, className = '' }) {
  const infos = useInfosRgpd();
  const [ouvert, setOuvert] = useState(false);
  const titreId = useId();
  return (
    <section aria-labelledby={titreId}
      className={`rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 ${className}`}>
      <h3 id={titreId} className="flex items-center gap-2 font-semibold text-slate-900 mb-1.5">
        <ShieldCheck className="w-4 h-4 text-brand-700 shrink-0" aria-hidden="true" />
        Vos données personnelles
      </h3>
      <p className="leading-relaxed">
        {infos.nom} utilise vos coordonnées et les informations sur votre appareil pour gérer votre réparation
        et la facturer. Elles sont conservées {infos.retention} après votre dernière visite
        {codes ? ` ; vos codes de déverrouillage sont effacés ${infos.purgeJours} jours après la remise de l'appareil` : ''}.
        {' '}Vous pouvez y accéder, les corriger, les faire effacer ou vous opposer à leur utilisation
        {infos.contact ? <> en écrivant à <span className="font-medium [overflow-wrap:anywhere]">{infos.contact}</span> ou en boutique</> : ' en le demandant en boutique'}
        , et saisir la CNIL.
      </p>
      <button type="button" onClick={() => setOuvert(true)}
        className="mt-1 inline-flex items-center min-h-[44px] font-semibold text-brand-700 underline underline-offset-2 hover:text-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded">
        Politique de confidentialité
      </button>
      <PolitiqueDialog open={ouvert} onClose={() => setOuvert(false)} kiosque={kiosque} />
    </section>
  );
}

/**
 * Case FACULTATIVE, jamais pré-cochée : sans effet sur le dépôt. Canal et objet nommés
 * (consentement spécifique, CPCE L34-5) ; les demandes d'avis n'en dépendent pas aujourd'hui.
 */
export function ConsentementMarketing({ id, checked, onChange }) {
  const { nom } = useInfosRgpd();
  const aideId = `${id}-aide`;
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <label htmlFor={id} className="flex items-start gap-3 min-h-[44px] cursor-pointer">
        <input id={id} type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)}
          aria-describedby={aideId}
          className="mt-0.5 w-6 h-6 shrink-0 rounded border-slate-400 text-brand-600 focus:ring-2 focus:ring-brand-500" />
        <span className="text-sm font-medium text-slate-800">J'accepte de recevoir par SMS ou e-mail des offres de {nom}</span>
      </label>
      <p id={aideId} className="mt-1 pl-9 text-xs text-slate-600">
        Facultatif, sans effet sur votre réparation. Vous pouvez retirer votre accord à tout moment.
      </p>
    </div>
  );
}

export default function ConfidentialitePage() {
  const { data, error, loading, recharger } = useConfidentialite(true);
  const titre = data?.titre || 'Politique de confidentialité';

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const avant = document.title;
    document.title = `${titre} — Klikphone`;
    return () => { document.title = avant; };
  }, [titre]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-900 text-white">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link to="/" aria-label="Retour à l'accueil"
            className="w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-xl hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
            <ArrowLeft className="w-5 h-5" aria-hidden="true" />
          </Link>
          <div className="w-10 h-10 rounded-xl bg-white p-1 overflow-hidden shrink-0">
            <img src="/logo_k.png" alt="" width="40" height="40" className="w-full h-full object-contain" />
          </div>
          <p className="font-display font-bold tracking-tight">KLIKPHONE</p>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-6 sm:py-10">
        <div className="card p-5 sm:p-8">
          <h1 className="text-2xl font-display font-bold text-slate-900 tracking-tight mb-6">{titre}</h1>
          <EtatChargement loading={loading} error={error} onRetry={recharger} />
          {data && <PolitiqueContenu data={data} niveau={2} />}
          {data?.maj && <p className="mt-8 pt-4 border-t border-slate-100 text-xs text-slate-600">Mise à jour : {data.maj}</p>}
        </div>
      </main>
    </div>
  );
}
