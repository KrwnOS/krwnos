/**
 * Spanish — merged over English. Extend `overrides` as translations land.
 */

import type { Dict } from "../types";
import { en } from "./en";

const overrides: Partial<Dict> = {
  "language.switcher.label": "Idioma",
  "home.hero.titleCrown": "estado digital.",
  "home.cta.coronate": "Coronar",
  "invite.accept": "Aceptar invitación",
  "invite.title": "Invitación a «{stateName}»",
  "nexus.vertical.nodes":
    "{count, plural, one {# nodo} other {# nodos}}",
  "nexus.vertical.citizens":
    "{count, plural, one {# ciudadano} other {# ciudadanos}}",
  "pulse.sidebar.onlineTotal":
    "{count, plural, other {En línea: #}}",
  "chat.tray.items":
    "{count, plural, one {Tiene # directiva sin acuse.} other {Tiene # directivas sin acuse.}}",
};

export const es: Dict = { ...en, ...(overrides as Dict) };
