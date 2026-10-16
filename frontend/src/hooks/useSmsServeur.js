import { useEffect, useState } from 'react';
import api from '../lib/api';

// Envoi des SMS par le serveur (Brevo) disponible ? (état mis en cache 60 s par l'ApiClient).
// Tant que l'état n'est pas connu, ou s'il est illisible, le bouton SMS garde le lien sms:.
export function useSmsServeur() {
  const [etat, setEtat] = useState(null);
  useEffect(() => {
    let vivant = true;
    // Erreur synchrone comprise (client d'API simulé dans les tests) : repli sur le lien sms:
    Promise.resolve()
      .then(() => api.getSmsEtat())
      .then((e) => { if (vivant) setEtat(e || null); })
      .catch(() => { if (vivant) setEtat(null); });
    return () => { vivant = false; };
  }, []);
  return { actif: Boolean(etat?.disponible), etat };
}
