import { NOTE_INFORMATION, noteStructuree } from '../lib/activiteEquipe';

/**
 * Note d'information des salariés (journal des connexions, pointage de présence), affichée dans
 * les réglages de la page admin « Activité de l'équipe » et imprimée pour être remise en main propre.
 * `note` : version structurée du serveur ({ titre, sections, remise }) ; à défaut `texte` (texte brut,
 * paragraphes séparés par une ligne vide) ; sinon la note par défaut de lib/activiteEquipe.js.
 */
export default function NoteInformation({ note: noteServeur, texte, titre = true, className = '' }) {
  const structuree = noteStructuree(noteServeur);
  if (!structuree && typeof texte === 'string' && texte.trim()) {
    return (
      <div className={`text-sm text-slate-700 leading-relaxed whitespace-pre-line ${className}`}>
        {texte.trim()}
      </div>
    );
  }
  const note = structuree || NOTE_INFORMATION;
  return (
    <div className={`text-sm text-slate-700 leading-relaxed space-y-3 ${className}`}>
      {titre && <p className="font-semibold text-slate-900">{note.titre}</p>}
      {note.sections.map((s) => (
        <section key={s.titre}>
          <h4 className="text-sm font-semibold text-slate-900">{s.titre}</h4>
          {s.texte && <p className="mt-0.5">{s.texte}</p>}
          {Array.isArray(s.liste) && s.liste.length > 0 && (
            <ul className="mt-1 list-disc pl-5 space-y-0.5">
              {s.liste.map((l) => <li key={l}>{l}</li>)}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
