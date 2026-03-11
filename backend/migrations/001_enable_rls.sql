-- ============================================
-- KLIKPHONE SAV - Activation RLS sur toutes les tables
-- ============================================
-- Date: 2026-03-11
-- Description: Active Row Level Security sur toutes les tables publiques.
--              Le service_role bypass automatiquement le RLS,
--              donc le backend FastAPI continue de fonctionner normalement.
--              L'API publique (clé anon) sera verrouillée.
-- ============================================

-- 1. Activer RLS sur toutes les tables
ALTER TABLE public.params ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_marques ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_modeles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commandes_pieces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membres_equipe ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tarifs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.autocompletion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tarifs_apple_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devis_lignes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telephones_vente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fidelite_historique ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.avis_google ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts_marketing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendrier_marketing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historique ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates_marketing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telephones_catalogue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 2. Policies de lecture publique (anon)
--    Décommenter selon les besoins.
-- ============================================

-- Grille tarifaire lisible par tous
-- CREATE POLICY "tarifs_read_anon" ON public.tarifs
--   FOR SELECT USING (true);

-- Catalogue marques lisible par tous
-- CREATE POLICY "catalog_marques_read_anon" ON public.catalog_marques
--   FOR SELECT USING (true);

-- Catalogue modèles lisible par tous
-- CREATE POLICY "catalog_modeles_read_anon" ON public.catalog_modeles
--   FOR SELECT USING (true);

-- Tarifs Apple lisible par tous
-- CREATE POLICY "tarifs_apple_read_anon" ON public.tarifs_apple_devices
--   FOR SELECT USING (true);

-- Suivi ticket par le client (lecture seule)
-- CREATE POLICY "tickets_read_by_tracking" ON public.tickets
--   FOR SELECT USING (true);

-- ============================================
-- 3. Vérification après exécution
-- ============================================
-- SELECT schemaname, tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- ORDER BY tablename;
--
-- Toutes les tables doivent avoir rowsecurity = true
-- ============================================
