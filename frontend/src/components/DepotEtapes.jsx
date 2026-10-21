import {
  Gift, Clock, PencilLine, Smartphone, BatteryLow, Plug, SwitchCamera, Camera, Volume2, Power, Speaker, Mic,
  Layers, Droplets, Cpu, Stethoscope, PowerOff, Bug, RefreshCw, MoreHorizontal,
} from 'lucide-react';
import ModelCombobox from './ModelCombobox';
import { MARQUE_AUTRE, modeleRequis } from '../lib/catalog';
import { formatTel } from '../lib/contact';
import { normaliser } from '../lib/prestations';

// Icône de chaque panne du kiosque (GET /api/catalog/pannes, services/prestations.py), par libellé
// normalisé ; une panne inconnue garde une tuile sans icône.
const ICONES_PANNES = {
  'ecran casse': Smartphone,
  batterie: BatteryLow,
  'connecteur de charge': Plug,
  'camera avant': SwitchCamera,
  'camera arriere': Camera,
  'bouton volume': Volume2,
  'bouton power': Power,
  'haut parleur je n entends pas les gens ou la musique': Speaker,
  'microphone les gens ne m entendent pas': Mic,
  'vitre arriere': Layers,
  desoxydation: Droplets,
  'probleme logiciel': Cpu,
  diagnostic: Stethoscope,
  'ne s allume plus': PowerOff,
  virus: Bug,
  'reprise telephone': RefreshCw,
  autre: MoreHorizontal,
};

export function iconePanne(label) {
  return ICONES_PANNES[normaliser(label)] || null;
}

/**
 * Briques communes des bornes de dépôt (/client, /depot) et du dépôt à distance (/deposer) :
 * barre d'étapes, en-tête d'étape, tuiles, champs « Vous » (deux numéros), « Votre appareil »
 * (catégorie + marque + modèle sur un seul écran), « Le problème », case « Je patiente en
 * boutique » et récapitulatif modifiable. Chaque page garde son état, sa validation et son envoi.
 */

// Validation, partagée par /client, /depot et /deposer. Numéro : les mêmes caractères que le
// serveur juge plausibles (telephone_contact_canonique : chiffres, espaces, . - ( ) /, « + » en
// tête) et 10 à 15 chiffres — « 06 12 34 56 78 », « +33 6 12… » et « +41 79 123 45 67 » passent,
// « 12 » ou des lettres non.
export const isValidPhone = (tel) => {
  const s = String(tel ?? '').trim();
  const chiffres = s.replace(/\D/g, '');
  return /^\+?[\d\s.\-()/]+$/.test(s) && chiffres.length >= 10 && chiffres.length <= 15;
};
// Numéro de remplissage (« 06 00 00 00 00 », « 06 12 34 56 78 ») : même règle que le serveur
// (clients.telephone_fictif) ; il rattachait le dépôt à une ancienne fiche d'essai « Test Test »
const SUITES_FICTIVES = ['12345678', '23456789', '87654321', '98765432'];
export const MESSAGE_TEL_FICTIF = 'Ce numéro ne semble pas valide : indiquez votre vrai numéro, il sert uniquement à vous prévenir.';
export const estTelephoneFictif = (tel) => {
  const national = String(tel ?? '').replace(/\D/g, '').slice(-9);
  if (national.length < 9) return false;
  return /(\d)\1{5}/.test(national) || SUITES_FICTIVES.includes(national.slice(-8));
};
export const isValidEmail = (email) => !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// Tuile de choix (catégorie, panne, type d'achat) : 56 px, bordure 2 px, sélection = marque
export const tuile = (actif) => `min-h-14 px-4 py-3 rounded-lg border-2 text-base font-semibold text-left leading-snug
  transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2
  ${actif ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'}`;

// En-tête d'étape : pastille marque 40 px + titre + sous-titre (span : `.depot-form p` forcerait 16 px)
export function EnTete({ icone: Icone, titre, sousTitre }) {
  return (
    <div className="flex items-center gap-3 mb-1">
      <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0" aria-hidden="true">
        <Icone className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold leading-snug text-slate-900">{titre}</h2>
        {sousTitre && <span className="block text-sm text-slate-600">{sousTitre}</span>}
      </div>
    </div>
  );
}

/** Barre d'étapes : un segment par étape, l'étape courante et les étapes faites en couleur de marque. */
export function BarreEtapes({ etapes, courante }) {
  return (
    <ol aria-label="Étapes du dépôt" className="grid gap-1.5 mb-6" style={{ gridTemplateColumns: `repeat(${etapes.length}, minmax(0, 1fr))` }}>
      {etapes.map((e, i) => {
        const faite = i < courante;
        const enCours = i === courante;
        return (
          <li key={e.id} aria-current={enCours ? 'step' : undefined} className="min-w-0">
            <div className={`h-2 rounded-full transition-colors duration-300 ${faite || enCours ? 'bg-brand-600' : 'bg-slate-200'}`} />
            <span lang="fr" className={`block text-sm mt-1.5 text-center leading-tight tracking-tight break-words hyphens-auto ${
              enCours ? 'font-semibold text-brand-700' : faite ? 'font-medium text-brand-700' : 'font-medium text-slate-500'
            }`}>
              <span className="sr-only">{faite ? 'Étape faite : ' : enCours ? 'Étape en cours : ' : 'Étape à venir : '}</span>
              {e.court}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// <div> et non <p> : `.depot-form p` écraserait la couleur rouge de l'erreur
export function ErreurChamp({ prefix, errors, field }) {
  return errors?.[field] ? (
    <div id={`${prefix}-${field}-erreur`} role="alert" className="input-error text-sm">{errors[field]}</div>
  ) : null;
}

// En erreur, l'aide reste annoncée après le message d'erreur (aria-describedby = erreur + aide)
export const propsInvalide = (prefix, errors, field, aideId) => {
  if (errors?.[field]) {
    return { 'aria-invalid': 'true', 'aria-describedby': `${prefix}-${field}-erreur${aideId ? ` ${aideId}` : ''}` };
  }
  return aideId ? { 'aria-describedby': aideId } : {};
};

/** Étape « Vous » : identité, les deux numéros, e-mail, société, carte Camby. */
export function ChampsVous({ prefix, form, errors, onChange, camby = true, societe = true, aideEmail }) {
  const inv = (field, aideId) => propsInvalide(prefix, errors, field, aideId);
  const aideContactId = `${prefix}-tel_contact-aide`;
  const aideEmailId = `${prefix}-email-aide`;
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor={`${prefix}-nom`} className="input-label">Nom *</label>
          <input id={`${prefix}-nom`} value={form.nom} onChange={(e) => onChange('nom', e.target.value)}
            autoComplete="family-name" className="input" placeholder="Dupont" {...inv('nom')} />
          <ErreurChamp prefix={prefix} errors={errors} field="nom" />
        </div>
        <div>
          <label htmlFor={`${prefix}-prenom`} className="input-label">Prénom</label>
          <input id={`${prefix}-prenom`} value={form.prenom} onChange={(e) => onChange('prenom', e.target.value)}
            autoComplete="given-name" className="input" placeholder="Jean" />
        </div>
      </div>

      {/* Les deux libellés occupent la même hauteur (2 lignes dès sm) : les saisies restent alignées */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${prefix}-telephone`} className="input-label sm:min-h-[2.75rem] sm:flex sm:items-end">Votre numéro de téléphone (obligatoire)</label>
          <input id={`${prefix}-telephone`} type="tel" inputMode="tel" autoComplete="tel" value={form.telephone}
            onChange={(e) => onChange('telephone', e.target.value)}
            className="input" placeholder="06 XX XX XX XX" {...inv('telephone')} />
          <ErreurChamp prefix={prefix} errors={errors} field="telephone" />
        </div>
        <div>
          <label htmlFor={`${prefix}-tel_contact`} className="input-label sm:min-h-[2.75rem] sm:flex sm:items-end">Numéro pour vous joindre si différent (facultatif)</label>
          <input id={`${prefix}-tel_contact`} type="tel" inputMode="tel" autoComplete="off" value={form.tel_contact}
            onChange={(e) => onChange('tel_contact', e.target.value)}
            className="input" placeholder="Si différent" {...inv('tel_contact', aideContactId)} />
          <ErreurChamp prefix={prefix} errors={errors} field="tel_contact" />
          <span id={aideContactId} className="input-help block text-sm">
            Si votre téléphone reste chez nous, nous vous préviendrons sur ce numéro.
          </span>
        </div>
      </div>

      <div className={`grid gap-4 ${societe ? 'sm:grid-cols-2' : ''}`}>
        <div>
          <label htmlFor={`${prefix}-email`} className="input-label">E-mail</label>
          <input id={`${prefix}-email`} type="email" inputMode="email" autoComplete="email" value={form.email}
            onChange={(e) => onChange('email', e.target.value)}
            className="input" placeholder={aideEmail ? 'pour recevoir les notifications' : 'optionnel'}
            {...inv('email', aideEmail ? aideEmailId : undefined)} />
          <ErreurChamp prefix={prefix} errors={errors} field="email" />
          {aideEmail && <span id={aideEmailId} className="input-help block text-sm">{aideEmail}</span>}
        </div>
        {societe && (
          <div>
            <label htmlFor={`${prefix}-societe`} className="input-label">Société</label>
            <input id={`${prefix}-societe`} value={form.societe} onChange={(e) => onChange('societe', e.target.value)}
              autoComplete="organization" className="input" placeholder="optionnel" />
          </div>
        )}
      </div>

      {camby && (
        <label className="callout bg-brand-50 border-brand-200 text-brand-800 items-center min-h-14 cursor-pointer hover:bg-brand-100/60 transition-colors duration-150">
          <Gift aria-hidden="true" />
          <input type="checkbox" checked={Boolean(form.carte_camby)} onChange={(e) => onChange('carte_camby', e.target.checked)}
            className="checkbox w-6 h-6" />
          <span className="text-base font-medium">Avez-vous la carte Camby ?</span>
        </label>
      )}
    </>
  );
}

/**
 * Étape « Votre appareil » sur un seul écran : tuiles de catégorie (+ tuiles supplémentaires via
 * `enfantsCategories`), puis marque et modèle dès qu'une catégorie est choisie (sauf `sansModele`).
 */
export function ChampsAppareil({
  prefix, form, errors, onChange, categories, catalogue, sansModele = false, enfantsCategories = null, onModeleLibre,
}) {
  const inv = (field) => propsInvalide(prefix, errors, field);
  const legendeId = `${prefix}-categorie-legende`;
  return (
    <>
      <fieldset aria-describedby={errors?.categorie ? `${prefix}-categorie-erreur` : undefined}>
        <legend id={legendeId} className="input-label">Type d'appareil *</legend>
        <div className="grid grid-cols-2 gap-3">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              aria-pressed={form.categorie === cat}
              onClick={() => onChange('categorie', cat)}
              className={tuile(form.categorie === cat)}
            >
              {cat}
            </button>
          ))}
          {enfantsCategories}
        </div>
        <ErreurChamp prefix={prefix} errors={errors} field="categorie" />
      </fieldset>

      {form.categorie && !sansModele && (
        <div className="space-y-5 animate-in">
          <div>
            <label htmlFor={`${prefix}-marque`} className="input-label">Marque *</label>
            <select id={`${prefix}-marque`} value={form.marque} onChange={(e) => onChange('marque', e.target.value)}
              className="select input pr-12" {...inv('marque')}>
              <option value="">{catalogue.loading && !catalogue.marques.length ? 'Chargement…' : 'Sélectionner...'}</option>
              {catalogue.marques.map((m) => <option key={m} value={m}>{m}</option>)}
              <option value={MARQUE_AUTRE}>Autre</option>
            </select>
            <ErreurChamp prefix={prefix} errors={errors} field="marque" />
          </div>

          {form.marque && form.marque !== MARQUE_AUTRE && (
            <ModelCombobox
              id={`${prefix}-modele`}
              label="Modèle"
              required={modeleRequis(form.categorie)}
              marque={form.marque}
              modeles={catalogue.modelesDe(form.marque)}
              loading={catalogue.loading}
              value={form.modele}
              onChange={(texte, meta) => { onChange('modele', texte); onModeleLibre?.(Boolean(meta?.libre)); }}
              error={errors?.modele}
            />
          )}

          {form.marque === MARQUE_AUTRE && (
            <div>
              <label htmlFor={`${prefix}-modele-autre`} className="input-label">Préciser marque / modèle *</label>
              <input id={`${prefix}-modele-autre`} value={form.modele_autre} onChange={(e) => onChange('modele_autre', e.target.value)}
                className="input" placeholder="Ex: Samsung Galaxy S24" autoFocus {...inv('modele_autre')} />
              <ErreurChamp prefix={prefix} errors={errors} field="modele_autre" />
            </div>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Tuiles de panne (icône + libellé du kiosque) : /client, /depot et /deposer.
 * Une colonne sur téléphone (les libellés longs tiendraient sur 5-6 lignes en 2 colonnes à 390 px),
 * deux dès 640 px (tablette du kiosque, écran).
 */
export function TuilesPannes({ pannes, valeur, onChoisir }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {pannes.map((p) => {
        const Icone = iconePanne(p);
        const actif = valeur === p;
        return (
          <button key={p} type="button" aria-pressed={actif} onClick={() => onChoisir(p)}
            className={`${tuile(actif)} flex items-center gap-2.5`}>
            {Icone && <Icone className={`w-5 h-5 shrink-0 ${actif ? 'text-brand-600' : 'text-slate-500'}`} aria-hidden="true" />}
            <span className="min-w-0">{p}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Étape « Le problème » : tuiles de panne, détails, notes. */
export function ChampsPanne({ prefix, form, errors, onChange, pannes }) {
  return (
    <>
      <fieldset aria-describedby={errors?.panne ? `${prefix}-panne-erreur` : undefined}>
        <legend className="input-label">Que se passe-t-il ? *</legend>
        <TuilesPannes pannes={pannes} valeur={form.panne} onChoisir={(p) => onChange('panne', p)} />
        <ErreurChamp prefix={prefix} errors={errors} field="panne" />
      </fieldset>

      <div>
        <label htmlFor={`${prefix}-panne-detail`} className="input-label">Détails supplémentaires</label>
        <textarea
          id={`${prefix}-panne-detail`}
          value={form.panne_detail}
          onChange={(e) => onChange('panne_detail', e.target.value)}
          className="input resize-none"
          rows={3}
          placeholder="Décrivez plus précisément le problème..."
        />
      </div>

      <div>
        <label htmlFor={`${prefix}-notes`} className="input-label">Notes</label>
        <textarea
          id={`${prefix}-notes`}
          value={form.notes_client}
          onChange={(e) => onChange('notes_client', e.target.value)}
          className="input resize-none"
          rows={2}
          placeholder="Informations complémentaires (accessoires, état cosmétique...)"
        />
      </div>
    </>
  );
}

/** « Je patiente en boutique » : priorité atelier aux clients présents. */
export function CaseAttente({ prefix, checked, onChange }) {
  const id = `${prefix}-attente`;
  return (
    <label htmlFor={id} className="flex items-start gap-3 p-4 min-h-14 rounded-lg border-2 border-slate-200 bg-white has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50 cursor-pointer transition-colors duration-150">
      <input id={id} type="checkbox" checked={Boolean(checked)}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={`${id}-aide`}
        className="checkbox w-6 h-6 mt-0.5" />
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Clock className="w-5 h-5 text-brand-600 shrink-0" aria-hidden="true" /> Je patiente en boutique
        </span>
        <span id={`${id}-aide`} className="block text-sm text-slate-600 mt-0.5">
          L'atelier traite en priorité les clients qui attendent sur place.
        </span>
      </span>
    </label>
  );
}

/** Marque + modèle lisibles (« Apple iPhone 13 », ou la saisie libre), '' si rien. */
export function libelleAppareil(form) {
  if (form.marque === MARQUE_AUTRE) return String(form.modele_autre || '').trim();
  return [form.marque, form.modele].map((s) => String(s || '').trim()).filter(Boolean).join(' ');
}

/** Lignes du récapitulatif « Vous » (les champs vides sont omis). */
export function lignesVous(form) {
  return [
    { label: 'Nom', valeur: [form.prenom, form.nom].map((s) => String(s || '').trim()).filter(Boolean).join(' ') },
    { label: 'Téléphone', valeur: formatTel(form.telephone) },
    { label: 'Pour vous joindre', valeur: formatTel(form.tel_contact) },
    { label: 'E-mail', valeur: String(form.email || '').trim() },
    { label: 'Société', valeur: String(form.societe || '').trim() },
    { label: 'Carte Camby', valeur: form.carte_camby ? 'Oui' : '' },
  ];
}

/**
 * Récapitulatif avant envoi : une carte par étape, chacune avec son bouton « Modifier ».
 * sections : [{ id, titre, icone, lignes: [{ label, valeur, masque? }], onModifier }].
 * taille 'borne' (défaut) : « Modifier » fait 44 px quel que soit le pointeur déclaré par l'écran.
 */
export function Recapitulatif({ sections, taille = 'borne' }) {
  const classeModifier = taille === 'borne' ? 'btn-secondary min-h-11 shrink-0' : 'btn-secondary btn-sm shrink-0';
  return (
    <div className="space-y-3">
      {sections.map(({ id, titre, icone: Icone, lignes, onModifier }) => {
        const visibles = lignes.filter((l) => String(l.valeur ?? '').trim());
        return (
          <section key={id} aria-labelledby={`recap-${id}-titre`} className="card-section">
            <div className="flex items-start justify-between gap-3 mb-2">
              <h3 id={`recap-${id}-titre`} className="flex items-start gap-2 text-base font-semibold text-slate-900 min-w-0 min-h-9 pt-1">
                {Icone && <Icone className="w-5 h-5 text-brand-600 shrink-0 mt-0.5" aria-hidden="true" />}
                <span className="leading-snug">{titre}</span>
              </h3>
              <button type="button" onClick={onModifier} aria-label={`Modifier : ${titre}`}
                className={classeModifier}>
                <PencilLine aria-hidden="true" /> Modifier
              </button>
            </div>
            {visibles.length ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-base">
                {visibles.map((l) => (
                  <div key={l.label} className="contents">
                    <dt className="text-slate-600">{l.label}</dt>
                    <dd className={`text-slate-900 font-medium min-w-0 [overflow-wrap:anywhere] whitespace-pre-line ${l.masque ? 'tabular-nums' : ''}`}>{l.valeur}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <span className="block text-base text-slate-600">Rien de renseigné.</span>
            )}
          </section>
        );
      })}
    </div>
  );
}
