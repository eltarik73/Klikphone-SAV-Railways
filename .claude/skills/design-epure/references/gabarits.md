# Gabarits de page pour Klikphone (navigation et mise en page d'un back-office)

Sources : Polaris (docs + tokens), Atlassian (navigation system, side-nav, modal, drawer, page header, empty state, Atlaskit), Material 3 (drawer, rail, dialogs, side sheets, tabs, window size classes, list-detail), Primer (PageLayout, Dialog, PageHeader, Timeline), Carbon (UI shell, data table, 2x grid), Apple HIG (layout, sidebars, gestes), WCAG 2.5.8, NN/g (16 articles), Smashing / Vitaly Friedman, Linear (refonte I & II), Laws of UX, Pencil & Paper. ~100 pages lues le 8 novembre 2026. Les règles détaillées par sujet (sidebar, en-tête, grille, tableaux, fiche, tactile, hiérarchie) sont résumées dans le récapitulatif chiffré en fin de fichier.

## Gabarits recommandés pour Klikphone

> Note Klikphone : le troisième niveau de texte est `slate-500` (4,6:1 sur blanc), jamais `slate-400` (2,4:1) — règle écrite en tête d'`index.css` et conservée ; là où ce fichier dit `slate-400` pour du texte, lire `slate-500` (sur fond sombre, `slate-400` reste acceptable pour les items inactifs du menu).


Hypothèses communes : sidebar `#0F172A` 240 px (≥ 1024), off-canvas en dessous ; contenu sur fond `slate-50`, cartes blanches `rounded-xl border border-slate-200` (pas d'ombre portée forte) ; accent `brand-600` (#7C3AED) réservé à l'action primaire, à l'item actif et aux liens ; texte `slate-900 / slate-600 / slate-400` (3 niveaux) ; échelle 4/8/12/16/24/32/48 ; polices 13 (méta) / 14 (corps) / 16 (champs, h2) / 20–24 (h1). Breakpoints Tailwind : `md` 768 (iPad portrait), `lg` 1024 (iPad paysage), `xl` 1280 (PC).

### Coquille d'application (commune)

- Sidebar : largeur **240 px**, padding 12 px, logo 56 px en haut ; groupes « Activité » (Tableau de bord, Tickets, Clients, Devis, Commandes), « Atelier » (Pièces, Tarifs, Dépôt à distance), « Boutique » (Fidélité, Avis, Community manager), « Réglages » (Équipe, Administration) ; intitulés de groupe 11 px, uppercase, `tracking-wider`, `slate-500`, 24 px au-dessus ; items **36 px** (44 px si `pointer: coarse`), icône lucide **18 px**, texte 14 px, inactif `slate-400`, survol `white/5`, actif `white/10` + texte blanc + icône blanche, badge compteur à droite (`bg-white/10`, 11 px, tabular-nums) ; pied : rôle + PIN/déconnexion + bouton de repli.
- Top bar seulement sous 1024 px (48 px : menu, titre court, recherche ⌘K, scan).

```jsx
export function AppShell({ nav, children }) {
  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900 lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="hidden lg:flex lg:flex-col bg-sidebar text-slate-400 px-3 py-4">
        <div className="h-10 px-2 flex items-center text-white font-semibold">Klikphone</div>
        <nav className="mt-4 space-y-6">
          {nav.map(group => (
            <div key={group.label}>
              <p className="px-2 mb-1 text-[11px] uppercase tracking-wider text-slate-500">{group.label}</p>
              {group.items.map(it => (
                <a key={it.to} href={it.to} aria-current={it.active ? 'page' : undefined}
                   className={`flex items-center gap-3 h-9 [@media(pointer:coarse)]:h-11 px-2 rounded-md text-sm
                     ${it.active ? 'bg-white/10 text-white' : 'hover:bg-white/5 hover:text-slate-200'}`}>
                  <it.Icon size={18} aria-hidden /> <span className="flex-1 truncate">{it.label}</span>
                  {it.count > 0 && <span className="text-[11px] tabular-nums rounded-full bg-white/10 px-1.5">{it.count}</span>}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="mt-auto pt-4 border-t border-white/10 text-sm">Accueil · Réglages</div>
      </aside>
      <main className="min-w-0">{children}</main>
    </div>
  );
}
```

### Gabarit 1 — Page liste (Tickets, Clients, Commandes)

- Largeur : pleine largeur, marges 16 / 24 / 32 px.
- Zones, dans l'ordre de lecture : (1) en-tête 64 px : h1 24 px « Tickets » + compteur gris, à droite « Nouveau ticket » (primaire) + « Exporter » (secondaire) + ⋯ ; (2) onglets de vues 44 px : Tous, En attente de diagnostic, En attente de pièce, … chacun avec compteur, soulignement 2 px violet ; (3) barre d'outils 48 px : recherche 280 px à gauche, pilules de filtres (technicien, période, type d'appareil), tri, commutateur densité/liste-cartes à droite, filtres appliqués en pilules supprimables sous la barre ; (4) tableau : lignes 40 px (PC) / 48 px (iPad), première colonne (N° + appareil) sticky, chiffres à droite, badge de statut, traits 1 px `slate-100`, survol `slate-50`, ligne entière cliquable → fiche ; (5) pied : « 1–50 sur 312 », pagination.
- Colonnes par taille : ≥ 1280 : N°, client, appareil, panne, statut, technicien, entré le, montant ; 1024 : sans « panne » ; 768 : N°/appareil, client, statut, entré le, montant ; < 768 : cartes-lignes.
- Sélection multiple : case au survol/toujours visible sur tactile ; barre d'actions fixée en bas (56 px) « 3 sélectionnés — Changer le statut · Notifier · Imprimer ».
- États : squelette 6 lignes, vide par vue (« Aucun ticket en attente de pièce » + un bouton), erreur avec « Réessayer ».
- Tablette : barre d'outils en deux lignes, filtres dans une feuille plein écran avec « Appliquer (24) ».

```jsx
export function ListPage({ title, total, views, rows, columns }) {
  return (
    <div className="px-4 md:px-6 xl:px-8 py-6 space-y-4">
      <header className="flex items-center gap-3 min-h-10">
        <h1 className="text-2xl font-semibold tracking-tight">{title} <span className="text-base font-normal text-slate-400 tabular-nums">{total}</span></h1>
        <div className="ml-auto flex gap-2">{/* secondaires (Exporter…) puis ⋯ au-delà de deux */}
          <button className="h-10 px-4 rounded-md bg-brand-600 text-white text-sm font-medium">Nouveau ticket</button>
        </div>
      </header>
      <nav aria-label="Vues" className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {views.map(v => (
          <a key={v.key} href={v.href} aria-current={v.active ? 'page' : undefined} className={`h-11 px-3 inline-flex items-center gap-2 text-sm border-b-2 -mb-px whitespace-nowrap ${v.active ? 'border-brand-600 text-slate-900 font-semibold' : 'border-transparent text-slate-500'}`}>
            {v.label}<span className="text-xs tabular-nums rounded-full bg-slate-100 px-1.5">{v.count}</span>
          </a>
        ))}
      </nav>
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" placeholder="Rechercher…" className="h-10 w-full md:w-72 rounded-md border border-slate-200 px-3 text-base" />
        <button className="h-10 px-3 rounded-md border border-slate-200 bg-white text-sm">Filtres</button>
        <button className="ml-auto h-10 px-3 rounded-md border border-slate-200 bg-white text-sm">Trier</button>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500"><tr>{columns.map(c => <th key={c.key} className={`h-10 px-4 font-medium ${c.num ? 'text-right' : ''}`}>{c.label}</th>)}</tr></thead>
          <tbody>{rows.map(r => <Row key={r.id} row={r} columns={columns} />)}</tbody>
        </table>
      </div>
    </div>
  );
}
```

### Gabarit 2 — Page fiche (Ticket, Client, Commande)

- Largeur max 1 200 px ; grille **`lg:grid-cols-[minmax(0,1fr)_340px]`**, gouttière 24 px ; une colonne sous 1024 (panneau après le contenu, ou en premier s'il porte le statut).
- En-tête : lien « ← Tickets » 13 px ; ligne titre : « Ticket #1234 » 24 px + `StatusBadge` + méta (client · appareil · déposé il y a 2 j) 13 px gris ; actions : primaire = prochaine étape du statut (« Passer en réparation »), secondaires « Notifier », « Imprimer », ⋯ (Dupliquer, Clôturer, Supprimer) ; précédent/suivant en option.
- Colonne principale (ordre d'importance) : Diagnostic & panne → Pièces & devis (tableau compact, montants à droite) → Notes internes → Activité (timeline : ligne 2 px, point 8 px coloré par type, horodatage relatif + absolu).
- Panneau droit (340 px) : carte unique en sections : Client (nom, tél cliquable, fidélité), Appareil (modèle, IMEI, schéma `PatternGrid`), Montants (HT/TVA/TTC, acompte), Suivi (QR, lien).
- Sections : h2 16 px semibold, 32 px entre sections, trait 1 px `slate-100` ; pas de carte dans la carte.
- Formulaire inline (notes, diagnostic) : barre de sauvegarde collante en bas si modifications.
- Tablette : actions secondaires repliées dans ⋯ dès 768 ; timeline avec dates complètes visibles.

```jsx
export function DetailPage({ ticket, children, aside }) {
  return (
    <div className="px-4 md:px-6 xl:px-8 py-6 max-w-[1200px] mx-auto">
      <a href="/tickets" className="text-sm text-slate-500 hover:text-slate-900">← Tickets</a>
      <header className="mt-2 flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-3"><h1 className="text-2xl font-semibold tracking-tight">Ticket #{ticket.id}</h1><StatusBadge status={ticket.status} /></div>
          <p className="mt-1 text-sm text-slate-500">{ticket.client} · {ticket.appareil} · déposé {ticket.depuis}</p>
        </div>
        <div className="ml-auto flex gap-2">
          <button className="h-10 px-3 rounded-md border border-slate-200 bg-white text-sm">Notifier</button>
          <button className="h-10 px-4 rounded-md bg-brand-600 text-white text-sm font-medium">{ticket.prochaineEtape}</button>
          <button aria-label="Plus d'actions" className="h-10 w-10 rounded-md border border-slate-200 bg-white">⋯</button>
        </div>
      </header>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">{children}</div>
        <aside className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100 lg:sticky lg:top-6 self-start">{aside}</aside>
      </div>
    </div>
  );
}
export const Section = ({ title, action, children }) => (
  <section className="p-5 md:p-6">
    <div className="flex items-center mb-3"><h2 className="text-base font-semibold">{title}</h2><div className="ml-auto text-sm">{action}</div></div>
    {children}
  </section>
);
```

### Gabarit 3 — Formulaire long (création de ticket, fiche client, réglages)

- Largeur **max 720 px** centrée (Polaris étroit 662, « single unified task »), une seule colonne, champs courts côte à côte seulement s'ils sont liés (CP + ville).
- Sections annotées façon Polaris réglages à partir de 768 px : grille `md:grid-cols-[2fr_5fr]`, titre 16 px + description 13 px gris à gauche, carte de champs à droite ; empilé sous 768.
- Champs : hauteur **44 px**, `text-base` (16 px, pas de zoom iOS), libellé au-dessus 14 px, aide 13 px, erreur rouge sous le champ avec saisie conservée ; champs optionnels marqués « (facultatif) », pas d'astérisques partout.
- Validation : à la soumission + au blur sur les champs à format (tél, email) ; messages spécifiques.
- Sauvegarde : barre collante **en bas** 64 px, visible seulement si le formulaire est sale : « Modifications non enregistrées » · Annuler · Enregistrer (primaire) ; confirmation avant de quitter.
- Tablette : scroll automatique du champ actif au-dessus du clavier ; pas de barre collante en haut ; claviers `tel`, `email`, `numeric`.

```jsx
export function LongForm({ sections, dirty, onSubmit, onReset }) {
  return (
    <form onSubmit={onSubmit} onReset={onReset} className="px-4 md:px-6 py-6 max-w-[720px] mx-auto pb-24">
      <div className="space-y-6">{/* le h1 vient de l'en-tête de page commun */}
        {sections.map(s => (
          <section key={s.title} className="md:grid md:grid-cols-[2fr_5fr] md:gap-6">
            <div className="mb-3 md:mb-0"><h2 className="text-base font-semibold">{s.title}</h2><p className="text-sm text-slate-500 mt-1">{s.help}</p></div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              {s.fields.map(f => (
                <label key={f.name} className="block">
                  <span className="block text-sm font-medium mb-1">{f.label}{f.optional && <span className="text-slate-400 font-normal"> (facultatif)</span>}</span>
                  <input name={f.name} type={f.type} inputMode={f.inputMode} autoComplete={f.autoComplete}
                         className="h-11 w-full rounded-md border border-slate-300 px-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-500" />
                  {f.error && <span role="alert" className="block mt-1 text-sm text-red-600">{f.error}</span>}
                </label>
              ))}
            </div>
          </section>
        ))}
      </div>
      {dirty && (
        <div className="fixed inset-x-0 bottom-0 lg:left-[240px] h-16 bg-white border-t border-slate-200 flex items-center gap-2 px-4 md:px-6">
          <span className="text-sm text-slate-600">Modifications non enregistrées</span>
          <button type="reset" className="ml-auto h-10 px-3 rounded-md border border-slate-200 text-sm">Annuler</button>
          <button type="submit" className="h-10 px-4 rounded-md bg-brand-600 text-white text-sm font-medium">Enregistrer</button>
        </div>
      )}
    </form>
  );
}
```

### Gabarit 4 — Dashboard (Tableau de bord)

- Largeur max **1 280 px**, marges 16/24/32, gouttière 16 px.
- Ordre de lecture (F) : (1) en-tête : « Bonjour, Sarah » 24 px + date, à droite sélecteur de période (segmenté) et « Nouveau ticket » ; (2) rangée de **4 tuiles KPI** (`grid-cols-2 xl:grid-cols-4`), chacune : libellé 13 px gris, valeur 28 px semibold tabular-nums, delta 13 px (vert/rouge + flèche, jamais la couleur seule) ; (3) rangée `xl:grid-cols-[2fr_1fr]` : graphique (recharts, une seule couleur de série principale) à gauche, liste « À traiter aujourd'hui » à droite (lignes 44 px cliquables) ; (4) tableau compact « Derniers tickets » pleine largeur (6 lignes, lien « Voir tout »).
- Hiérarchie : un seul point focal (la tuile « En attente d'accord client » si elle est > 0 peut recevoir une pastille, pas un fond coloré) ; aucune tuile en dégradé ; pas de carte dans une carte.
- Tablette portrait : tuiles 2×2, graphique et liste empilés ; paysage : 4 tuiles, deux colonnes.

```jsx
export function Dashboard({ kpis, chart, todo, recent }) {
  return (
    <div className="px-4 md:px-6 xl:px-8 py-6 max-w-[1280px] mx-auto space-y-6">
      <header className="flex items-center gap-3">
        <div><h1 className="text-2xl font-semibold tracking-tight">Tableau de bord</h1><p className="text-sm text-slate-500">Samedi 8 novembre</p></div>
        <div className="ml-auto flex gap-2">
          <select className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"><option>7 jours</option><option>30 jours</option></select>
          <button className="h-10 px-4 rounded-md bg-brand-600 text-white text-sm font-medium">Nouveau ticket</button>
        </div>
      </header>
      <section aria-label="Indicateurs" className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {kpis.map(k => (
          <a key={k.label} href={k.href} className="rounded-xl border border-slate-200 bg-white p-5 hover:border-slate-300">
            <p className="text-sm text-slate-500">{k.label}</p>
            <p className="mt-2 text-[28px] leading-none font-semibold tabular-nums">{k.value}</p>
            <p className={`mt-2 text-sm ${k.delta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{k.delta >= 0 ? '↑' : '↓'} {Math.abs(k.delta)} % vs période précédente</p>
          </a>
        ))}
      </section>
      <section className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="text-base font-semibold mb-4">Tickets créés</h2>{chart}</div>
        <div className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="text-base font-semibold mb-2">À traiter aujourd'hui</h2>{todo}</div>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white">{recent}</section>
    </div>
  );
}
```

### Gabarit 5 — Modale (confirmation, changement de statut, saisie courte)

- Tailles : **400 px** confirmation, **560 px** défaut (≤ 5 champs), jamais plus large : au-delà → drawer ou page ; plein écran (feuille) sous 640 px, max-height 85 dvh avec corps défilant.
- Anatomie : en-tête 56 px (titre 18 px semibold, verbe + nom : « Supprimer le ticket ? », bouton ✕ 44×44) ; corps padding 24, information critique en premier ; pied : boutons **à droite**, secondaire « Annuler » puis primaire (ou destructif rouge) en dernier, **deux boutons** ; Échap et clic extérieur ferment (sauf formulaire sale → confirmation).
- Focus : sur le premier élément interactif à l'ouverture, retour au déclencheur à la fermeture ; `role="dialog" aria-modal aria-labelledby`.
- Ne pas utiliser pour : formulaires longs, éditions profondes, multi-étapes, erreurs, nouveautés.

```jsx
export function Modal({ open, title, onClose, children, actions, size = 'md' }) {
  if (!open) return null;
  const w = size === 'sm' ? 'sm:max-w-[400px]' : 'sm:max-w-[560px]';
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 p-0 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={e => e.stopPropagation()}
           className={`w-full ${w} max-h-[85dvh] flex flex-col bg-white rounded-t-2xl sm:rounded-xl shadow-xl`}>
        <header className="flex items-center h-14 pl-6 pr-2 border-b border-slate-100">
          <h2 id="modal-title" className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Fermer" className="ml-auto h-11 w-11 rounded-md hover:bg-slate-100">✕</button>
        </header>
        <div className="p-6 overflow-y-auto text-sm text-slate-700">{children}</div>
        <footer className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="h-10 px-3 rounded-md border border-slate-200 text-sm">Annuler</button>
          {actions}
        </footer>
      </div>
    </div>
  );
}
```

### Gabarit 6 — Drawer (panneau latéral : filtres, aperçu rapide, édition secondaire)

- Position droite, largeur **480 px** (`clamp(400px, 40vw, 480px)`), pleine largeur sous 640 px ; overlay léger ; le contenu derrière reste visible (comparaison, copier-coller).
- Anatomie : en-tête 56 px (titre 18 px + ✕), corps défilant padding 24, pied collant 64 px avec actions à droite (Annuler · Appliquer / Enregistrer) ; Échap ferme ; pas de drawer dans un drawer.
- Usages Klikphone : filtres avancés de liste (avec compteur sur « Appliquer (24) »), aperçu d'un ticket depuis la liste (sans quitter la page), ajout d'une pièce/commande depuis la fiche, choix d'un modèle de message. Pas pour la création complète d'un ticket (page).
- Tablette : glisse depuis la droite, 400 px en paysage, plein écran en portrait.

```jsx
export function Drawer({ open, title, onClose, children, footer }) {
  return (
    <div className={`fixed inset-0 z-40 ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
      <div onClick={onClose} className={`absolute inset-0 bg-slate-900/30 transition-opacity motion-reduce:transition-none ${open ? 'opacity-100' : 'opacity-0'}`} />
      <aside role="dialog" aria-modal="true" aria-labelledby="drawer-title"
             className={`absolute inset-y-0 right-0 w-full sm:w-[clamp(400px,40vw,480px)] bg-white shadow-xl flex flex-col
               transition-transform motion-reduce:transition-none ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <header className="flex items-center h-14 pl-6 pr-2 border-b border-slate-100">
          <h2 id="drawer-title" className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Fermer" className="ml-auto h-11 w-11 rounded-md hover:bg-slate-100">✕</button>
        </header>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
        {footer && <footer className="flex justify-end gap-2 px-6 py-3 border-t border-slate-100 min-h-16">{footer}</footer>}
      </aside>
    </div>
  );
}
```

---

## Récapitulatif chiffré (à coller dans un fichier de jetons)

| Élément | Valeur | Appui principal |
|---|---|---|
| Sidebar | 240 px ; rail 64 px ; off-canvas < 1024 | Polaris 240, Atlassian 240–320 & flyout < 1024, Material classes |
| Item de nav | 36 px souris / 44 px tactile, icône 18 px, texte 14 px | Carbon 32/16, Polaris 40/20, HIG 44 |
| Intitulé de groupe | 11 px uppercase, 24 px au-dessus | Polaris « SALES CHANNELS » |
| Titre de page | 24 px (20 si onglets), un seul h1 | Atlassian L 24, Polaris heading-xl 24, Primer 20 |
| Actions d'en-tête | 1 primaire + ≤ 2 secondaires + ⋯ | Polaris, Material app bar |
| Onglets | 44–48 px, soulignement 2 px, 1–2 mots | Material 48 / 2–3 dp, NN/g |
| Barre d'outils | recherche 280 px à gauche, pilules, tri à droite | Polaris index filters, Smashing filtres |
| Largeur max | formulaire 720, fiche 1 200 (1fr + 340), dashboard 1 280, liste pleine largeur | Polaris 662 / 2fr-1fr, Primer 1280 |
| Marges | 16 / 24 / 32 ; gouttières 16 / 24 | Carbon, Primer |
| Espacement | 4 / 8 / 12 / 16 / 24 / 32 / 48 | Carbon, Polaris, Refactoring UI |
| Lignes de tableau | 40 px souris / 48 px tactile ; en-tête idem | Carbon, Pencil & Paper |
| Tableau | texte à gauche, nombres à droite tabulaires, traits 1 px, pas de zébrage, 1re colonne sticky, 50 / page | Pencil & Paper, A List Apart, Polaris |
| Sections de fiche | h2 16 px, 32 px entre sections | Atlassian S 16 |
| Modale | 400 / 560 px, plein écran < 640, 2 boutons à droite | Polaris 380/620, Material ≤ 560, Atlassian 400/600 |
| Drawer | 400–480 px, plein écran < 640 | Atlassian 360/480/600, Material ≤ 400 |
| Cibles tactiles | 44 px, 8 px d'écart | HIG, Material, WCAG |
| Champs | 44 px de haut, 16 px de police | HIG, iOS zoom |
| Texte | 3 niveaux : slate-900 / 600 / 400 | Refactoring UI, Material 87/60/38 % |
| Chargement | squelette > 1 s, % > 10 s | NN/g |

---

