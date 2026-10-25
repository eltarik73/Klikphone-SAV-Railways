import { enteteJour, formatMinutes, libellePresence, libelleAppareil, heureParis } from '../../lib/activiteEquipe';
import { IconesAppareils, PointPresence } from './Pastilles';

/**
 * Grille de la semaine : une ligne par salarié, une colonne par jour, total à droite.
 * Cellule = bouton (clic, Entrée, Espace) → détail du jour. `mode` : 'complet' | 'compact' | 'liste'.
 */

const nb = (v) => Math.max(0, Number(v) || 0);

export function resumeCellule(nom, jour, j) {
  const e = enteteJour(jour);
  if (!j) return `${nom}, ${e.long} : aucune connexion`;
  const morceaux = [
    `${heureParis(j.arrivee)} – ${j.en_cours ? 'en cours' : heureParis(j.depart)}`,
    formatMinutes(j.duree_min),
    `${nb(j.sessions)} session${nb(j.sessions) > 1 ? 's' : ''}`,
    `${nb(j.actions)} action${nb(j.actions) > 1 ? 's' : ''}`,
  ];
  if (j.tickets_crees !== undefined && j.tickets_crees !== null) {
    morceaux.push(`${nb(j.tickets_crees)} ticket${nb(j.tickets_crees) > 1 ? 's' : ''} créé${nb(j.tickets_crees) > 1 ? 's' : ''}`);
  }
  const pres = j.presence?.statut;
  if (pres) morceaux.push(libellePresence(pres, j.presence?.distance_m));
  if (Array.isArray(j.appareils) && j.appareils.length) morceaux.push(j.appareils.map(libelleAppareil).join(', '));
  return `${nom}, ${e.long} : ${morceaux.join(', ')}`;
}

// Complet : deux lignes (heures ; durée · actions). Compact (colonnes étroites) : arrivée, départ et
// durée sur trois lignes courtes. Présence et appareil empilés à droite.
function ContenuCellule({ j, mode }) {
  const compact = mode === 'compact';
  const depart = j.en_cours ? <span className="text-emerald-700">en cours</span> : heureParis(j.depart);
  return (
    <span className="flex items-center gap-1">
      {compact ? (
        <span className="min-w-0 flex-1 text-xs leading-4 tabular-nums whitespace-nowrap">
          <span className="block font-semibold text-slate-900">{heureParis(j.arrivee)}</span>
          <span className="block font-semibold text-slate-900">{depart}</span>
          <span className="block text-slate-600">{formatMinutes(j.duree_min)}</span>
        </span>
      ) : (
        <span className="min-w-0 flex-1">
          <span className={`block font-semibold tabular-nums text-slate-900 whitespace-nowrap ${j.en_cours ? 'text-xs' : 'text-[13px]'}`}>
            {heureParis(j.arrivee)} – {depart}
          </span>
          <span className="mt-0.5 block text-xs text-slate-600 tabular-nums whitespace-nowrap">
            {formatMinutes(j.duree_min)} <span aria-hidden="true">·</span> {nb(j.actions)} act.
          </span>
        </span>
      )}
      <span className="flex w-3.5 shrink-0 flex-col items-center gap-1.5">
        <PointPresence statut={j.presence?.statut} distance={j.presence?.distance_m} className="w-2.5 h-2.5" />
        <IconesAppareils appareils={j.appareils} />
      </span>
    </span>
  );
}

function BoutonCellule({ nom, jour, j, mode, selection, onChoisir }) {
  const choisi = selection?.utilisateur === nom && selection?.jour === jour;
  if (!j) {
    return (
      <span className="flex items-center justify-center min-h-[48px] text-slate-400" title="Aucune connexion">
        <span aria-hidden="true">—</span>
        <span className="sr-only">Aucune connexion</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      data-cellule={`${nom}|${jour}`}
      onClick={(e) => onChoisir({ utilisateur: nom, jour, resume: j }, e.currentTarget)}
      aria-label={`${resumeCellule(nom, jour, j)}. Afficher le détail`}
      aria-expanded={choisi}
      className={`w-full min-h-[48px] rounded-md ${mode === 'compact' ? 'px-1' : 'px-1.5'} py-1 text-left transition-colors duration-150 motion-reduce:transition-none
        focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500
        ${choisi ? 'bg-brand-50 ring-2 ring-brand-500' : 'hover:bg-slate-100'}`}
    >
      <ContenuCellule j={j} mode={mode} />
    </button>
  );
}

function TotalSemaine({ total }) {
  const t = total || {};
  return (
    <>
      <span className="block text-[13px] font-semibold tabular-nums text-slate-900 whitespace-nowrap">{formatMinutes(t.duree_min)}</span>
      <span className="block text-xs text-slate-600 tabular-nums whitespace-nowrap">
        {nb(t.jours)} j · {nb(t.actions)} act.
      </span>
    </>
  );
}

export function joursAffiches(jours, salaries) {
  const liste = Array.isArray(jours) ? jours : [];
  // Dimanche (7e jour) seulement s'il y a eu une connexion
  return liste.filter((jour, i) => i < 6 || (salaries || []).some((s) => s?.jours?.[jour]));
}

export default function GrilleSemaine({ jours, salaries, aujourdhui, mode, selection, onChoisir, libelle }) {
  const cols = joursAffiches(jours, salaries);
  const liste = Array.isArray(salaries) ? salaries : [];

  if (mode === 'liste') {
    return (
      <ul className="space-y-3" aria-label={`Heures de connexion, ${libelle}`}>
        {liste.map((s) => {
          const travailles = cols.filter((jour) => s.jours?.[jour]);
          return (
            <li key={s.utilisateur} className="card overflow-hidden">
              <div className="flex items-baseline justify-between gap-3 px-4 py-2.5 border-b border-slate-100 bg-slate-50/60">
                <h3 className="font-semibold text-slate-900 truncate">{s.utilisateur}</h3>
                <span className="text-[13px] text-slate-600 tabular-nums whitespace-nowrap">
                  <strong className="text-slate-900">{formatMinutes(s.total?.duree_min)}</strong>
                  {' · '}{nb(s.total?.jours)} j · {nb(s.total?.actions)} act.
                </span>
              </div>
              {travailles.length ? (
                <ul className="divide-y divide-slate-100">
                  {travailles.map((jour) => {
                    const j = s.jours[jour];
                    const e = enteteJour(jour);
                    const choisi = selection?.utilisateur === s.utilisateur && selection?.jour === jour;
                    return (
                      <li key={jour}>
                        <button
                          type="button"
                          data-cellule={`${s.utilisateur}|${jour}`}
                          onClick={(ev) => onChoisir({ utilisateur: s.utilisateur, jour, resume: j }, ev.currentTarget)}
                          aria-label={`${resumeCellule(s.utilisateur, jour, j)}. Afficher le détail`}
                          aria-expanded={choisi}
                          className={`w-full min-h-[48px] flex items-center gap-3 px-4 py-2 text-left text-[13px]
                            focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500
                            ${choisi ? 'bg-brand-50' : jour === aujourdhui ? 'bg-brand-50/40' : 'hover:bg-slate-50'}`}
                        >
                          <span className="w-14 shrink-0 font-medium text-slate-700 capitalize">{e.court} {e.num}</span>
                          <span className="font-semibold tabular-nums text-slate-900 whitespace-nowrap">
                            {heureParis(j.arrivee)} – {j.en_cours ? <span className="text-emerald-700">en cours</span> : heureParis(j.depart)}
                          </span>
                          <span className="ml-auto flex items-center gap-1.5 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                            {formatMinutes(j.duree_min)}
                            <PointPresence statut={j.presence?.statut} distance={j.presence?.distance_m} className="w-2.5 h-2.5" />
                            <IconesAppareils appareils={j.appareils} />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="px-4 py-3 text-[13px] text-slate-500">Aucune connexion cette semaine</p>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="table-wrap">
      <table className="w-full table-fixed text-sm text-slate-700">
        <caption className="sr-only">
          Heures de connexion de l’équipe, {libelle}. Choisissez une journée pour afficher le détail des sessions.
        </caption>
        {/* Colonne des noms fixe (le dimanche prend sa place sur les jours, la page passe en compact
            si la largeur manque : cf. modePour) ; un nom long passe à la ligne au lieu d'être tronqué */}
        <colgroup>
          <col className={mode === 'compact' ? 'w-[96px]' : 'w-[128px]'} />
          {cols.map((jour) => <col key={jour} />)}
          <col className={mode === 'compact' ? 'w-[88px]' : cols.length > 6 ? 'w-[92px]' : 'w-[116px]'} />
        </colgroup>
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/70">
            <th scope="col" className={`table-header ${mode === 'compact' ? 'px-2' : 'px-3'} py-2 text-left`}>Salarié</th>
            {cols.map((jour) => {
              const e = enteteJour(jour);
              const auj = jour === aujourdhui;
              return (
                <th key={jour} scope="col"
                  className={`table-header px-1.5 py-2 text-left ${auj ? 'text-brand-700 bg-brand-50/70' : ''}`}>
                  <abbr title={e.long} className="no-underline">{e.court}</abbr> {e.num}
                  {auj && <span className="sr-only"> (aujourd’hui)</span>}
                </th>
              );
            })}
            <th scope="col" className="table-header px-3 py-2 text-right">Semaine</th>
          </tr>
        </thead>
        <tbody>
          {liste.map((s) => (
            <tr key={s.utilisateur} className="border-b border-slate-100 last:border-0">
              <th scope="row" className={`${mode === 'compact' ? 'px-2' : 'px-3'} py-1 text-left font-semibold text-slate-900`} title={s.utilisateur}>
                <span className="line-clamp-3 break-words leading-5">{s.utilisateur}</span>
              </th>
              {cols.map((jour) => (
                <td key={jour} className={`${mode === 'compact' ? 'p-0.5' : 'p-1'} align-middle ${jour === aujourdhui ? 'bg-brand-50/40' : ''}`}>
                  <BoutonCellule nom={s.utilisateur} jour={jour} j={s.jours?.[jour]} mode={mode}
                    selection={selection} onChoisir={onChoisir} />
                </td>
              ))}
              <td className={`${mode === 'compact' ? 'px-2' : 'px-3'} py-1 text-right align-middle`}><TotalSemaine total={s.total} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
