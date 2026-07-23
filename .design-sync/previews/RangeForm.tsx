import { RangeForm } from 'brot-soft'

// Feste Daten für deterministische Renders; onSubmit ist im Preview ein No-op.
export const Buchen = () => (
  <RangeForm label="Buchen" initialDate="2026-08-03" onSubmit={async () => {}} />
)

export const Freigeben = () => (
  <RangeForm label="Freigeben" initialDate="2026-08-03" onSubmit={async () => {}} />
)
