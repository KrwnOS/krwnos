/**
 * Turkish — merged over English.
 */

import type { Dict } from "../types";
import { en } from "./en";

const overrides: Partial<Dict> = {
  "language.switcher.label": "Dil",
  "home.hero.titleCrown": "dijital devlet.",
  "home.cta.coronate": "Taç giydir",
  "invite.accept": "Daveti kabul et",
  "invite.title": "«{stateName}» daveti",
  "nexus.vertical.nodes":
    "{count, plural, one {# düğüm} other {# düğüm}}",
  "nexus.vertical.citizens":
    "{count, plural, one {# vatandaş} other {# vatandaş}}",
  "pulse.sidebar.onlineTotal":
    "{count, plural, other {Çevrimiçi: #}}",
  "chat.tray.items":
    "{count, plural, one {# onaylanmamış direktifiniz var.} other {# onaylanmamış direktifiniz var.}}",
};

export const tr: Dict = { ...en, ...(overrides as Dict) };
