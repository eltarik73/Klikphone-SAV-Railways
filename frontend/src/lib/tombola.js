import { useEffect, useState } from 'react';
import api from './api';

/**
 * Tombola des clients : formats français (heure de Paris, quel que soit le poste) et lecture de la
 * tombola ouverte pour les formulaires de dépôt et l'affiche.
 */
const ZONE = 'Europe/Paris';
const fmtLong = new Intl.DateTimeFormat('fr-FR', {
  timeZone: ZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});
const fmtSansAnnee = new Intl.DateTimeFormat('fr-FR', { timeZone: ZONE, weekday: 'long', day: 'numeric', month: 'long' });
const fmtCourt = new Intl.DateTimeFormat('fr-FR', { timeZone: ZONE, day: 'numeric', month: 'short', year: 'numeric' });
const fmtParties = new Intl.DateTimeFormat('fr-FR', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function lire(d) {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parties(date) {
  const p = {};
  fmtParties.formatToParts(date).forEach(({ type, value }) => { p[type] = value; });
  return p;
}

// « 1 janvier » → « 1er janvier »
const premier = (texte) => texte.replace(/(^|\s)1 (?=\p{L})/u, '$11er ');

/** « 18 h », « 18 h 30 » */
export function heureFr(d) {
  const date = lire(d);
  if (!date) return '';
  const { hour, minute } = parties(date);
  return `${Number(hour)} h${minute === '00' ? '' : ` ${minute}`}`;
}

/** « samedi 20 décembre 2026 à 18 h » */
export function dateTirage(d) {
  const date = lire(d);
  return date ? `${premier(fmtLong.format(date))} à ${heureFr(date)}` : '';
}

/** « samedi 20 décembre » (affiche : l'année va de soi) */
export function jourTirage(d) {
  const date = lire(d);
  return date ? premier(fmtSansAnnee.format(date)) : '';
}

/** « 20 déc. 2026 à 18 h » */
export function dateCourte(d) {
  const date = lire(d);
  return date ? `${premier(fmtCourt.format(date))} à ${heureFr(date)}` : '';
}

/** Valeurs des champs date et heure du formulaire, à l'heure de Paris : { jour: '2026-12-20', heure: '18:00' } */
export function pourSaisie(d) {
  const date = lire(d);
  if (!date) return { jour: '', heure: '' };
  const p = parties(date);
  return { jour: `${p.year}-${p.month}-${p.day}`, heure: `${p.hour}:${p.minute}` };
}

/** « dans 12 jours », « demain », « aujourd'hui », « dans 3 h », « dans quelques minutes », '' si passé */
export function dansCombien(d, maintenant = new Date()) {
  const date = lire(d);
  if (!date) return '';
  const ms = date.getTime() - maintenant.getTime();
  if (ms <= 0) return '';
  const jourDe = (x) => { const p = parties(x); return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)); };
  const jours = Math.round((jourDe(date) - jourDe(maintenant)) / 86400000);
  if (jours > 1) return `dans ${jours} jours`;
  if (jours === 1) return 'demain';
  const heures = Math.floor(ms / 3600000);
  if (heures >= 1) return `aujourd'hui, dans ${heures} h`;
  return 'dans quelques minutes';
}

/** « iPhone 13 reconditionné », « iPhone 13 reconditionné et 2 autres lots » */
export function resumeLots(lots) {
  const liste = (Array.isArray(lots) ? lots : []).filter(Boolean);
  if (!liste.length) return '';
  if (liste.length === 1) return liste[0];
  const autres = liste.length - 1;
  return `${liste[0]} et ${autres} autre${autres > 1 ? 's' : ''} lot${autres > 1 ? 's' : ''}`;
}

/** « 1er lot », « 2e lot » */
export const rangLot = (rang) => `${rang}${rang === 1 ? 'er' : 'e'} lot`;

/** Paragraphes du règlement (séparés par une ligne vide) */
export function paragraphes(texte) {
  return String(texte || '').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
}

// Tombola ouverte : une lecture par minute au plus (une borne reste ouverte des jours, la tombola
// peut être créée ou tirée entre deux dépôts)
const FRAICHEUR_MS = 60_000;
let memo = { at: 0, promesse: null };

export function lireTombolaEnCours(maintenant = Date.now()) {
  if (!memo.promesse || maintenant - memo.at > FRAICHEUR_MS) {
    const promesse = Promise.resolve()
      .then(() => api.getTombolaEnCours())
      .then((r) => r?.tombola || null)
      .catch(() => {
        if (memo.promesse === promesse) memo = { at: 0, promesse: null };
        return null;
      });
    memo = { at: maintenant, promesse };
  }
  return memo.promesse;
}
export function _oublierTombola() { memo = { at: 0, promesse: null }; }

/** La tombola ouverte aux inscriptions, ou null (aucune, ou pas encore lue). */
export function useTombolaEnCours() {
  const [tombola, setTombola] = useState(null);
  useEffect(() => {
    let actif = true;
    lireTombolaEnCours().then((t) => { if (actif) setTombola(t); });
    return () => { actif = false; };
  }, []);
  return tombola;
}
