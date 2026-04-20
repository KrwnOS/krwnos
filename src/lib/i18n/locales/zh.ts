/**
 * Chinese (Simplified) — merged over English.
 */

import type { Dict } from "../types";
import { en } from "./en";

const overrides: Partial<Dict> = {
  "language.switcher.label": "语言",
  "home.hero.titleCrown": "数字国家。",
  "home.cta.coronate": "加冕",
  "invite.accept": "接受邀请",
  "invite.title": "「{stateName}」的邀请",
  "nexus.vertical.nodes": "{count, plural, other {# 个节点}}",
  "nexus.vertical.citizens": "{count, plural, other {# 位公民}}",
  "pulse.sidebar.onlineTotal": "{count, plural, other {在线：#}}",
  "chat.tray.items":
    "{count, plural, other {您有 # 条未确认的指令。}}",
};

export const zh: Dict = { ...en, ...(overrides as Dict) };
