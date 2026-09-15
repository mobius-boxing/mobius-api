/**
 * The colours a tenant gets until somebody picks their own.
 *
 * ONE definition, because these values are served by the public branding
 * endpoint AND mirrored as CSS fallbacks in the module stylesheets. When the
 * two drift, a tenant with no branding renders differently depending on whether
 * the branding call succeeded — which is exactly the bug this file prevents.
 *
 * Any module frontend that hardcodes one of these is wrong; it should let the
 * endpoint tell it.
 */

/** Mobius green. */
export const DEFAULT_BRAND_COLOR = "#018445";

/**
 * The app chrome (top bar). Warm graphite, deliberately near-neutral: it sits
 * behind the tenant's own brand colour, so anything chromatic here would
 * compete with the one colour the tenant actually chose.
 */
export const DEFAULT_SHELL_COLOR = "#191713";

/**
 * The page background. Warm paper, not white — this is read for hours.
 *
 * These two hexes are the EXACT rendered value of the oklch defaults already
 * in countdown's global.css (`oklch(0.977 0.005 82)` and `oklch(0.205 0.008
 * 82)`), measured rather than eyeballed. They must stay exact: the endpoint
 * always sends a concrete colour, so an approximation here would shift the
 * background of every tenant that never picked one.
 */
export const DEFAULT_CANVAS_COLOR = "#f9f7f4";

/**
 * NOT customizable, on purpose: the four due-date bands (overdue / this week /
 * this month / later). Those colours are not decoration — they encode
 * time-to-due, and their text/dot/tint triplets are individually tuned for
 * contrast. A tenant who set "overdue" to green would be shipping a UI that
 * lies about urgency, so the bands stay owned by the stylesheet.
 */
export const CUSTOMIZABLE_COLOR_FIELDS = [
  "brandColor",
  "accentColor",
  "shellColor",
  "canvasColor",
] as const;

export type CustomizableColorField = (typeof CUSTOMIZABLE_COLOR_FIELDS)[number];
