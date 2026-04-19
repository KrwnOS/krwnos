/**
 * English dictionary.
 * ------------------------------------------------------------
 * Mirrors the shape of `ru.ts`. Any key missing here falls back
 * to the Russian value at runtime (see `src/lib/i18n/index.ts`).
 * When adding a new string, always add the key in `ru.ts` first,
 * then here.
 *
 * Plural templates use English "one | other" semantics; the
 * runtime only picks between the first ("one") and last ("many")
 * variants for English locales. Middle variants are harmless —
 * they're kept to preserve a consistent split-by-pipe shape.
 */

import type { Dict } from "../types";

export const en: Dict = {
  "common.loading": "Loading…",
  "common.loadingDots": "…",
  "common.refresh": "Refresh",
  "common.save": "Save",
  "common.saving": "Saving…",
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.closeX": "Close ✕",
  "common.confirm": "Confirm",
  "common.sending": "Sending…",
  "common.submit": "Submit",
  "common.login": "Log in",
  "common.logout": "Change token",
  "common.error": "Error",
  "common.errorWith": "Error: {message}",
  "common.never": "never",
  "common.notSet": "—",
  "common.dash": "—",
  "common.yes": "yes",
  "common.no": "no",
  "common.on": "enabled",
  "common.off": "disabled",
  "common.docs": "Docs",
  "common.copy": "copy",
  "common.copied": "copied",
  "common.copyAddress": "Copy address",
  "common.details": "Details",
  "common.collapse": "Collapse",
  "common.show": "Show",
  "common.hide": "Hide",

  "app.title": "KrwnOS — Community Operating System",
  "app.description":
    "A modular operating system for building digital states, companies and communities.",
  "app.brand": "KrwnOS",
  "language.switcher.label": "Language",

  "home.chat.open": "Open chat",
  "home.chat.close": "Hide chat",
  "home.chat.float": "Chat",
  "home.chat.preparing": "Opening the channel…",
  "home.cta.coronate": "Coronate",
  "home.hero.eyebrow": "Community OS",
  "home.hero.titlePre": "Build your own",
  "home.hero.titleCrown": "digital state.",
  "home.hero.body":
    "KrwnOS is a modular operating system for running communities, companies and clans. The Sovereign assembles a Vertical of power, plugs in modules and delegates rights down the hierarchy.",
  "home.hero.createState": "Create a State",
  "home.hero.buildModule": "Build a module",
  "home.pillar.state.title": "The State",
  "home.pillar.state.desc":
    "An isolated instance with its own Sovereign, rules and a set of installed modules.",
  "home.pillar.vertical.title": "The Vertical",
  "home.pillar.vertical.desc":
    "A graph of power. Permissions are inherited and branch top-down.",
  "home.pillar.kernel.title": "The Kernel",
  "home.pillar.kernel.desc":
    "Auth, Permissions, Event Bus and Registry — the minimal kernel services.",
  "home.pillar.modules.title": "The Modules",
  "home.pillar.modules.desc":
    "Chat, Treasury, Tasks, Voting — plug-ins that extend the state.",
  "home.footer.mvp": "MVP — Phase 1 Foundation. See",
  "home.footer.roadmap": "ROADMAP",
  "home.sidepanel.label": "Core.Chat",

  "setup.title": "KrwnOS — Coronation",
  "setup.subtitle":
    "First launch. Let's spin up your State and its Sovereign.",
  "setup.done.title": "State created",
  "setup.done.subtitle": "— your digital state is alive.",
  "setup.done.shownOnce": "shown once",
  "setup.done.bootstrapToken": "Bootstrap CLI token",
  "setup.done.rotatedToken": "Rotated CLI token",
  "setup.done.replaceHint":
    "We recommend rotating the bootstrap token right away — the old one will be revoked immediately.",
  "setup.done.rotate": "Rotate bootstrap token",
  "setup.done.rotating": "Rotating…",
  "setup.done.rotated":
    "✓ The previous bootstrap token is revoked. Save the new one — it won't be shown again.",
  "setup.done.enter": "Enter the state",
  "setup.form.stateName": "State name",
  "setup.form.stateSlug": "URL slug",
  "setup.form.stateSlugHint": "Leave empty — we'll derive it from the name.",
  "setup.form.stateDesc": "Short description",
  "setup.form.stateDescPh": "A state for a developer community…",
  "setup.form.ownerHandle": "Your @handle",
  "setup.form.ownerDisplayName": "Display name",
  "setup.form.ownerDisplayNamePh": "Red Master",
  "setup.form.ownerEmail": "Email",
  "setup.form.ownerEmailHint":
    "Optional. You can attach a passkey / wallet later.",
  "setup.form.submit": "Crown the Sovereign",
  "setup.form.submitting": "Crowning…",

  "setup.nav.back": "← Back",
  "setup.nav.next": "Next →",
  "setup.step1.nav": "State",
  "setup.step1.title": "Name the state",
  "setup.step1.desc":
    "Everything starts here. Choose the name citizens will know your state by — e.g. \"Corporation X\" or \"Clan of Shadows\".",
  "setup.step2.nav": "Currency",
  "setup.step2.title": "Strike the first coin",
  "setup.step2.desc":
    "Every state decides what counts as money. This asset (StateAsset) becomes the national currency — every new citizen's wallet is opened in it by default.",
  "setup.step2.presets": "Quick presets",
  "setup.step2.symbol": "Ticker",
  "setup.step2.symbolHint": "2–12 latin letters/digits (KRN, GOLD, USD1).",
  "setup.step2.name": "Currency name",
  "setup.step2.icon": "Glyph",
  "setup.step2.iconHint": "One or two characters or emoji (⚜, ◈, 🪙).",
  "setup.step2.color": "Colour (#HEX)",
  "setup.step2.decimals": "Decimal places",
  "setup.step2.decimalsHint": "Usually 18 (ERC-20), 6 (USDC), 9 (Solana).",
  "setup.step2.preview": "Preview",
  "setup.step3.nav": "Sovereign",
  "setup.step3.title": "Crown the Sovereign",
  "setup.step3.desc":
    "The first account is granted `[*]` — absolute control over the state. You will later delegate powers to your \"ministers\" through the Vertical.",

  "setup.done.inviteTitle": "First magic-link invite",
  "setup.done.inviteDesc":
    "Hand this link to your first minister. Accepting it drops them straight into the Sovereign node with inherited powers.",
  "setup.done.inviteCode": "Code (QR)",
  "setup.done.inviteExpires": "Expires",
  "setup.done.inviteNever": "never",

  "invite.title": "Invitation to \"{stateName}\"",
  "invite.codeLabel": "Code:",
  "invite.uses": "Uses",
  "invite.expires": "Expires",
  "invite.never": "never",
  "invite.expired": "Invitation has expired",
  "invite.exhausted": "Invitation is exhausted",
  "invite.unavailable": "Invitation is unavailable",
  "invite.accept": "Accept invitation",
  "invite.acceptHint": "Acceptance will require a passkey or a wallet.",

  "nexus.eyebrow": "Nexus",
  "nexus.title": "Sovereign's Dashboard",
  "nexus.subtitle":
    "Control deck for the state. From here you see the Vertical, monetary policy and the Hall of Laws. Later every installed module will contribute its own card — Nexus will become a customizable workspace.",
  "nexus.errorHint":
    ". Check that the token belongs to the Sovereign or a holder of global permission",
  "nexus.loading": "Loading state…",
  "nexus.vertical.eyebrow": "Vertical",
  "nexus.vertical.title": "Tree of power",
  "nexus.vertical.desc":
    "Nodes, roles and ranks — the graph that distributes permissions.",
  "nexus.vertical.addNode": "Add node",
  "nexus.vertical.openTree": "Open the tree",
  "nexus.vertical.nodes": "{count} node | {count} nodes | {count} nodes",
  "nexus.vertical.citizens":
    "{count} citizen | {count} citizens | {count} citizens",
  "nexus.vertical.citizensLabel": "Citizens",
  "nexus.vertical.nodesLabel": "Nodes of power",

  "nexus.status.online": "Online",
  "nexus.status.offline": "Offline",
  "nexus.status.synchronized": "Synchronized",
  "nexus.status.syncing": "Syncing…",
  "nexus.status.uptime": "Uptime {value}",
  "nexus.status.lastSync": "Last sync {value}",

  "nexus.economy.eyebrow": "Economy",
  "nexus.economy.noCurrency": "Currency not defined",
  "nexus.economy.desc":
    "The state's monetary policy: tax rates and circulating supply.",
  "nexus.economy.stateTax": "State tax",
  "nexus.economy.stateTaxHint": "Sovereign's Decree",
  "nexus.economy.assetTax": "Asset tax",
  "nexus.economy.assetTaxHint": "Currency Factory",
  "nexus.economy.supply": "Supply in system",
  "nexus.economy.openFactory": "Currency settings",
  "nexus.economy.openConstitution": "Sovereign's Decree",
  "nexus.economy.mint": "Mint",
  "nexus.economy.mintHint":
    "Print fresh {symbol} and credit them to the root Treasury.",
  "nexus.economy.mintDisabledNoTreasury":
    "Create a root Vertical node so the Treasury exists before minting.",
  "nexus.economy.mintDisabledNoAsset":
    "Issue a primary currency in the Currency Factory first.",
  "nexus.economy.mintDisabledCantMint":
    "Minting is disabled for this asset (`canMint = false`).",

  "nexus.mint.title": "Mint {symbol}",
  "nexus.mint.desc":
    "Print new units and credit them to the root Treasury. Recorded as a {kind} transaction.",
  "nexus.mint.target": "Target",
  "nexus.mint.targetTreasury": "Root Treasury",
  "nexus.mint.amount": "Amount",
  "nexus.mint.memo": "Memo (optional)",
  "nexus.mint.memoPlaceholder": "reason for issuance",
  "nexus.mint.confirm": "Mint",
  "nexus.mint.cancel": "Cancel",
  "nexus.mint.success": "Minted {amount} {symbol}.",
  "nexus.mint.errorAmount": "Amount must be a positive number.",
  "nexus.mint.errorGeneric": "Mint failed: {message}",

  "nexus.activity.eyebrow": "Activity",
  "nexus.activity.title": "Latest events",
  "nexus.activity.desc":
    "Five most recent rows of the State Pulse — transactions, new citizens, enacted laws.",
  "nexus.activity.empty":
    "Silence for now — once modules get working, events will land here.",
  "nexus.activity.open": "Full Pulse",
  "nexus.activity.openFeed": "Open the feed",
  "nexus.activity.category.wallet": "Treasury",
  "nexus.activity.category.chat": "Chancery",
  "nexus.activity.category.governance": "Hall of Laws",
  "nexus.activity.category.state": "Decree",
  "nexus.activity.category.kernel": "Kernel",
  "nexus.activity.category.exchange": "Exchange",
  "nexus.activity.category.other": "Event",


  "nexus.governance.eyebrow": "Laws",
  "nexus.governance.title": "Latest proposals",
  "nexus.governance.desc":
    "Three most recent proposals from the Governance module with their status.",
  "nexus.governance.notInstalled.before": "Module",
  "nexus.governance.notInstalled.middle":
    "is not installed yet. Once the Sovereign plugs it in via",
  "nexus.governance.notInstalled.after":
    ", a feed of proposals will appear here.",
  "nexus.governance.empty":
    "The Hall of Laws is empty — no proposals submitted yet.",
  "nexus.governance.open": "Open the Hall",
  "nexus.governance.installHint":
    "Install the governance module to open the Hall of Laws.",
  "nexus.status.draft": "draft",
  "nexus.status.open": "open",
  "nexus.status.passed": "passed",
  "nexus.status.rejected": "rejected",
  "nexus.status.executed": "executed",
  "nexus.status.expired": "expired",
  "nexus.token.title": "Enter Nexus",
  "nexus.token.desc.before":
    "Nexus is open only to the Sovereign or a holder of the global permission",
  "nexus.token.desc.middle": ". Use a CLI token issued via",
  "nexus.token.desc.after": ".",

  "verticalEditor.eyebrow": "Vertical Builder",
  "verticalEditor.title": "Tree of power",
  "verticalEditor.subtitle":
    "Assemble your state's vertical visually. Click the «+» under a node to spawn a department or position; drag a node onto another to change its parent; select a node — the edit panel opens on the right.",
  "verticalEditor.addRoot": "Root node",
  "verticalEditor.backToNexus": "Nexus",
  "verticalEditor.empty.desc":
    "The Vertical is empty. Start with a root node — ministries and ranks will branch out from it.",
  "verticalEditor.members":
    "{count} member | {count} members | {count} members",
  "verticalEditor.type.position": "Position",
  "verticalEditor.type.department": "Department",
  "verticalEditor.type.rank": "Rank",
  "verticalEditor.type.lobby": "Lobby",
  "verticalEditor.node.addChild": "Add child node",
  "verticalEditor.node.memberCount": "Active members",
  "verticalEditor.node.noPerms": "no explicit permissions",
  "verticalEditor.node.permCount":
    "{count} permission | {count} permissions | {count} permissions",
  "verticalEditor.prompt.childTitle": "Title of the new node",
  "verticalEditor.defaults.childTitle": "New node",
  "verticalEditor.panel.eyebrow": "Edit node",
  "verticalEditor.panel.noneTitle": "Select a node",
  "verticalEditor.panel.noneDesc":
    "Click a node in the tree to edit its title, type or permissions. The «+» below a node spawns a child; dragging a node re-parents it.",
  "verticalEditor.panel.title": "Title",
  "verticalEditor.panel.type": "Node type",
  "verticalEditor.panel.permissions": "Permissions",
  "verticalEditor.panel.permsEmpty":
    "No permissions granted yet. Add a key below.",
  "verticalEditor.panel.permPlaceholder": "finance.read, chat.write, …",
  "verticalEditor.panel.permHint":
    "Canonical key in the form «<module>.<action>». Type and press Enter to add.",
  "verticalEditor.panel.permRemove": "Revoke {key}",
  "verticalEditor.panel.delete": "Delete node",
  "verticalEditor.panel.lobbyLocked":
    "The Lobby cannot be deleted — assign another default node first.",
  "verticalEditor.panel.confirmDelete":
    "Delete node «{title}»? Its children will become roots.",
  "verticalEditor.token.title": "Enter the Vertical Builder",
  "verticalEditor.token.desc.before":
    "Editing the Vertical is limited to the Sovereign or holders of",
  "verticalEditor.token.desc.middle":
    ". Use a CLI token issued via",
  "verticalEditor.token.desc.after": ".",

  "economy.eyebrow": "Currency Factory",
  "economy.title": "State economy",
  "economy.subtitle":
    "Define the national currency, configure minting, state tax and public supply. Exactly one asset of the state may be marked as the flag — that's what citizens see by default.",
  "economy.errorHint":
    ". Check that the token has the {perm} permission or that you are the Sovereign.",
  "economy.current": "Current currency:",
  "economy.decimals": "{count} decimals",
  "economy.mintOpen": "minting open",
  "economy.mintFrozen": "minting frozen",
  "economy.tax": "tax {pct}",
  "economy.supplyPublic": "supply public",
  "economy.supplyHidden": "supply hidden",
  "economy.empty": "No currencies registered yet. Create the first one below.",
  "economy.newHeader": "New currency",
  "economy.token.title": "Enter the economic contour",
  "economy.token.desc":
    "Managing currencies requires a Sovereign's CLI token (or someone with {perm}). Mint one with {cmd}.",
  "economy.asset.flag": "State flag",
  "economy.asset.promote": "Make it the state currency",
  "economy.asset.current": "Current currency",
  "economy.asset.alreadyPrimary": "This asset already is the state currency",
  "economy.asset.mint": "Minting",
  "economy.asset.mintHint": "Whether new supply can be minted.",
  "economy.asset.mintLocked":
    "Off-chain asset: the contract isn't under our control.",
  "economy.asset.taxPct": "State tax (%)",
  "economy.asset.taxHint":
    "The percentage automatically withheld into the Treasury on every transfer.",
  "economy.asset.taxNA": "Tax doesn't apply to ON_CHAIN assets.",
  "economy.asset.public": "Public",
  "economy.asset.publicHint":
    "Whether the total supply is visible to citizens (and external auditors).",
  "economy.asset.taxRange": "Tax must be in the 0..100% range.",
  "economy.form.name": "Currency name",
  "economy.form.namePh": "DurovCoin, Empire Gold, USD…",
  "economy.form.symbol": "Ticker (symbol)",
  "economy.form.symbolPh": "KRN",
  "economy.form.type": "Type",
  "economy.form.type.internal": "INTERNAL — virtual",
  "economy.form.type.onchain": "ON_CHAIN — blockchain token",
  "economy.form.mode": "Accounting mode",
  "economy.form.mode.local": "LOCAL — ledger only",
  "economy.form.mode.hybridInternal": "HYBRID — ledger + withdraw",
  "economy.form.mode.external": "EXTERNAL — pure on-chain",
  "economy.form.mode.hybridOnchain": "HYBRID — with instant accounting",
  "economy.form.network": "Network",
  "economy.form.networkPh": "ethereum, polygon, solana…",
  "economy.form.contract": "Contract address",
  "economy.form.contractPh": "0x…",
  "economy.form.taxPct": "State tax (%)",
  "economy.form.canMint": "Minting allowed",
  "economy.form.publicSupply": "Public supply",
  "economy.form.isPrimary": "Make it the national currency immediately",
  "economy.form.submit": "Register currency",
  "economy.form.submitting": "Creating…",

  "constitution.eyebrow": "Sovereign's Decree",
  "constitution.title": "State constitution",
  "constitution.subtitle":
    "Here the Sovereign sets the rules the sandbox lives by: fiscal policy, entry rules, dynamics of the Vertical. Any change applies instantly to every transfer, invite and permission check.",
  "constitution.errorHint":
    ". Editing requires a Sovereign's CLI token or a holder of {perm}.",
  "constitution.signed": "The decree is signed and in force.",
  "constitution.loading": "Loading the constitution…",
  "constitution.token.title": "Enter the Decree hall",
  "constitution.token.desc":
    "Editing the constitution requires a Sovereign's CLI token (or a holder of {perm}). Mint one with {cmd}.",
  "constitution.dirty": "Unsaved changes",
  "constitution.clean": "All fields are in sync with the DB",
  "constitution.sign": "Sign the decree",
  "constitution.signing": "Signing…",
  "constitution.signHint": "Change at least one field to sign the decree",
  "constitution.ch1.eyebrow": "Chapter I",
  "constitution.ch1.title": "Fiscal policy",
  "constitution.ch1.desc":
    "Three tax layers. The transaction tax applies to any P2P transfer. Income tax — to payouts from the treasury to personal wallets. Role tax is stored as a declaration: a cron in a later release will collect it automatically.",
  "constitution.ch1.transferTax": "Transfer tax (%)",
  "constitution.ch1.transferTaxHint":
    "Withheld from every P2P operation to the root Treasury.",
  "constitution.ch1.incomeTax": "Income tax (%)",
  "constitution.ch1.incomeTaxHint":
    "From treasury payouts to personal wallets.",
  "constitution.ch1.roleTax": "Role tax (%/mo)",
  "constitution.ch1.roleTaxHint":
    "Monthly subscription to retain a high-ranking position.",
  "constitution.ch1.display": "Currency display name",
  "constitution.ch1.displayHint":
    "Optional UI caption. The actual unit of account stays in the Currency Factory (the primary asset's ticker).",
  "constitution.ch1.displayPh": "Royal Krona",
  "constitution.ch2.eyebrow": "Chapter II",
  "constitution.ch2.title": "Entry and exit rules",
  "constitution.ch2.desc":
    "The citizenship fee fights spam. Purchasable roles turn the Vertical into a status exchange. The exit refund decides whether emigration is legitimate.",
  "constitution.ch2.citizenship": "Citizenship fee",
  "constitution.ch2.citizenshipHint":
    "In units of the primary currency. 0 = free entry.",
  "constitution.ch2.exitRefund": "Exit refund (%)",
  "constitution.ch2.exitRefundHint":
    "Share of the balance returned to emigrants.",
  "constitution.ch2.rolesPurchasable": "Roles are purchasable",
  "constitution.ch2.rolesPurchasableHint":
    "Lets a Vertical node be put up for sale.",
  "constitution.ch3.eyebrow": "Chapter III",
  "constitution.ch3.title": "Vertical dynamics",
  "constitution.ch3.desc":
    "Defines how power and transparency flow by themselves. Permission inheritance makes ministers see everything their subordinates see. Auto-promotion assigns a new position to a citizen when conditions are met.",
  "constitution.ch3.inheritance": "Permission inheritance",
  "constitution.ch3.inheritanceHint":
    "Ministers see everything their subordinates see.",
  "constitution.ch3.autoPromo": "Auto-promotion",
  "constitution.ch3.autoPromoHint":
    "Automatically moves the citizen into the target node.",
  "constitution.ch3.treasury": "Treasury transparency",
  "constitution.ch3.treasuryHint":
    "Who can see TreasuryWallet and its history.",
  "constitution.ch3.treasury.public": "Public — all citizens",
  "constitution.ch3.treasury.council": "Council — node and ancestors",
  "constitution.ch3.treasury.sovereign": "Sovereign only",
  "constitution.ch3.promoBalance": "Balance threshold",
  "constitution.ch3.promoBalanceHint":
    "Minimum funds required for auto-promotion.",
  "constitution.ch3.promoDays": "Tenure, days",
  "constitution.ch3.promoDaysHint":
    "How many days a citizen must have spent in the system.",
  "constitution.ch3.promoTarget": "Target node (id)",
  "constitution.ch3.promoTargetHint":
    "cuid of a Vertical node. Copy it from /admin/vertical.",
  "constitution.ch4.eyebrow": "Chapter IV",
  "constitution.ch4.title": "Parliament",
  "constitution.ch4.desc":
    "Turns direct democracy on or off. In \"Decree\" mode proposals stay declarative. In \"Consultation\" the Sovereign sees the tally and decides manually. In \"Auto-DAO\" successful votes update the constitution themselves — but the Sovereign's veto remains available unless disabled.",
  "constitution.ch4.mode": "Governance mode",
  "constitution.ch4.modeHint":
    "Defines whether citizens' votes affect state settings.",
  "constitution.ch4.mode.decree": "Decree — Sovereign only",
  "constitution.ch4.mode.consultation": "Consultation — manual",
  "constitution.ch4.mode.auto": "Auto-DAO — automatic",
  "constitution.ch4.veto": "Sovereign veto",
  "constitution.ch4.vetoHint":
    "Allows the Sovereign to veto any decision.",
  "constitution.ch4.weight": "Vote weight",
  "constitution.ch4.weightHint":
    "How the system counts each voter's contribution.",
  "constitution.ch4.weight.person": "One person — one vote",
  "constitution.ch4.weight.node": "By Vertical node weight",
  "constitution.ch4.weight.balance": "By primary asset balance",
  "constitution.ch4.quorum": "Quorum (%)",
  "constitution.ch4.quorumHint":
    "Minimal share of the electorate that must vote.",
  "constitution.ch4.threshold": "\"Yes\" threshold (%)",
  "constitution.ch4.thresholdHint":
    "Share of yes-votes among all cast votes.",
  "constitution.ch4.duration": "Duration, days",
  "constitution.ch4.durationHint":
    "How long a vote runs from creation to auto-close.",
  "constitution.ch4.minBalance": "Min. balance to create a proposal",
  "constitution.ch4.minBalanceHint":
    "Anti-spam: how much of the primary currency is required. Empty = unlimited.",
  "constitution.ch4.allowedTitle": "Parameters delegated to Parliament",
  "constitution.ch4.allowedDesc":
    "The checked keys may be proposed for change via {link}. Uncheck everything to keep Parliament decorative.",
  "constitution.ch4.allowedLink": "Parliament",
  "constitution.keys.transactionTaxRate": "Transfer tax",
  "constitution.keys.incomeTaxRate": "Income tax",
  "constitution.keys.roleTaxRate": "Role tax",
  "constitution.keys.currencyDisplayName": "Currency display",
  "constitution.keys.citizenshipFeeAmount": "Citizenship fee",
  "constitution.keys.rolesPurchasable": "Purchasable roles",
  "constitution.keys.exitRefundRate": "Exit refund",
  "constitution.keys.permissionInheritance": "Permission inheritance",
  "constitution.keys.autoPromotionEnabled": "Auto-promotion: on",
  "constitution.keys.autoPromotionMinBalance": "Auto-promotion: balance",
  "constitution.keys.autoPromotionMinDays": "Auto-promotion: tenure",
  "constitution.keys.autoPromotionTargetNodeId": "Auto-promotion: node",
  "constitution.keys.treasuryTransparency": "Treasury transparency",

  "styling.eyebrow": "Styling Hub",
  "styling.title": "The look of your state",
  "styling.subtitle":
    "Configure the Theme Engine: colours, typography, corner radii, effects. Every change is broadcast across the whole OS instantly — from wallet to chat.",
  "styling.saved": "Theme saved and rolled out across the state.",
  "styling.dirty": "Unsaved changes",
  "styling.clean": "Theme in sync with the database",
  "styling.save": "Sign the style decree",
  "styling.saving": "Saving…",
  "styling.revert": "Discard edits",
  "styling.reset": "Reset to Minimalist High-Tech",
  "styling.resetHint":
    "Live-rollback to the canonical KrwnOS theme (does not touch the DB).",
  "styling.errorHint":
    "Make sure your CLI token holds the \"{perm}\" permission, or that you are the Sovereign.",
  "styling.token.title": "Enter the Styling Hub",
  "styling.token.desc":
    "A CLI token with the \"{perm}\" permission is required. Mint one via `krwn token mint`.",

  "styling.presets.eyebrow": "Gallery",
  "styling.presets.title": "Theme presets",
  "styling.presets.desc":
    "Pick a starting point. Fine-tune the tokens afterwards.",
  "styling.presets.customNotice":
    "You edited the preset — the theme is now marked as \"custom\". Saving persists it in the DB under that name.",
  "styling.presets.minimal-hightech.label": "Minimalist High-Tech",
  "styling.presets.minimal-hightech.desc":
    "Fintech rigor: black canvas, golden accent, Inter.",
  "styling.presets.terminal.label": "Terminal",
  "styling.presets.terminal.desc":
    "Green CRT, monospace typography, zero radii.",
  "styling.presets.glass.label": "Glassmorphism",
  "styling.presets.glass.desc":
    "Light, translucent macOS-style aesthetics with generous radii.",
  "styling.presets.royal-gold.label": "Royal Gold",
  "styling.presets.royal-gold.desc":
    "Deep purple + gold, ceremonial Cormorant Garamond.",
  "styling.presets.cyberpunk.label": "Cyberpunk",
  "styling.presets.cyberpunk.desc":
    "Neon pink & cyan, Orbitron, glow for e-sports clans.",

  "styling.palette.eyebrow": "Palette",
  "styling.palette.title": "Colour tokens",
  "styling.palette.desc":
    "Every `--*` variable is emitted both as an HSL triple (for Tailwind) and as a raw hex (for direct CSS use).",
  "styling.palette.background": "Background",
  "styling.palette.foreground": "Foreground",
  "styling.palette.card": "Card / panels",
  "styling.palette.muted": "Muted surface",
  "styling.palette.border": "Border",
  "styling.palette.accent": "Accent",
  "styling.palette.primary": "Primary",
  "styling.palette.destructive": "Destructive",

  "styling.typography.eyebrow": "Typography",
  "styling.typography.title": "Interface fonts",
  "styling.typography.desc":
    "Changes cascade through every module — chat, wallet, admin — at once.",
  "styling.typography.sans": "Body",
  "styling.typography.mono": "Monospace",
  "styling.typography.display": "Display",
  "styling.typography.displayHint":
    "Optional — used for oversized headings. Empty = disabled.",

  "styling.shape.eyebrow": "Shape",
  "styling.shape.title": "Radii & effects",
  "styling.shape.desc":
    "Live sliders: the UI repaints while you drag.",
  "styling.shape.radiusSm": "Radius — small",
  "styling.shape.radiusMd": "Radius — medium",
  "styling.shape.radiusLg": "Radius — large",
  "styling.shape.blur": "Blur (glass)",

  "styling.preview.eyebrow": "Preview",
  "styling.preview.title": "Live showcase",
  "styling.preview.desc":
    "This is how your citizens will see the interface right now — no page reload needed.",
  "styling.preview.primary": "Sign",
  "styling.preview.outline": "Discuss",
  "styling.preview.ghost": "Cancel",
  "styling.preview.badge": "online",
  "styling.preview.cardTitle": "Module card",
  "styling.preview.cardDesc":
    "Sample text under the new font, colours, and radii.",
  "styling.preview.inputPh": "Enter an amount…",
  "styling.preview.submit": "Send",
  "styling.preview.walletEyebrow": "Personal wallet",

  "styling.custom.eyebrow": "Custom CSS",
  "styling.custom.title": "Advanced escape hatch",
  "styling.custom.desc":
    "Raw CSS injected after all tokens into `<style id=\"krwn-theme\">`. Use `var(--primary-hex)`, `var(--radius)`, `var(--font-mono)` and friends.",
  "styling.custom.hint":
    "Limit: 16 KB. `</style>` and `<script>` tags are stripped server-side.",

  "governance.eyebrow": "Parliament",
  "governance.title": "Proposal assembly",
  "governance.subtitle":
    "Here citizens propose changes to the constitution. The Sovereign picks the voting mode — Parliament may be purely advisory, or it may update the rules of the state automatically by majority.",
  "governance.filter.active": "Active",
  "governance.filter.closed": "Closed",
  "governance.filter.all": "All",
  "governance.empty.active":
    "All votes are closed — or nobody has submitted a proposal yet.",
  "governance.empty.other": "Try a different filter.",
  "governance.empty.prefix": "No proposals found.",
  "governance.flash.created": "Proposal published.",
  "governance.flash.voted": "Vote recorded.",
  "governance.flash.executed": "Decision applied.",
  "governance.flash.vetoed": "Proposal vetoed.",
  "governance.status.active": "Voting in progress",
  "governance.status.passed": "Passed",
  "governance.status.rejected": "Rejected",
  "governance.status.executed": "Executed",
  "governance.status.vetoed": "Vetoed",
  "governance.status.cancelled": "Cancelled",
  "governance.status.expired": "Expired",
  "governance.mode.decree": "Decree — changed only by the Sovereign",
  "governance.mode.consultation": "Consultation — advisory vote",
  "governance.mode.auto":
    "Auto-DAO — a passing decision applies automatically",
  "governance.mode.short.decree": "decree",
  "governance.mode.short.consultation": "consultation",
  "governance.mode.short.auto": "auto-DAO",
  "governance.rules.title": "Parliament rules",
  "governance.rules.desc":
    "A snapshot of the \"voting constitution\". Editable by the Sovereign only via {link}.",
  "governance.rules.link": "Sovereign's Decree",
  "governance.rules.mode": "Mode",
  "governance.rules.quorum": "Quorum",
  "governance.rules.quorumValue": "{pct}% of the electorate",
  "governance.rules.threshold": "Approval threshold",
  "governance.rules.thresholdValue": "{pct}% \"yes\"",
  "governance.rules.duration": "Duration",
  "governance.rules.weight": "Weight strategy",
  "governance.rules.weight.person": "one person — one vote",
  "governance.rules.weight.node": "by node weight",
  "governance.rules.weight.balance": "by wallet balance",
  "governance.rules.veto": "Sovereign veto",
  "governance.rules.allowed": "Keys allowed for proposals",
  "governance.rules.allowedEmpty":
    "The Sovereign hasn't delegated any parameter. Submitting proposals is impossible.",
  "governance.create.title": "New proposal",
  "governance.create.desc":
    "Pick a key from the Sovereign's whitelist and propose a new value. The value is coerced to the right type (number / bool / string / null) — see the hint next to the field.",
  "governance.create.name": "Title",
  "governance.create.namePh": "Lower the transfer tax to 1%",
  "governance.create.why": "Rationale",
  "governance.create.whyPh": "Why it's worth passing. What are the risks.",
  "governance.create.key": "Constitution parameter",
  "governance.create.value": "New value",
  "governance.create.submit": "Publish",
  "governance.create.submitting": "Publishing…",
  "governance.create.disabledByDecree":
    "Current mode is \"Decree\". Citizen proposals are disabled.",
  "governance.proposal.vote.for": "For",
  "governance.proposal.vote.against": "Against",
  "governance.proposal.vote.abstain": "Abstain",
  "governance.proposal.veto": "Veto",
  "governance.proposal.applyExecute": "Apply decision",
  "governance.proposal.vetoShort": "Veto",
  "governance.proposal.count.for": "For",
  "governance.proposal.count.against": "Against",
  "governance.proposal.count.abstain": "Abstained",
  "governance.proposal.count.votes": "Votes",
  "governance.proposal.tally.quorum": "Quorum",
  "governance.proposal.tally.quorumReached": "reached ({cast}/{total})",
  "governance.proposal.tally.threshold": "Threshold",
  "governance.proposal.tally.thresholdPassed": "passed",
  "governance.proposal.tally.thresholdFailed": "not reached",
  "governance.proposal.tally.forecast": "Forecast",
  "governance.proposal.tally.willPass": "will pass",
  "governance.proposal.tally.willReject": "will be rejected",
  "governance.proposal.tally.expires": "Expires",
  "governance.proposal.vetoReason": "Veto reason: {reason}",
  "governance.proposal.votesHeader": "Votes ({count})",
  "governance.proposal.vote.short.for": "for",
  "governance.proposal.vote.short.against": "against",
  "governance.token.title": "Enter Parliament",
  "governance.token.desc":
    "Voting and submitting proposals require a citizen's CLI token. Mint one with {cmd}.",
  "governance.hint.rate": "Example: 0.05 (=5%). Range 0..1.",
  "governance.hint.amount": "Integer or decimal ≥ 0. Empty → null.",
  "governance.hint.bool": "true or false",
  "governance.hint.transparency": "public | council | sovereign",
  "governance.hint.string": "String (empty → null)",
  "governance.hint.jsonFallback": "Any JSON-compatible value",
  "governance.coerce.numberNeeded": "A number is expected.",
  "governance.coerce.nonNeg": "A number ≥ 0 is expected.",
  "governance.coerce.intNonNeg": "An integer ≥ 0 is expected.",
  "governance.coerce.bool": "true or false expected.",
  "governance.coerce.transparency": "public | council | sovereign",

  "wallet.offline": "Wallet offline",
  "wallet.none": "No wallet",
  "wallet.my": "My treasury",
  "wallet.personalBalance": "Personal wallet",
  "wallet.treasury": "Node treasury",
  "wallet.transfer": "Transfer",
  "wallet.transferTitle": "Transfer Kronas",
  "wallet.transferDesc":
    "Send Kronas from your personal account or the department's budget.",
  "wallet.openTransfer": "Open transfer",
  "wallet.noOperations": "No operations yet.",
  "wallet.lastTransactions": "Recent transactions",
  "wallet.source": "Source",
  "wallet.source.personal": "Personal account",
  "wallet.source.personalModal": "Personal funds",
  "wallet.source.balance": "Balance: {amount}",
  "wallet.source.budget": "Budget: {amount}",
  "wallet.source.treasury": "Treasury: {amount}",
  "wallet.source.noTreasuries.prefix":
    "Department budgets aren't available — you need a role with the",
  "wallet.source.noTreasuries.suffix": "permission.",
  "wallet.personalOnly.prefix": "Transferring from your personal wallet. Balance:",
  "wallet.recipient": "Recipient",
  "wallet.recipient.user": "User",
  "wallet.recipient.userModal": "User (userId)",
  "wallet.recipient.treasury": "Treasury",
  "wallet.recipient.treasuryModal": "Treasury (nodeId)",
  "wallet.recipient.walletId": "Wallet ID",
  "wallet.amount": "Amount (⚜)",
  "wallet.memo": "Memo (what for)",
  "wallet.memoPh": "April salary",
  "wallet.err.amount":
    "Enter a valid amount (e.g. 100 or 100.50).",
  "wallet.err.amountModal":
    "Enter a valid amount (format: 100 or 100.50).",
  "wallet.err.insufficient": "Insufficient funds on the selected wallet.",
  "wallet.err.noRecipient": "Specify a recipient.",
  "wallet.err.serverStatus": "Server returned {status}",
  "wallet.treasuryLabel": "Treasury · {id}",
  "wallet.type.personal": "Personal",
  "wallet.type.treasury": "Treasury",
  "wallet.type.personalUpper": "PERSONAL",
  "wallet.type.treasuryUpper": "TREASURY",
  "wallet.tx.status.failed": "failed",
  "wallet.tx.status.pending": "pending",
  "wallet.tx.status.reversed": "reversed",
  "wallet.tx.mint.in": "Mint (incoming)",
  "wallet.tx.mint": "Mint",
  "wallet.tx.burn": "Burn",
  "wallet.tx.treasuryFrom": "Treasury transfer",
  "wallet.tx.treasuryOp": "Treasury operation",
  "wallet.tx.transferIn": "Incoming transfer",
  "wallet.tx.transferOut": "Outgoing transfer",

  "chat.connect.title": "Connect to chat",
  "chat.connect.desc":
    "Paste a CLI token with scopes {read}, {write} (and optionally {admin}). Mint one with {cmd}.",
  "chat.connect.submit": "Enter the channel",
  "chat.apiErr": "API error ({status}): {message}",
  "chat.empty":
    "Pick a channel on the left — or create one via `chat.admin`.",
  "chat.noMessages": "No messages yet. Be the first.",
  "chat.sidebar.channels": "Channels",
  "chat.sidebar.general": "General",
  "chat.sidebar.generalEmpty": "No public channels",
  "chat.sidebar.department": "My department",
  "chat.sidebar.departmentEmpty": "You haven't been assigned to a node yet",
  "chat.sidebar.direct": "Direct links",
  "chat.sidebar.directEmpty": "No subordinate nodes",
  "chat.sidebar.other": "Other",
  "chat.sidebar.canDirective": "You can issue directives in this channel",
  "chat.access.sovereign": "Sovereign",
  "chat.access.direct": "My department",
  "chat.access.inherited": "Supervisory",
  "chat.access.general": "General",
  "chat.sender.you": "you",
  "chat.ack.required": "Acknowledgement required.",
  "chat.ack.submit": "Acknowledge",
  "chat.ack.submitting": "...",
  "chat.composer.sendMessage":
    "Message in #{title}… (Markdown supported)",
  "chat.composer.sendDirective":
    "Directive in #{title}… (Markdown supported)",
  "chat.composer.sendAsDirective": "Send as Directive",
  "chat.composer.send": "Send",
  "chat.composer.issueDirective": "Issue directive",
  "chat.composer.errSend": "send failed",
  "chat.directive.ack": "Acknowledged",
  "chat.directive.badge": "Directive",
  "chat.directive.ackedAria": "Directive acknowledged",
  "chat.directive.badgeAria": "System directive",
  "chat.tray.items":
    "You have {count} unacknowledged {word}.",
  "chat.tray.word": "directive | directives | directives",

  // Dashboard / State Pulse (/dashboard)
  "pulse.eyebrow": "State Pulse",
  "pulse.title": "What's happening",
  "pulse.subtitle":
    "An aggregated feed of events from every module: laws, decrees, budgets, directives.",
  "pulse.filter.all": "All",
  "pulse.filter.wallet": "Treasury",
  "pulse.filter.chat": "Chat",
  "pulse.filter.governance": "Parliament",
  "pulse.filter.state": "Decrees",
  "pulse.filter.kernel": "Kernel",
  "pulse.live.connected": "Live",
  "pulse.live.offline": "Offline",
  "pulse.empty.title": "Nothing on the wire",
  "pulse.empty.body":
    "As soon as anything happens in the state, it will show up here.",
  "pulse.loadMore": "Load older",
  "pulse.noMore": "This is the dawn of the state.",
  "pulse.viewer.citizen": "Citizen",
  "pulse.viewer.sovereign": "Sovereign",
  "pulse.token.title": "Sign in to the State Pulse",
  "pulse.token.desc":
    "Paste a CLI token minted with `{cmd}`. The token stays in this browser only.",

  "pulse.event.wallet.transfer":
    "Transfer of {amount} {currency}",
  "pulse.event.wallet.treasury_allocation":
    "Treasury paid out {amount} {currency}",
  "pulse.event.wallet.mint":
    "New issuance: {amount} {currency} entered circulation",
  "pulse.event.wallet.burn":
    "Burned {amount} {currency}",
  "pulse.event.chat.channel_created": "New channel created",
  "pulse.event.chat.directive": "New directive: “{body}”",
  "pulse.event.governance.proposal_created":
    "New proposal: change “{key}”",
  "pulse.event.governance.proposal_passed":
    "Vote closed: law passed",
  "pulse.event.governance.proposal_rejected":
    "Vote closed: law rejected",
  "pulse.event.governance.proposal_expired":
    "Vote expired without a verdict",
  "pulse.event.governance.proposal_executed":
    "Law enacted: {key} → {value}",
  "pulse.event.governance.proposal_vetoed":
    "The Sovereign vetoed the proposal",
  "pulse.event.state.settings_updated":
    "Constitution updated",
  "pulse.event.kernel.state_created":
    "State was founded",
  "pulse.event.kernel.membership_granted":
    "New membership in the Vertical",
};
