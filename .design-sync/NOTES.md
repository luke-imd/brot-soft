# design-sync — Repo-Notizen

- Repo ist eine **App, kein Library-Package**: es gibt kein dist-Entry. Immer `--entry .design-sync/entry.ts` an `package-build.mjs`/`resync.mjs` übergeben (RangeForm ist Default-Export; der Entry re-exportiert benannt). Ohne `--entry` crasht der Build mit ENOENT auf `node_modules/brot-soft`.
- `buildCmd` (Config) baut die App und kopiert das gehashte Vite-CSS nach `.design-sync/.cache/app.css` (= `cssEntry`). **Vor jedem Sync ausführen**, sonst wird veraltetes CSS gebündelt.
- **Playwright/Chromium bewusst nicht installiert** (User-Entscheidung, 2026-07-23): Render-Check lief mit `--no-render-check`; Capture/Grading (`package-capture.mjs`) läuft nicht. Verifikation war die Sichtprüfung des Users über `.review.html` (RangeForm: Buchen/Freigeben abgenommen).
- Barlow liegt lokal in `.design-sync/fonts/` (Google Fonts, OFL; latin + latin-ext, Gewichte 400–800), eingebunden via `extraFonts`. German-Umlaute sind im latin-Subset abgedeckt.
- Tailwind v4 JIT: `_ds_bundle.css` enthält **nur die von der App genutzten Utilities**. `conventions.md` listet die verfügbaren Familien als Auszug — bei größeren UI-Änderungen der App die Listen per grep gegen das frische `ds-bundle/_ds_bundle.css` re-validieren (so wie beim Erst-Sync).
- `package-validate.mjs` meldet „.d.ts parse check skipped — typescript not in node_modules", obwohl typescript@7 installiert ist (vermutlich native-tsgo-Layout). Nicht blockierend; `dtsPropsFor.RangeForm` ist handgeschrieben.
- Die Seiten (`src/pages/*`, `App.tsx`, `Login.tsx`) sind absichtlich NICHT im Sync: an Supabase/`import.meta.env` gekoppelt, keine DS-Bausteine. Das Design-System der App sind die CSS-Klassen (`card`, `btn*`, `input`, `fade-in`) + Tokens.

## Bekannte Render-Warns

- `[RENDER_SKIPPED]` — erwartet, solange Playwright fehlt (siehe oben).

## Re-sync risks

- `app.css` ist Build-Artefakt: `buildCmd` vergessen → alter Look wird hochgeladen, ohne dass etwas fehlschlägt.
- Der Utility-Auszug in `conventions.md` kann gegenüber neuem App-CSS veralten (falsche Versprechen an den Design-Agenten) — re-validieren.
- Renders wurden **nie maschinell geprüft**; beim ersten Re-Sync mit installiertem Playwright einmal voll verifizieren (ohne `--no-render-check`).
- RangeForm-Preview nutzt festes Datum `2026-08-03` — irgendwann in der Vergangenheit, rein kosmetisch.
