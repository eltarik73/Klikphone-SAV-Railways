/**
 * Tests du catalogue marques / modèles (fonctions pures de lib/catalog).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, useState } from 'react';
import { render, screen, fireEvent, renderHook, waitFor, cleanup } from '@testing-library/react';
import ModelCombobox from '../components/ModelCombobox';
import { useCatalog } from '../hooks/useCatalog';
import api from '../lib/api';
import {
  normKey, searchModeles, groupByAnnee, estDansCatalogue, trouverExact,
  champsModele, modeleManquant, modeleRequis,
  parseModelesEnMasse, sansPrefixeMarque,
} from '../lib/catalog';

const APPLE = [
  { m: 'iPhone 17 Pro Max', a: 2025 },
  { m: 'iPhone 17 Pro', a: 2025 },
  { m: 'iPhone 17', a: 2025 },
  { m: 'iPhone 16 Pro Max', a: 2024 },
  { m: 'iPhone 16 Pro', a: 2024 },
  { m: 'iPhone 16', a: 2024 },
  { m: 'iPhone 15 Pro Max', a: 2023 },
  { m: 'iPhone 15 Pro', a: 2023 },
  { m: 'iPhone 15 Plus', a: 2023 },
  { m: 'iPhone 15', a: 2023 },
  { m: 'iPhone 14 Pro', a: 2022 },
  { m: 'iPhone SE (2022)', a: 2022 },
];

const SAMSUNG = [
  { m: 'Galaxy S24 Ultra', a: 2024 },
  { m: 'Galaxy S24+', a: 2024 },
  { m: 'Galaxy S24', a: 2024 },
  { m: 'Galaxy S24 FE', a: 2024 },
  { m: 'Galaxy A55', a: 2024 },
  { m: 'Galaxy S23 Ultra', a: 2023 },
  { m: 'Galaxy S23', a: 2023 },
];

const XIAOMI = [
  { m: 'Redmi Note 13 Pro+', a: 2024 },
  { m: 'Redmi Note 13 Pro', a: 2024 },
  { m: 'Redmi Note 13', a: 2024 },
  { m: 'Redmi 13C', a: 2023 },
];

const GOOGLE = [
  { m: 'Pixel 9 Pro', a: 2024 },
  { m: 'Pixel 8a', a: 2024 },
  { m: 'Pixel 8 Pro', a: 2023 },
  { m: 'Pixel 8', a: 2023 },
];

const noms = (list) => list.map((x) => x.m);

describe('normKey', () => {
  it('retire les accents et passe en minuscules', () => {
    expect(normKey('Écran Cassé')).toBe('ecran casse');
    expect(normKey('HUAWEI Mate')).toBe('huawei mate');
  });

  it('remplace « + » par « plus »', () => {
    expect(normKey('Galaxy S24+')).toBe('galaxy s24 plus');
    expect(normKey('Redmi Note 13 Pro+')).toBe('redmi note 13 pro plus');
  });

  it('remplace la ponctuation par des espaces et les fusionne', () => {
    expect(normKey('  iPhone SE (2022) ')).toBe('iphone se 2022');
    expect(normKey('Moto G-84 / 5G')).toBe('moto g 84 5g');
  });

  it('tolère null / undefined / nombres', () => {
    expect(normKey(null)).toBe('');
    expect(normKey(undefined)).toBe('');
    expect(normKey(2024)).toBe('2024');
  });
});

describe('searchModeles', () => {
  it('requête vide → liste dans l\'ordre d\'origine', () => {
    expect(searchModeles(APPLE, 'Apple', '')).toEqual(APPLE);
    expect(searchModeles(APPLE, 'Apple', '   ')).toEqual(APPLE);
    expect(searchModeles(APPLE, 'Apple', '', 3)).toEqual(APPLE.slice(0, 3));
  });

  it('« ip 15 pro » → iPhone 15 Pro puis iPhone 15 Pro Max', () => {
    expect(noms(searchModeles(APPLE, 'Apple', 'ip 15 pro'))).toEqual(['iPhone 15 Pro', 'iPhone 15 Pro Max']);
  });

  it('« s24u » → Galaxy S24 Ultra (requête compacte)', () => {
    expect(noms(searchModeles(SAMSUNG, 'Samsung', 's24u'))).toEqual(['Galaxy S24 Ultra']);
  });

  it('« redmi note 13 pro+ » → Redmi Note 13 Pro+ uniquement', () => {
    expect(noms(searchModeles(XIAOMI, 'Xiaomi', 'redmi note 13 pro+'))).toEqual(['Redmi Note 13 Pro+']);
  });

  it('« pixel 8a » → Pixel 8a uniquement', () => {
    expect(noms(searchModeles(GOOGLE, 'Google', 'pixel 8a'))).toEqual(['Pixel 8a']);
  });

  it('égalité exacte avant préfixe', () => {
    expect(noms(searchModeles(APPLE, 'Apple', 'iphone 15'))).toEqual([
      'iPhone 15', 'iPhone 15 Pro', 'iPhone 15 Plus', 'iPhone 15 Pro Max',
    ]);
  });

  it('préfixe avant « contient », puis le plus court, puis la récence', () => {
    // « galaxy s2 » est un préfixe de tous les S2x ; à longueur égale, l'ordre d'origine (récence) départage
    expect(noms(searchModeles(SAMSUNG, 'Samsung', 'galaxy s2'))).toEqual([
      'Galaxy S24', 'Galaxy S23', 'Galaxy S24 FE', 'Galaxy S24+', 'Galaxy S24 Ultra', 'Galaxy S23 Ultra',
    ]);
    // « 15 pro » n'est pas un début de libellé : « contient », le plus court d'abord
    expect(noms(searchModeles(APPLE, 'Apple', '15 pro'))).toEqual(['iPhone 15 Pro', 'iPhone 15 Pro Max']);
  });

  it('la marque fait partie de la recherche', () => {
    expect(noms(searchModeles(APPLE, 'Apple', 'apple 16 pro'))).toEqual(['iPhone 16 Pro', 'iPhone 16 Pro Max']);
    expect(noms(searchModeles(SAMSUNG, 'Samsung', 'samsung a55'))).toEqual(['Galaxy A55']);
  });

  it('insensible à la casse et aux accents', () => {
    expect(noms(searchModeles(APPLE, 'Apple', 'IPHONE SE'))).toEqual(['iPhone SE (2022)']);
  });

  it('aucune correspondance → liste vide', () => {
    expect(searchModeles(APPLE, 'Apple', 'galaxy')).toEqual([]);
  });

  it('respecte la limite', () => {
    expect(searchModeles(APPLE, 'Apple', 'iphone', 2)).toHaveLength(2);
  });

  it('accepte des chaînes simples (mode repli)', () => {
    expect(searchModeles(['Galaxy S24', 'Galaxy A55'], 'Samsung', 'a55')).toEqual(['Galaxy A55']);
  });
});

describe('trouverExact', () => {
  it('même règle que le rang 0 de la recherche (compact, avec ou sans marque)', () => {
    expect(trouverExact(APPLE, 'Apple', 'iphone15')?.m).toBe('iPhone 15');
    expect(trouverExact(APPLE, 'Apple', ' Apple iPhone 15 Pro ')?.m).toBe('iPhone 15 Pro');
    expect(trouverExact(SAMSUNG, 'Samsung', 'galaxys24+')?.m).toBe('Galaxy S24+');
    expect(trouverExact(SAMSUNG, 'Samsung', 'samsunggalaxys24')?.m).toBe('Galaxy S24');
    expect(trouverExact(APPLE, 'Apple', '15 pro')).toBeNull();
    expect(trouverExact(APPLE, 'Apple', '')).toBeNull();
  });
});

describe('groupByAnnee', () => {
  it('regroupe en conservant l\'ordre, sans année en dernier', () => {
    const groups = groupByAnnee([{ m: 'X', a: null }, { m: 'B', a: 2024 }, { m: 'C', a: 2024 }, { m: 'D', a: 2023 }]);
    expect(groups.map((g) => g.annee)).toEqual([2024, 2023, null]);
    expect(noms(groups[0].items)).toEqual(['B', 'C']);
  });
});

describe('règles de saisie', () => {
  it('estDansCatalogue compare sur la clé normalisée', () => {
    expect(estDansCatalogue(APPLE, 'iphone 17 pro')).toBe(true);
    expect(estDansCatalogue(APPLE, 'iPhone 13')).toBe(false);
    expect(estDansCatalogue(APPLE, '')).toBe(false);
  });

  it('champsModele : marque connue → modele, marque Autre → modele_autre', () => {
    expect(champsModele('Apple', ' iPhone 15 ', 'ignoré')).toEqual({ modele: 'iPhone 15', modele_autre: '' });
    expect(champsModele('Autre', 'ignoré', ' Nokia 3310 ')).toEqual({ modele: '', modele_autre: 'Nokia 3310' });
  });

  it('modeleManquant : obligatoire sauf Commande / Autre / Achat', () => {
    expect(modeleManquant({ categorie: 'Smartphone', marque: 'Apple', modele: '', modele_autre: '' })).toBe(true);
    expect(modeleManquant({ categorie: 'Smartphone', marque: 'Apple', modele: '  ', modele_autre: '' })).toBe(true);
    expect(modeleManquant({ categorie: 'Smartphone', marque: 'Apple', modele: 'iPhone 15', modele_autre: '' })).toBe(false);
    expect(modeleManquant({ categorie: 'Commande', marque: 'Apple', modele: '', modele_autre: '' })).toBe(false);
    expect(modeleManquant({ categorie: 'Autre', marque: 'Sony', modele: '', modele_autre: '' })).toBe(false);
    expect(modeleManquant({ categorie: 'Autre', marque: 'Autre', modele: '', modele_autre: '' })).toBe(true);
    expect(modeleManquant({ categorie: 'Smartphone', marque: 'Autre', modele: '', modele_autre: 'Nokia' })).toBe(false);
    expect(modeleRequis('Achat')).toBe(false);
    expect(modeleRequis('Tablette')).toBe(true);
  });

  it('parseModelesEnMasse nettoie la saisie', () => {
    const texte = 'Galaxy S25\n\n  galaxy   s25 \nSamsung Galaxy S25+\nAutre\n' + 'x'.repeat(81);
    expect(parseModelesEnMasse(texte, 'Samsung')).toEqual({
      modeles: ['Galaxy S25', 'Galaxy S25+'],
      tropLongs: ['x'.repeat(81)],
    });
  });

  it('sansPrefixeMarque retire la marque en tête uniquement', () => {
    expect(sansPrefixeMarque('Apple', 'Apple iPhone 15')).toBe('iPhone 15');
    expect(sansPrefixeMarque('Apple', 'iPhone 15')).toBe('iPhone 15');
    expect(sansPrefixeMarque('Honor', 'Honorable 1')).toBe('Honorable 1');
  });
});

describe('ModelCombobox', () => {
  afterEach(() => cleanup());

  const renderBox = (props = {}) => {
    const onChange = vi.fn();
    render(createElement(ModelCombobox, {
      id: 'm', label: 'Modèle', marque: 'Apple', modeles: APPLE, value: '', onChange, ...props,
    }));
    return onChange;
  };

  it('filtre localement et valide le 1er résultat avec Entrée', () => {
    const onChange = renderBox();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'ip 15 pro' } });
    expect(input).toHaveAttribute('aria-expanded', 'true');
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'iPhone 15 Pro2023', 'iPhone 15 Pro Max2023', "Mon modèle n'est pas dans la liste",
    ]);
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', options[1].id);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('iPhone 15 Pro Max', { libre: false });
  });

  it('« pas dans la liste » bascule en saisie libre préremplie', () => {
    const onChange = renderBox();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'iPhone 13 mini' } });
    fireEvent.click(screen.getByText("Mon modèle n'est pas dans la liste"));
    expect(onChange).toHaveBeenLastCalledWith('iPhone 13 mini', { libre: true });
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('button', { name: /choisir dans la liste/i })).toBeInTheDocument();
  });

  it('valeur hors catalogue → saisie libre d\'office', () => {
    renderBox({ value: 'iPhone 13 mini' });
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByLabelText(/Modèle/)).toHaveValue('iPhone 13 mini');
  });

  it('sans modèles → simple champ texte obligatoire', () => {
    const onChange = renderBox({ modeles: [], required: true });
    const input = screen.getByLabelText(/Modèle/);
    expect(input).toBeRequired();
    fireEvent.change(input, { target: { value: 'Nokia 3310' } });
    expect(onChange).toHaveBeenLastCalledWith('Nokia 3310', { libre: true });
  });

  it('requête vide → groupes par année', () => {
    renderBox();
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getAllByRole('group').map((g) => document.getElementById(g.getAttribute('aria-labelledby')).textContent))
      .toEqual(['2025', '2024', '2023', '2022']);
  });

  // Composant contrôlé, comme dans les pages
  const renderControlled = (props = {}) => {
    const onChange = vi.fn();
    function Harness() {
      const [value, setValue] = useState(props.value ?? '');
      return createElement(ModelCombobox, {
        id: 'm', label: 'Modèle', marque: 'Apple', modeles: APPLE, ...props, value,
        onChange: (texte, meta) => { onChange(texte, meta); setValue(texte); },
      });
    }
    render(createElement('div', null, createElement(Harness), createElement('button', { type: 'button' }, 'Ailleurs')));
    return onChange;
  };

  it('saisie libre figée : le champ reste le même élément quand le texte devient un modèle du catalogue', () => {
    renderControlled({ value: 'iPhone 15 128Go' });
    const input = screen.getByLabelText(/Modèle/);
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByLabelText(/Modèle/)).toBe(input);
    fireEvent.change(input, { target: { value: 'iPhone 15' } });
    expect(screen.getByLabelText(/Modèle/)).toBe(input);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(input).toHaveValue('iPhone 15');
  });

  it('fermeture : une saisie compacte (« iphone15 ») est validée d\'office', () => {
    const onChange = renderControlled();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'iphone15' } });
    fireEvent.pointerDown(screen.getByText('Ailleurs'));
    expect(onChange).toHaveBeenLastCalledWith('iPhone 15', { libre: false });
    expect(screen.getByRole('combobox')).toHaveValue('iPhone 15');
  });

  it('sans commitOnClose : une recherche non choisie reste en attente', () => {
    const onChange = renderControlled({ value: 'iPhone 15' });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '15 pro' } });
    fireEvent.pointerDown(screen.getByText('Ailleurs'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/Sélectionnez votre modèle/)).toBeInTheDocument();
  });

  it('commitOnClose : une recherche non choisie est gardée en saisie libre', () => {
    const onChange = renderControlled({ value: 'iPhone 15', commitOnClose: true });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '15 pro ' } });
    fireEvent.pointerDown(screen.getByText('Ailleurs'));
    expect(onChange).toHaveBeenLastCalledWith('15 pro', { libre: true });
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByLabelText(/Modèle/)).toHaveValue('15 pro');
  });

  describe('hauteur de la liste', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    afterEach(() => {
      if (original) Object.defineProperty(window, 'visualViewport', original);
      else delete window.visualViewport;
      delete Element.prototype.scrollIntoView;
      vi.restoreAllMocks();
    });

    it('clavier ouvert : remonte le champ puis borne la liste à la zone visible', async () => {
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: { height: 300, offsetTop: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      });
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;
      renderBox();
      const input = screen.getByRole('combobox');
      vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({ top: 150, bottom: 200, left: 0, right: 0, width: 0, height: 50 });
      fireEvent.focus(input);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
      const listbox = screen.getByRole('listbox');
      // 300 - 200 - 12 = 88 (plancher : un résultat + « pas dans la liste »)
      await waitFor(() => expect(listbox.style.getPropertyValue('--kp-list-max')).toBe('88px'));
    });
  });
});

describe('useCatalog', () => {
  afterEach(() => vi.restoreAllMocks());

  it('utilise /tree (ordre du backend, sans « Autre »)', async () => {
    vi.spyOn(api, 'getCatalogTree').mockResolvedValue({
      version: 'v1',
      marques: [
        { marque: 'Apple', modeles: [{ m: 'iPhone 17', a: 2025 }] },
        { marque: 'Autre', modeles: [] },
        { marque: 'Google', modeles: [] },
      ],
    });
    const { result } = renderHook(() => useCatalog('Smartphone'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.marques).toEqual(['Apple', 'Google']);
    expect(result.current.modelesDe('Apple')).toEqual([{ m: 'iPhone 17', a: 2025 }]);
    expect(result.current.modelesDe('Google')).toEqual([]);
    expect(result.current.version).toBe('v1');
  });

  it('se replie sur /marques et /modeles si /tree échoue', async () => {
    vi.spyOn(api, 'getCatalogTree').mockRejectedValue(new Error('404'));
    vi.spyOn(api, 'getMarques').mockResolvedValue(['Apple', 'Autre', 'Samsung']);
    const getModeles = vi.spyOn(api, 'getModeles').mockResolvedValue(['iPhone 15', 'Autre']);
    const { result } = renderHook(() => useCatalog('Smartphone', 'Apple'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.marques).toEqual(['Apple', 'Samsung']);
    expect(getModeles).toHaveBeenCalledWith('Smartphone', 'Apple');
    expect(result.current.modelesDe('Apple')).toEqual([{ m: 'iPhone 15', a: null }]);
  });

  it('modelesDe ignore la casse de la marque (saisie libre en back-office)', async () => {
    vi.spyOn(api, 'getCatalogTree').mockResolvedValue({
      version: 'v1',
      marques: [{ marque: 'Apple', modeles: [{ m: 'iPhone 17', a: 2025 }] }],
    });
    const { result } = renderHook(() => useCatalog('Smartphone'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.modelesDe('apple')).toEqual([{ m: 'iPhone 17', a: 2025 }]);
    expect(result.current.modelesDe(' APPLE ')).toEqual([{ m: 'iPhone 17', a: 2025 }]);
    expect(result.current.modelesDe('autre')).toEqual([]);
  });

  it('catégorie nulle → rien n\'est chargé', () => {
    const spy = vi.spyOn(api, 'getCatalogTree');
    const { result } = renderHook(() => useCatalog(null));
    expect(result.current.loading).toBe(false);
    expect(result.current.marques).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('api catalogue', () => {
  afterEach(() => vi.restoreAllMocks());

  it('une mutation purge le cache de /api/catalog/tree', async () => {
    api._cache.set('/api/catalog/tree?categorie=Smartphone', { ts: Date.now(), data: { marques: [] } });
    vi.spyOn(api, 'request').mockResolvedValue({ ok: true, ajoutes: 1, reactives: 0 });
    await api.bulkAddModeles({ categorie: 'Smartphone', marque: 'Apple', annee: 2025, modeles: ['iPhone 17e'] });
    expect(api._cache.has('/api/catalog/tree?categorie=Smartphone')).toBe(false);
    expect(api.request).toHaveBeenCalledWith('/api/catalog/modeles/bulk', expect.objectContaining({ method: 'POST' }));
  });

  it('après une mutation, l\'arbre est relu une fois en contournant le cache HTTP', async () => {
    const path = '/api/catalog/tree?categorie=Tablette';
    const request = vi.spyOn(api, 'request').mockResolvedValue({ version: 'v', marques: [] });
    await api.addMarque('Tablette', 'Honor');
    await api.getCatalogTree('Tablette');
    expect(request).toHaveBeenLastCalledWith(path, { cache: 'no-cache' });
    request.mockClear();
    await api.getCatalogTree('Tablette');
    expect(request).not.toHaveBeenCalled();
    // Cache mémoire expiré, sans nouvelle mutation : lecture normale
    api._cache.delete(path);
    await api.getCatalogTree('Tablette');
    expect(request).toHaveBeenLastCalledWith(path, {});
    await api.getCatalogTree('Tablette', { fresh: true });
    expect(request).toHaveBeenLastCalledWith(path, { cache: 'no-cache' });
  });

  it('un arbre relu pendant une mutation n\'est pas remis en cache', async () => {
    const path = '/api/catalog/tree?categorie=Console';
    let resoudre;
    vi.spyOn(api, 'request').mockImplementation((p) => (p === path
      ? new Promise((r) => { resoudre = r; })
      : Promise.resolve({ ok: true })));
    const lecture = api.getCatalogTree('Console');
    await api.deleteMarque('Console', 'Sony');
    resoudre({ version: 'ancien', marques: [] });
    await lecture;
    expect(api._cache.has(path)).toBe(false);
  });

  it('deux lectures simultanées partagent la même requête', async () => {
    const request = vi.spyOn(api, 'request').mockResolvedValue({ version: 'v', marques: [] });
    api._invalidate('/api/catalog/');
    const [a, b] = await Promise.all([api.getCatalogTree('PC Portable'), api.getCatalogTree('PC Portable')]);
    expect(a).toBe(b);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
