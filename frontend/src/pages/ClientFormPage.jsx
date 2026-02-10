import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { ArrowLeft, ArrowRight, Check, Wrench, Smartphone, User, AlertTriangle } from 'lucide-react';

const STEPS = ['Client', 'Appareil', 'Panne', 'Confirmation'];

export default function ClientFormPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [createdCode, setCreatedCode] = useState(null);

  // Données catalogue
  const [categories, setCategories] = useState([]);
  const [marques, setMarques] = useState([]);
  const [modeles, setModeles] = useState([]);
  const [pannes, setPannes] = useState([]);

  // Données formulaire
  const [form, setForm] = useState({
    nom: '', prenom: '', telephone: '', email: '',
    categorie: '', marque: '', modele: '', modele_autre: '',
    panne: '', panne_detail: '', pin: '', pattern: '', notes_client: '',
    imei: '',
  });

  // Charger les catalogues
  useEffect(() => {
    api.getCategories().then(setCategories).catch(() => {});
    api.getPannes().then(setPannes).catch(() => {});
  }, []);

  useEffect(() => {
    if (form.categorie) {
      api.getMarques(form.categorie).then(setMarques).catch(() => setMarques([]));
      setForm(f => ({ ...f, marque: '', modele: '', modele_autre: '' }));
    }
  }, [form.categorie]);

  useEffect(() => {
    if (form.categorie && form.marque) {
      api.getModeles(form.categorie, form.marque).then(setModeles).catch(() => setModeles([]));
      setForm(f => ({ ...f, modele: '', modele_autre: '' }));
    }
  }, [form.marque]);

  const updateForm = (field, value) => setForm(f => ({ ...f, [field]: value }));

  const handleSubmit = async () => {
    setLoading(true);
    try {
      // 1. Créer ou retrouver le client
      const client = await api.createOrGetClient({
        nom: form.nom,
        prenom: form.prenom,
        telephone: form.telephone,
        email: form.email,
      });

      // 2. Créer le ticket
      const result = await api.createTicket({
        client_id: client.id,
        categorie: form.categorie,
        marque: form.marque,
        modele: form.modele,
        modele_autre: form.modele_autre,
        panne: form.panne,
        panne_detail: form.panne_detail,
        pin: form.pin,
        pattern: form.pattern,
        notes_client: form.notes_client,
        imei: form.imei,
      });

      setCreatedCode(result.ticket_code);
      setStep(3); // Confirmation
    } catch (err) {
      alert(err.message || 'Erreur lors de la création');
    } finally {
      setLoading(false);
    }
  };

  // Validation par étape
  const canNext = () => {
    if (step === 0) return form.nom && form.telephone;
    if (step === 1) return form.categorie && form.marque;
    if (step === 2) return form.panne;
    return true;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-brand-50/30">
      <div className="max-w-lg mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => step === 0 ? navigate('/') : setStep(s => s - 1)} className="btn-ghost p-2">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold">Déposer un appareil</h1>
            <p className="text-xs text-gray-400">{STEPS[step]} — Étape {step + 1}/{STEPS.length}</p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="flex gap-1.5 mb-8">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1 rounded-full flex-1 transition-all duration-500 ${
                i <= step ? 'bg-brand-500' : 'bg-gray-200'
              }`}
            />
          ))}
        </div>

        {/* Step 0: Client */}
        {step === 0 && (
          <div className="card p-6 space-y-4 animate-in">
            <div className="w-12 h-12 rounded-xl bg-sky-50 flex items-center justify-center mb-2">
              <User className="w-6 h-6 text-sky-600" />
            </div>
            <h2 className="text-lg font-semibold">Vos coordonnées</h2>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="input-label">Nom *</label>
                <input value={form.nom} onChange={e => updateForm('nom', e.target.value)} className="input" />
              </div>
              <div>
                <label className="input-label">Prénom</label>
                <input value={form.prenom} onChange={e => updateForm('prenom', e.target.value)} className="input" />
              </div>
            </div>
            <div>
              <label className="input-label">Téléphone *</label>
              <input type="tel" value={form.telephone} onChange={e => updateForm('telephone', e.target.value)} className="input" placeholder="06 XX XX XX XX" />
            </div>
            <div>
              <label className="input-label">Email</label>
              <input type="email" value={form.email} onChange={e => updateForm('email', e.target.value)} className="input" placeholder="optionnel" />
            </div>
          </div>
        )}

        {/* Step 1: Appareil */}
        {step === 1 && (
          <div className="card p-6 space-y-4 animate-in">
            <div className="w-12 h-12 rounded-xl bg-brand-50 flex items-center justify-center mb-2">
              <Smartphone className="w-6 h-6 text-brand-600" />
            </div>
            <h2 className="text-lg font-semibold">Votre appareil</h2>

            <div>
              <label className="input-label">Catégorie *</label>
              <div className="grid grid-cols-2 gap-2">
                {categories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => updateForm('categorie', cat)}
                    className={`p-3 rounded-xl text-sm font-medium border transition-all
                      ${form.categorie === cat ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 hover:border-gray-300'}`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {form.categorie && (
              <div>
                <label className="input-label">Marque *</label>
                <select value={form.marque} onChange={e => updateForm('marque', e.target.value)} className="input">
                  <option value="">Sélectionner...</option>
                  {marques.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            )}

            {form.marque && modeles.length > 0 && (
              <div>
                <label className="input-label">Modèle</label>
                <select value={form.modele} onChange={e => updateForm('modele', e.target.value)} className="input">
                  <option value="">Sélectionner...</option>
                  {modeles.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            )}

            {(form.marque === 'Autre' || form.modele === 'Autre') && (
              <div>
                <label className="input-label">Préciser le modèle</label>
                <input value={form.modele_autre} onChange={e => updateForm('modele_autre', e.target.value)} className="input" />
              </div>
            )}

            <div>
              <label className="input-label">IMEI (optionnel)</label>
              <input value={form.imei} onChange={e => updateForm('imei', e.target.value)} className="input font-mono" placeholder="Tapez *#06# sur votre appareil" />
            </div>
          </div>
        )}

        {/* Step 2: Panne */}
        {step === 2 && (
          <div className="card p-6 space-y-4 animate-in">
            <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center mb-2">
              <AlertTriangle className="w-6 h-6 text-amber-600" />
            </div>
            <h2 className="text-lg font-semibold">Décrivez le problème</h2>

            <div>
              <label className="input-label">Type de panne *</label>
              <div className="grid grid-cols-2 gap-2">
                {pannes.map(p => (
                  <button
                    key={p}
                    onClick={() => updateForm('panne', p)}
                    className={`p-2.5 rounded-xl text-xs font-medium border transition-all text-left
                      ${form.panne === p ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 hover:border-gray-300'}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="input-label">Détails supplémentaires</label>
              <textarea
                value={form.panne_detail}
                onChange={e => updateForm('panne_detail', e.target.value)}
                className="input min-h-[80px] resize-none"
                placeholder="Décrivez plus précisément le problème..."
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="input-label">Code PIN / mot de passe</label>
                <input type="password" value={form.pin} onChange={e => updateForm('pin', e.target.value)} className="input" placeholder="Optionnel" />
              </div>
              <div>
                <label className="input-label">Schéma de déverrouillage</label>
                <input value={form.pattern} onChange={e => updateForm('pattern', e.target.value)} className="input" placeholder="Optionnel" />
              </div>
            </div>

            <div>
              <label className="input-label">Notes</label>
              <textarea
                value={form.notes_client}
                onChange={e => updateForm('notes_client', e.target.value)}
                className="input min-h-[60px] resize-none"
                placeholder="Informations complémentaires..."
              />
            </div>
          </div>
        )}

        {/* Step 3: Confirmation */}
        {step === 3 && createdCode && (
          <div className="card p-8 text-center animate-in">
            <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-6">
              <Check className="w-10 h-10 text-emerald-500" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Demande enregistrée !</h2>
            <p className="text-gray-500 mb-6">Votre numéro de ticket :</p>
            <p className="text-4xl font-bold font-mono text-brand-600 mb-6">{createdCode}</p>
            <p className="text-sm text-gray-400 mb-8">
              Conservez ce code pour suivre l'avancement de votre réparation.
            </p>
            <div className="space-y-3">
              <button
                onClick={() => navigate(`/suivi?ticket=${createdCode}`)}
                className="btn-primary w-full"
              >
                Suivre ma réparation
              </button>
              <button onClick={() => navigate('/')} className="btn-secondary w-full">
                Retour à l'accueil
              </button>
            </div>
          </div>
        )}

        {/* Navigation */}
        {step < 3 && (
          <div className="flex justify-between mt-6">
            <button
              onClick={() => step === 0 ? navigate('/') : setStep(s => s - 1)}
              className="btn-secondary"
            >
              <ArrowLeft className="w-4 h-4" /> Retour
            </button>

            {step < 2 ? (
              <button
                onClick={() => setStep(s => s + 1)}
                disabled={!canNext()}
                className="btn-primary"
              >
                Suivant <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={loading || !canNext()}
                className="btn-success"
              >
                {loading ? 'Envoi...' : '✓ Confirmer le dépôt'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
