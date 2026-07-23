# Garagen-Tool — Konventionen für den Design-Agenten

Internes WG-Tool zur Garagenplatz-Verwaltung. Look: cleaner Startup-Stil — helle Zinc-Fläche, weiße Karten mit feiner Border, ink-dunkle Buttons, Schrift **Barlow** (an Straßenbeschilderung angelehnt). UI-Sprache Deutsch, Code/Identifier Englisch. Nicht überladen: wenige Farben, viel Weißraum.

## Setup
Kein Provider nötig. `styles.css` laden — der `body` bekommt daraus automatisch Hintergrund (`zinc-100`), Textfarbe, Antialiasing und Barlow (Base-Layer in `_ds_bundle.css`; Fonts via `fonts/fonts.css`, Gewichte 400–800).

## Bausteine (Klassen aus `_ds_bundle.css`)
- `card` — weiße Karte: rounded-2xl, feine `zinc-200`-Border, sehr weicher Schatten, `p-5`.
- `btn` + Variante, immer kombiniert: `btn btn-primary` (ink/zinc-900), `btn btn-outline` (weiß mit Border), `btn btn-danger` (rot). Hover/Active/Disabled sind eingebaut.
- `input` — Textfelder, Selects, Date-Inputs.
- `fade-in` — sanftes Einblenden für Panels/Tab-Inhalte (respektiert reduced motion).

## Farb-Disziplin
Statusfarben sind für den Parkplatz-Status reserviert: `zinc-400`/`zinc-700` = Besitzer nutzt selbst, `emerald-500` = frei, `blue-500` = meine Buchung, `orange-400` = fremd gebucht, `ring-yellow-300` = Auswahl. Aktions-Buttons sind ink-dunkel, Bestätigen/Begleichen `emerald-600`, Gefahr `red-600`, Hinweis-Banner `amber-50/200/800` bzw. `red-50/200/700`. Grün/Blau/Orange nie als Deko einsetzen.

## WICHTIG: Utility-Umfang ist begrenzt
Das CSS ist Tailwind-v4-Output, JIT-gepruned — **nur die von der App genutzten Utilities existieren**. Eine beliebige andere Klasse (z. B. `bg-teal-500`, `p-12`) löst NICHT auf. Vorhandene Familien (Auszug): `bg-/text-/border-` in zinc (50–900), emerald (100/500/600/700), blue (50/500/600), orange-400, red (50/200/500/600/700), amber (50/200/800), yellow (50/300), white; `rounded-md/lg/xl/3xl/full`; `text-xs/sm/lg/xl/2xl`; `font-medium/semibold/bold/extrabold`; `tracking-tight`, `tabular-nums`, `shadow-inner`, `backdrop-blur`, flex/grid/gap/space-y-Basics. Für eigenes Layout-Glue jenseits davon: **Inline-Styles mit den Tokens** — alle `var(--color-<name>-<stufe>)`, `var(--font-sans)` und `var(--spacing)` (0.25rem-Raster) sind in `:root` definiert und shippen immer.

## Wo die Wahrheit liegt
`styles.css` → importiert `fonts/fonts.css` + `_ds_bundle.css` (kompilierte App-CSS inkl. aller Token-Variablen). Komponenten-API + Beispiele: `components/general/<Name>/` (`.d.ts` = Contract, `.prompt.md` = Nutzung).

## Idiomatisches Beispiel
```jsx
const { RangeForm } = window.GarageDS
<div className="card space-y-4">
  <h2 className="text-lg font-bold tracking-tight">Platz 7 freigeben</h2>
  <input className="input w-full" placeholder="Notiz (optional)" />
  <RangeForm label="Freigeben" initialDate="2026-08-03" onSubmit={async () => {}} />
  <div className="flex gap-2">
    <button className="btn btn-outline flex-1">Abbrechen</button>
    <button className="btn btn-primary flex-1">Speichern</button>
  </div>
</div>
```
