/**
 * Composants partagés de la refonte « design épuré » : CarteChiffres (carte à colonnes qui remplace
 * les rangées de cartes KPI) et Interrupteur (role="switch").
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import { useState } from 'react';
import { Timer } from 'lucide-react';
import CarteChiffres from '../components/CarteChiffres';
import Interrupteur from '../components/Interrupteur';

afterEach(cleanup);

const CHIFFRES = [
  { cle: 'total', label: 'Total', valeur: 12 },
  { cle: 'stock', label: 'Stock faible', valeur: 3, ton: 'danger' },
  { cle: 'ca', label: 'Chiffre d’affaires', valeur: '1 234,50 €', montant: true, detail: 'sur 30 jours' },
];

describe('CarteChiffres', () => {
  it('une seule carte nommée, des cellules libellé + valeur dans une liste de définitions', () => {
    render(<CarteChiffres label="Chiffres du test" chiffres={CHIFFRES} colonnes={{ base: 2, lg: 3 }} />);
    const carte = screen.getByRole('region', { name: 'Chiffres du test' });
    expect(carte).toHaveClass('card', 'overflow-hidden');
    expect(carte).toHaveAttribute('aria-busy', 'false');
    const grille = carte.querySelector('dl');
    expect(grille).toHaveClass('grid', 'grid-cols-2', 'lg:grid-cols-3', '-ml-px', '-mt-px');
    expect(within(carte).getAllByRole('term').map((t) => t.textContent)).toEqual(['Total', 'Stock faible', 'Chiffre d’affaires']);
    // Filets : bordure gauche et haute sur chaque cellule (rognées au bord par la carte), jamais divide-x
    for (const cellule of grille.children) expect(cellule).toHaveClass('border-l', 'border-t', 'border-slate-200');
    expect(carte.innerHTML).not.toMatch(/divide-/);
    expect(screen.getByText('12')).toHaveClass('text-2xl', 'font-semibold', 'tabular-nums', 'text-slate-900', 'leading-none');
    expect(screen.getByText('3')).toHaveClass('text-red-700');
    expect(screen.getByText('1 234,50 €')).toHaveClass('text-xl', 'whitespace-nowrap');
    expect(screen.getByText('sur 30 jours')).toHaveClass('t-caption');
    expect(screen.getByText('Total')).toHaveClass('t-small', 'text-slate-600', 'truncate');
  });

  it('chargement : aria-busy, mêmes cellules, squelette à la place de la valeur (rien ne saute)', () => {
    const { rerender } = render(<CarteChiffres label="Chiffres du test" chiffres={CHIFFRES} chargement />);
    const carte = screen.getByRole('region', { name: 'Chiffres du test' });
    expect(carte).toHaveAttribute('aria-busy', 'true');
    expect(within(carte).getAllByRole('term')).toHaveLength(3);
    expect(carte.querySelectorAll('.skeleton-line').length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText('12')).toBeNull();
    rerender(<CarteChiffres label="Chiffres du test" chiffres={CHIFFRES} />);
    expect(carte).toHaveAttribute('aria-busy', 'false');
    expect(carte.querySelectorAll('.skeleton-line')).toHaveLength(0);
    expect(within(carte).getAllByRole('term')).toHaveLength(3);
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('libellés inconnus pendant le chargement : squelettes à la place du libellé aussi', () => {
    render(<CarteChiffres label="Indicateurs" chargement chiffres={[{ cle: 1 }, { cle: 2 }]} />);
    const carte = screen.getByRole('region', { name: 'Indicateurs' });
    expect(carte.querySelectorAll('.skeleton-line')).toHaveLength(4);
  });

  it('cellule cliquable : bouton 44 px, aria-pressed suit le filtre actif', () => {
    const surClic = vi.fn();
    function Filtre() {
      const [actif, setActif] = useState(null);
      return (
        <CarteChiffres label="À traiter" chiffres={[
          { cle: 'retard', label: 'En retard', valeur: 2, ton: 'danger', onClick: () => { surClic('retard'); setActif('retard'); }, actif: actif === 'retard' },
          { cle: 'pret', label: 'Prêts', valeur: 5, onClick: () => setActif('pret'), actif: actif === 'pret' },
        ]} />
      );
    }
    render(<Filtre />);
    const carte = screen.getByRole('region', { name: 'À traiter' });
    expect(carte.querySelector('dl')).toBeNull();
    const retard = within(carte).getByRole('button', { name: /En retard/ });
    expect(retard).toHaveClass('min-h-11', 'focus-visible:ring-2', 'focus-visible:ring-inset', 'focus-visible:ring-brand-500');
    expect(retard).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(retard);
    expect(surClic).toHaveBeenCalledWith('retard');
    expect(retard).toHaveAttribute('aria-pressed', 'true');
    expect(retard).toHaveClass('bg-slate-100');
    expect(within(carte).getByRole('button', { name: /Prêts/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('variante sombre (kiosque) : surface slate-800, texte clair, filets white/10, pas de classe card', () => {
    render(<CarteChiffres label="Kiosque" sombre chiffres={CHIFFRES} />);
    const carte = screen.getByRole('region', { name: 'Kiosque' });
    expect(carte).not.toHaveClass('card');
    expect(carte).toHaveClass('bg-slate-800');
    expect(screen.getByText('Total')).toHaveClass('text-slate-300');
    expect(screen.getByText('12')).toHaveClass('text-white');
    expect(carte.querySelector('dl').firstElementChild).toHaveClass('border-white/10');
  });

  it('variation à côté de la valeur ; valeur absente → « — »', () => {
    render(<CarteChiffres label="Analyse" chiffres={[
      { label: 'Portée', valeur: 1200, variation: <span>+12 %</span> },
      { label: 'Abonnés', valeur: undefined },
    ]} />);
    const portee = screen.getByText('1200');
    expect(portee.parentElement).toContainElement(screen.getByText('+12 %'));
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('Interrupteur', () => {
  function Controle({ initial = false, ...props }) {
    const [actif, setActif] = useState(initial);
    return <Interrupteur checked={actif} onChange={setActif} {...props} />;
  }

  it('role switch nommé par son libellé (cliquable), décrit par sa description', () => {
    render(<Controle label="Activer le programme fidélité" description="Les clients cumulent des points" />);
    const inter = screen.getByRole('switch', { name: 'Activer le programme fidélité' });
    expect(inter).toHaveAttribute('aria-checked', 'false');
    expect(inter).toHaveAccessibleDescription('Les clients cumulent des points');
    expect(inter).toHaveClass('min-h-11', 'focus-visible:ring-2', 'focus-visible:ring-brand-500', 'focus-visible:ring-offset-2');
    const piste = inter.firstElementChild;
    expect(piste).toHaveClass('h-6', 'w-11', 'rounded-full', 'bg-slate-500');
    expect(piste.firstElementChild).toHaveClass('h-5', 'w-5', 'bg-white', 'transition-transform', 'duration-150', 'motion-reduce:transition-none');
    fireEvent.click(inter);
    expect(inter).toHaveAttribute('aria-checked', 'true');
    expect(piste).toHaveClass('bg-brand-600');
    // Le libellé est cliquable
    fireEvent.click(screen.getByText('Activer le programme fidélité'));
    expect(inter).toHaveAttribute('aria-checked', 'false');
  });

  it('clavier : Entrée et Espace basculent, une seule fois chacun', () => {
    const onChange = vi.fn();
    render(<Interrupteur checked={false} onChange={onChange} label="Mode édition" icone={Timer} />);
    const inter = screen.getByRole('switch', { name: 'Mode édition' });
    inter.focus();
    fireEvent.keyDown(inter, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(inter, { key: ' ' });
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.keyUp(inter, { key: ' ' });
    expect(onChange).toHaveBeenCalledTimes(2);
    // Un relâchement d'Espace sans appui sur l'interrupteur ne bascule pas
    fireEvent.keyUp(inter, { key: ' ' });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('clavier : aria-checked suit Espace et Entrée', () => {
    render(<Controle label="Activer les animations" />);
    const inter = screen.getByRole('switch', { name: 'Activer les animations' });
    fireEvent.keyDown(inter, { key: ' ' });
    fireEvent.keyUp(inter, { key: ' ' });
    expect(inter).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(inter, { key: 'Enter' });
    expect(inter).toHaveAttribute('aria-checked', 'false');
  });

  it('désactivé : ni clic, ni libellé, ni clavier ne basculent', () => {
    const onChange = vi.fn();
    render(<Interrupteur checked onChange={onChange} label="Envoyer les SMS" disabled />);
    const inter = screen.getByRole('switch', { name: 'Envoyer les SMS' });
    expect(inter).toBeDisabled();
    expect(inter).toHaveAttribute('aria-checked', 'true');
    expect(inter.firstElementChild).toHaveClass('opacity-60');
    fireEvent.click(inter);
    fireEvent.click(screen.getByText('Envoyer les SMS'));
    fireEvent.keyDown(inter, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('sans libellé : bouton seul, nommé par un titre voisin, ref vers le bouton, aria-busy', () => {
    const ref = { current: null };
    render(
      <div>
        <h2 id="titre-test">Anonymisation automatique</h2>
        <p id="aide-test">Une fois par jour.</p>
        <Interrupteur ref={ref} checked={false} onChange={() => {}} aria-labelledby="titre-test" aria-describedby="aide-test" busy />
      </div>,
    );
    const inter = screen.getByRole('switch', { name: 'Anonymisation automatique' });
    expect(inter).toHaveAccessibleDescription('Une fois par jour.');
    expect(inter).toHaveAttribute('aria-busy', 'true');
    expect(ref.current).toBe(inter);
    expect(document.querySelector('label')).toBeNull();
  });

  it('placement « debut » : interrupteur avant le libellé (barre de filtres)', () => {
    render(<Controle label="En stock" placement="debut" initial />);
    const inter = screen.getByRole('switch', { name: 'En stock' });
    expect(inter).toHaveAttribute('aria-checked', 'true');
    expect(inter.nextElementSibling).toContainElement(screen.getByText('En stock'));
  });
});
