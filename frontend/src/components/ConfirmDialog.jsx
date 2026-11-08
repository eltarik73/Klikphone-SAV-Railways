import { useCallback, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';

/**
 * Modale de confirmation du système (remplace les confirm() / prompt() natifs).
 *
 * - Le titre nomme l'objet (« Supprimer le client Marie Durand ? »), une phrase dit la conséquence,
 *   le bouton d'action dit le résultat (« Supprimer le client ») : jamais « Êtes-vous sûr ? ».
 * - « Annuler » (ghost) à gauche reçoit le focus à l'ouverture ; l'action (danger si destructive,
 *   primaire sinon) à droite. Échap et le clic sur le voile annulent ; le focus revient au déclencheur.
 * - `loading` : boutons désactivés, spinner dans l'action, piège de focus suspendu (une demande de code
 *   administrateur peut s'ouvrir par-dessus et garder le focus).
 * - `input` : variante « prompt » — champ libellé { label, placeholder, defaultValue, type, help,
 *   options: [{ value, label }] (liste déroulante), required = true } ; `onConfirm(valeur)`.
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  destructive = false,
  onConfirm,
  onCancel,
  loading = false,
  input = null,
}) {
  const boxRef = useRef(null);
  const uid = useId();
  const titreId = `${uid}-titre`;
  const texteId = `${uid}-texte`;
  const champId = `${uid}-champ`;
  const [valeur, setValeur] = useState(() => input?.defaultValue ?? '');

  const annuler = useCallback(() => { if (!loading) onCancel?.(); }, [loading, onCancel]);
  useFocusTrap(boxRef, Boolean(open) && !loading, {
    initialFocus: input ? '[data-confirm-input]' : '[data-confirm-cancel]',
    onEscape: annuler,
  });

  if (!open || typeof document === 'undefined') return null;

  const requis = input ? input.required !== false : false;
  const valeurPropre = typeof valeur === 'string' ? valeur.trim() : valeur;
  const bloque = loading || (requis && !valeurPropre);
  const confirmer = (e) => {
    e?.preventDefault?.();
    if (bloque) return;
    onConfirm?.(input ? valeurPropre : undefined);
  };

  return createPortal(
    <div className="modal-overlay" onMouseDown={annuler}>
      <form
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titreId}
        aria-describedby={description ? texteId : undefined}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={confirmer}
        className="modal sm:max-w-md"
      >
        <div className="px-5 pt-5 pb-4">
          <h2 id={titreId} className="t-h2">{title}</h2>
          {description && <p id={texteId} className="t-body mt-2">{description}</p>}
          {input && (
            <div className="input-group mt-4">
              <label htmlFor={champId} className="input-label">{input.label}</label>
              {Array.isArray(input.options) ? (
                <select id={champId} data-confirm-input value={valeur} onChange={(e) => setValeur(e.target.value)} disabled={loading} className="select">
                  {!input.defaultValue && <option value="">{input.placeholder || 'Choisir…'}</option>}
                  {input.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input id={champId} data-confirm-input type={input.type || 'text'} value={valeur} onChange={(e) => setValeur(e.target.value)}
                  placeholder={input.placeholder} disabled={loading} autoComplete="off" className="input" />
              )}
              {input.help && <p className="input-help">{input.help}</p>}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" data-confirm-cancel onClick={annuler} disabled={loading} className="btn-ghost">
            {cancelLabel}
          </button>
          <button type="submit" disabled={bloque} aria-busy={loading || undefined}
            className={destructive ? 'btn-danger' : 'btn-primary'}>
            {loading && <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />}
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

/** Variante « prompt » : même modale avec un champ libellé ; `onConfirm(valeur)`. */
export function PromptDialog({ input, ...props }) {
  return <ConfirmDialog {...props} input={input || { label: 'Valeur' }} />;
}

/**
 * Une confirmation par page sans boilerplate :
 *   const confirmation = useConfirmDialog();
 *   confirmation.demander({ title, description, confirmLabel, destructive, input, onConfirm: async (valeur) => {…} });
 *   … {confirmation.dialog}
 * L'action attend la fin de `onConfirm` (spinner), puis la modale se ferme ; les erreurs restent à l'action
 * (toast). `ouvert` permet de suspendre un autre piège de focus pendant la confirmation.
 */
export function useConfirmDialog() {
  const [etat, setEtat] = useState(null);
  const [loading, setLoading] = useState(false);
  const demander = useCallback((options) => { setLoading(false); setEtat(options); }, []);
  const fermer = useCallback(() => { setEtat(null); setLoading(false); }, []);
  const confirmer = useCallback(async (valeur) => {
    if (!etat) return;
    setLoading(true);
    try {
      await etat.onConfirm?.(valeur);
    } finally {
      setEtat(null);
      setLoading(false);
    }
  }, [etat]);
  const { onConfirm: _action, ...propsDialog } = etat || {};
  const dialog = (
    <ConfirmDialog key={etat ? 'ouvert' : 'ferme'} open={Boolean(etat)} {...propsDialog} loading={loading}
      onConfirm={confirmer} onCancel={fermer} />
  );
  return { demander, fermer, dialog, ouvert: Boolean(etat) };
}
