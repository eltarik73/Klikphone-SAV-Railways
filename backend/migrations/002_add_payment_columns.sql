-- Add missing payment columns to tickets table
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS reste_a_payer DECIMAL;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS statut_paiement TEXT DEFAULT 'Non payé';
