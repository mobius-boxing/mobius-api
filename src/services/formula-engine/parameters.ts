/**
 * The 34 formula parameters — module 08, `formula-engine.md` §1.
 *
 * PARITY (L-010): the `name` keys reproduce Procusto's NCalc binding keys
 * byte-for-byte — spacing, casing and (absence of) accents included
 * (`Formula.cs` L16–49). They are 15 scalar + 16 troquelado + 3
 * route/rotation names. Never normalise, translate or re-accent them.
 *
 * `TESTEAR_FIXTURE` is the design-time validation binding (`Formula.cs`
 * L68–101, `formula-engine.md` §6), bound as doubles per the Mobius note.
 * `FORMULA_PARAMETERS[i].example` is derived from the fixture — there is no
 * second hand-maintained copy of any value.
 */

/** Scope for one evaluation: keys are the exact 34 parameter names. */
export type Scope = Record<string, number>;

export type FormulaParameter = {
  name: string;
  label: string;
  example: number;
};

/** `Formula.Testear`'s fixed fixture (`formula-engine.md` §6). */
export const TESTEAR_FIXTURE: Readonly<Scope> = Object.freeze({
  Largo: 500,
  Base: 400,
  Ancho: 400,
  Altura: 300,
  "Largo adicional": 0,
  "Largo externo": 504,
  "Base externa": 404,
  "Ancho externo": 404,
  "Altura externa": 304,
  "Aleta inferior": 104,
  "Aleta superior": 104,
  Chapeton: 30,
  "Superposicion aletas": 10,
  t: 0.4,
  "Gramaje teorico": 450,
  tr1: 2,
  tr2: 2,
  tr3: 2,
  tr4: 2,
  tr5: 2,
  tr6: 2,
  tr7: 2,
  tr8: 2,
  tr9: 2,
  tr10: 2,
  tr11: 2,
  tr12: 2,
  tr13: 2,
  tr14: 2,
  tr15: 2,
  tr16: 2,
  "Rotacion obligatoria": 0,
  "Repeticiones ancho": 1,
  "Repeticiones largo": 1,
});

/** Ordered per `formula-engine.md` §1; labels are display data (es). */
const PARAMETER_LABELS: ReadonlyArray<{ name: string; label: string }> = [
  { name: "Largo", label: "Largo interno de la caja (mm)" },
  { name: "Base", label: "Sinónimo de Ancho (mm)" },
  { name: "Ancho", label: "Ancho interno de la caja (mm)" },
  { name: "Altura", label: "Altura interna de la caja (mm)" },
  { name: "Largo adicional", label: "Largo adicional de plancha (mm)" },
  { name: "Largo externo", label: "Largo externo de la caja (mm)" },
  { name: "Base externa", label: "Sinónimo de Ancho externo (mm)" },
  { name: "Ancho externo", label: "Ancho externo de la caja (mm)" },
  { name: "Altura externa", label: "Altura externa de la caja (mm)" },
  { name: "Aleta inferior", label: "Aleta inferior (mm)" },
  { name: "Aleta superior", label: "Aleta superior (mm)" },
  { name: "Chapeton", label: "Chapetón / pestaña de pegado (mm)" },
  { name: "Superposicion aletas", label: "Superposición de aletas (mm)" },
  { name: "t", label: "Espesor del cartón / calibre (mm)" },
  { name: "Gramaje teorico", label: "Gramaje teórico (g/m²)" },
  ...Array.from({ length: 16 }, (_, i) => ({
    name: `tr${i + 1}`,
    label: `Ajuste de troquelado ${i + 1}`,
  })),
  { name: "Rotacion obligatoria", label: "Rotación obligatoria (1/0)" },
  { name: "Repeticiones ancho", label: "Repeticiones a lo ancho" },
  { name: "Repeticiones largo", label: "Repeticiones a lo largo" },
];

/** The 34 parameters, in source order, examples derived from the fixture. */
export const FORMULA_PARAMETERS: ReadonlyArray<FormulaParameter> =
  Object.freeze(
    PARAMETER_LABELS.map(({ name, label }) => ({
      name,
      label,
      example: TESTEAR_FIXTURE[name],
    })),
  );
