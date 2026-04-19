/**
 * `/admin/vertical-editor` — Visual Vertical Builder.
 * ------------------------------------------------------------
 * Власть нельзя только чувствовать — её нужно видеть. This page
 * renders the State's VerticalNode hierarchy as an interactive
 * Mind Map so the Sovereign can assemble ministries and ranks
 * without ever leaving the UI.
 *
 * Capabilities
 *   * Tree view of every node in the State (React Flow).
 *   * "+" button under each node — spawn a child inline.
 *   * Drag a node onto another — re-parent it (re-attach a whole
 *     department under a different ministry).
 *   * Right-hand panel to edit title, type and the node's
 *     `permissions[]` (free-form tag list — канонические ключи
 *     приходят от модулей; здесь вводим их как теги).
 *
 * Transport: the page is a client component that talks to
 *   GET    /api/admin/vertical               — load the tree
 *   POST   /api/admin/vertical               — create a child
 *   PATCH  /api/admin/vertical/:id           — edit single node
 *   PUT    /api/admin/vertical/tree          — atomic parent/order save
 *   DELETE /api/admin/vertical/:id           — detach descendants
 *
 * Auth: bearer CLI-token from `localStorage["krwn.token"]` — same
 * convention as `/admin/nexus`, `/admin/economy`. Non-admins get
 * redirected to `/` (see handle403).
 */

"use client";

import "reactflow/dist/style.css";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeDragHandler,
  type NodeMouseHandler,
  type NodeProps,
} from "reactflow";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import {
  reparentNode,
  reorderSiblingRelative,
  type VerticalTreeNodeShape,
  type VerticalTreeValidationError,
} from "@/lib/vertical-tree";

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

type VerticalNodeType = "position" | "department" | "rank";

interface VerticalNodeDto {
  id: string;
  stateId: string;
  parentId: string | null;
  title: string;
  type: VerticalNodeType;
  permissions: string[];
  order: number;
  isLobby: boolean;
  createdAt: string;
  updatedAt: string;
}

interface TreeResponse {
  nodes: VerticalNodeDto[];
  memberCounts: Record<string, number>;
}

interface VerticalFlowNodeData {
  node: VerticalNodeDto;
  members: number;
  onAddChild: (parentId: string) => void;
  selected: boolean;
  dropMark: "ok" | "blocked" | null;
}

const TOKEN_STORAGE_KEY = "krwn.token";
const CITIZEN_FEED_PATH = "/";

const NODE_WIDTH = 240;
const NODE_HEIGHT = 112;
const H_GAP = 48;
const V_GAP = 72;

function structureSignature(nodes: readonly VerticalNodeDto[]): string {
  return [...nodes]
    .map((n) => `${n.id}\n${n.parentId ?? ""}\n${n.order}`)
    .sort()
    .join("|");
}

function toVerticalShapes(
  nodes: readonly VerticalNodeDto[],
): VerticalTreeNodeShape[] {
  return nodes.map((n) => ({
    id: n.id,
    parentId: n.parentId,
    order: n.order,
    isLobby: n.isLobby,
    createdAt: n.createdAt,
  }));
}

function mergeShapesIntoNodes(
  base: readonly VerticalNodeDto[],
  shapes: VerticalTreeNodeShape[],
): VerticalNodeDto[] {
  const byId = new Map(base.map((n) => [n.id, n]));
  return shapes.map((s) => {
    const row = byId.get(s.id);
    if (!row) throw new Error("mergeShapesIntoNodes: missing id");
    return { ...row, parentId: s.parentId, order: s.order };
  });
}

function verticalTreeErrorMessage(
  err: VerticalTreeValidationError,
  t: (key: string) => string,
): string {
  switch (err.code) {
    case "cycle":
      return t("verticalEditor.conflict.cycle");
    case "lobby_reparent":
      return t("verticalEditor.conflict.lobby");
    default:
      return t("verticalEditor.conflict.generic");
  }
}

// ------------------------------------------------------------
// Page
// ------------------------------------------------------------

export default function VerticalEditorPage() {
  return (
    <ReactFlowProvider>
      <VerticalEditorInner />
    </ReactFlowProvider>
  );
}

function VerticalEditorInner() {
  const router = useRouter();
  const { t } = useI18n();

  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<TreeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [structureDraft, setStructureDraft] = useState<
    VerticalNodeDto[] | null
  >(null);
  const [structureError, setStructureError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setToken(window.localStorage.getItem(TOKEN_STORAGE_KEY));
  }, []);

  const reload = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/vertical", {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (res.status === 403) {
        router.replace(CITIZEN_FEED_PATH);
        return;
      }
      const payload = (await res.json()) as TreeResponse | { error: string };
      if (!res.ok) {
        throw new Error(
          "error" in payload ? payload.error : `HTTP ${res.status}`,
        );
      }
      setData(payload as TreeResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [token, router]);

  useEffect(() => {
    setStructureDraft(null);
    setStructureError(null);
  }, [data]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ------------------------------------------------------------
  // Mutations
  // ------------------------------------------------------------

  const createChild = useCallback(
    async (parentId: string | null, title: string, type: VerticalNodeType) => {
      if (!token) return null;
      const res = await fetch("/api/admin/vertical", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ parentId, title, type, permissions: [] }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const payload = (await res.json()) as { node: VerticalNodeDto };
      await reload();
      setSelectedId(payload.node.id);
      return payload.node;
    },
    [token, reload],
  );

  const patchNode = useCallback(
    async (
      nodeId: string,
      patch: Partial<
        Pick<VerticalNodeDto, "title" | "type" | "permissions" | "parentId">
      >,
    ) => {
      if (!token) return;
      const res = await fetch(`/api/admin/vertical/${nodeId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await reload();
    },
    [token, reload],
  );

  const effectiveNodes = useMemo(
    () => structureDraft ?? data?.nodes ?? [],
    [structureDraft, data?.nodes],
  );

  const isStructureDirty = useMemo(() => {
    if (!data?.nodes.length || structureDraft === null) return false;
    return (
      structureSignature(structureDraft) !== structureSignature(data.nodes)
    );
  }, [data?.nodes, structureDraft]);

  const saveStructure = useCallback(async () => {
    if (!token || !structureDraft || !data) return;
    setStructureError(null);
    try {
      const res = await fetch("/api/admin/vertical/tree", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          nodes: structureDraft.map((n) => ({
            id: n.id,
            parentId: n.parentId,
            order: n.order,
          })),
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(payload.error ?? `HTTP ${res.status}`);
      }
      await reload();
    } catch (e) {
      setStructureError(e instanceof Error ? e.message : "unknown error");
    }
  }, [token, structureDraft, data, reload]);

  const discardStructure = useCallback(() => {
    setStructureDraft(null);
    setStructureError(null);
  }, []);

  const deleteNode = useCallback(
    async (nodeId: string) => {
      if (!token) return;
      const res = await fetch(`/api/admin/vertical/${nodeId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      if (selectedId === nodeId) setSelectedId(null);
      await reload();
    },
    [token, reload, selectedId],
  );

  const handleAddChild = useCallback(
    async (parentId: string | null) => {
      try {
        const title =
          typeof window !== "undefined"
            ? window.prompt(
                t("verticalEditor.prompt.childTitle"),
                t("verticalEditor.defaults.childTitle"),
              )
            : t("verticalEditor.defaults.childTitle");
        if (!title || !title.trim()) return;
        await createChild(parentId, title.trim(), "position");
      } catch (err) {
        setError(err instanceof Error ? err.message : "unknown error");
      }
    },
    [createChild, t],
  );

  // ------------------------------------------------------------
  // Token gate
  // ------------------------------------------------------------

  if (!token) {
    return (
      <Shell>
        <TokenPrompt
          onSubmit={(next) => {
            window.localStorage.setItem(TOKEN_STORAGE_KEY, next);
            setToken(next);
          }}
        />
      </Shell>
    );
  }

  const selected =
    selectedId && effectiveNodes.length
      ? effectiveNodes.find((n) => n.id === selectedId) ?? null
      : null;

  return (
    <Shell>
      <header className="mb-4 flex flex-wrap items-end justify-between gap-4 px-6">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-crown">
            {t("verticalEditor.eyebrow")}
          </p>
          <h1 className="mt-1 text-2xl font-semibold">
            {t("verticalEditor.title")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-foreground/60">
            {t("verticalEditor.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/nexus">
            <Button variant="ghost" size="sm">
              ← {t("verticalEditor.backToNexus")}
            </Button>
          </Link>
          <Button
            variant="crown"
            size="sm"
            onClick={() => void handleAddChild(null)}
          >
            + {t("verticalEditor.addRoot")}
          </Button>
          {isStructureDirty && (
            <>
              <Button
                variant="crown"
                size="sm"
                onClick={() => void saveStructure()}
              >
                {t("verticalEditor.structure.save")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={discardStructure}
              >
                {t("verticalEditor.structure.discard")}
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void reload()}
            disabled={loading}
          >
            {loading ? t("common.loadingDots") : t("common.refresh")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              window.localStorage.removeItem(TOKEN_STORAGE_KEY);
              setToken(null);
              setData(null);
            }}
          >
            {t("common.logout")}
          </Button>
        </div>
      </header>

      {(error ?? structureError) && (
        <Card className="mx-6 mb-3 border-destructive/40 bg-destructive/5 text-sm text-destructive">
          {t("common.errorWith", {
            message: [error, structureError].filter(Boolean).join(" · "),
          })}
        </Card>
      )}

      <div className="flex min-h-[640px] flex-1 gap-4 px-6 pb-6">
        <div className="relative flex-1 overflow-hidden rounded-xl border border-border/60 bg-background/40">
          {data && data.nodes.length === 0 && (
            <EmptyState onAddRoot={() => void handleAddChild(null)} />
          )}
          {data && data.nodes.length > 0 && (
            <Canvas
              tree={effectiveNodes}
              memberCounts={data.memberCounts}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onAddChild={(parentId) => void handleAddChild(parentId)}
              onCommitStructure={(next) => {
                setStructureDraft(next);
                setStructureError(null);
              }}
              onStructurePreviewError={(msg) => setStructureError(msg)}
            />
          )}
        </div>

        <aside className="w-[360px] shrink-0">
          {selected ? (
            <EditPanel
              key={selected.id}
              node={selected}
              memberCount={data?.memberCounts[selected.id] ?? 0}
              onSave={(patch) =>
                patchNode(selected.id, patch).catch((e) =>
                  setError(e instanceof Error ? e.message : "unknown error"),
                )
              }
              onDelete={() =>
                deleteNode(selected.id).catch((e) =>
                  setError(e instanceof Error ? e.message : "unknown error"),
                )
              }
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <Card className="sticky top-20 text-sm text-foreground/60">
              <CardTitle>{t("verticalEditor.panel.noneTitle")}</CardTitle>
              <CardDescription>
                {t("verticalEditor.panel.noneDesc")}
              </CardDescription>
            </Card>
          )}
        </aside>
      </div>
    </Shell>
  );
}

// ------------------------------------------------------------
// Shell
// ------------------------------------------------------------

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1400px] flex-col py-6">
      {children}
    </main>
  );
}

function EmptyState({ onAddRoot }: { onAddRoot: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-12 text-center">
      <p className="text-sm text-foreground/60">
        {t("verticalEditor.empty.desc")}
      </p>
      <Button variant="crown" size="sm" onClick={onAddRoot}>
        + {t("verticalEditor.addRoot")}
      </Button>
    </div>
  );
}

// ------------------------------------------------------------
// Canvas (React Flow)
// ------------------------------------------------------------

const nodeTypes = {
  verticalNode: VerticalFlowNode,
};

interface CanvasProps {
  tree: VerticalNodeDto[];
  memberCounts: Record<string, number>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAddChild: (parentId: string) => void;
  onCommitStructure: (next: VerticalNodeDto[]) => void;
  onStructurePreviewError: (message: string | null) => void;
}

function Canvas({
  tree,
  memberCounts,
  selectedId,
  onSelect,
  onAddChild,
  onCommitStructure,
  onStructurePreviewError,
}: CanvasProps) {
  const { t } = useI18n();
  const { getNodes } = useReactFlow();
  const positions = useMemo(() => layoutTree(tree), [tree]);
  const [hoverDrop, setHoverDrop] = useState<{
    targetId: string;
    invalid: boolean;
  } | null>(null);

  const nodes = useMemo<Node<VerticalFlowNodeData>[]>(() => {
    return tree.map((n) => ({
      id: n.id,
      type: "verticalNode",
      position: positions.get(n.id) ?? { x: 0, y: 0 },
      data: {
        node: n,
        members: memberCounts[n.id] ?? 0,
        onAddChild,
        selected: selectedId === n.id,
        dropMark:
          hoverDrop?.targetId === n.id
            ? hoverDrop.invalid
              ? "blocked"
              : "ok"
            : null,
      },
      draggable: true,
      selectable: true,
    }));
  }, [tree, memberCounts, positions, selectedId, onAddChild, hoverDrop]);

  const edges = useMemo<Edge[]>(
    () =>
      tree
        .filter((n) => n.parentId)
        .map((n) => ({
          id: `${n.parentId}->${n.id}`,
          source: n.parentId as string,
          target: n.id,
          type: "smoothstep",
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { stroke: "hsl(var(--border))", strokeWidth: 1.5 },
        })),
    [tree],
  );

  const dryRunDrop = useCallback(
    (
      draggedId: string,
      targetId: string,
      draggedPos: { x: number; y: number },
      targetPos: { x: number; y: number },
    ) => {
      const shapes = toVerticalShapes(tree);
      const dragged = shapes.find((s) => s.id === draggedId);
      const target = shapes.find((s) => s.id === targetId);
      if (!dragged || !target) return true;

      if (dragged.id === target.id) return false;

      const placeAfter =
        draggedPos.y + NODE_HEIGHT / 2 > targetPos.y + NODE_HEIGHT / 2;

      if (dragged.parentId === target.parentId) {
        const { error } = reorderSiblingRelative(
          shapes,
          draggedId,
          targetId,
          placeAfter,
        );
        return !!error;
      }
      const { error } = reparentNode(shapes, draggedId, targetId);
      return !!error;
    },
    [tree],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type !== "position") continue;

        if (change.dragging === false) {
          setHoverDrop(null);
          continue;
        }

        if (!change.dragging || !change.position) continue;

        const draggedId = change.id;
        const draggedPos = change.position;
        const live = getNodes().map((n) =>
          n.id === draggedId ? { ...n, position: draggedPos } : n,
        );
        const targetId = findOverlappingNode(draggedId, draggedPos, live);
        if (!targetId || targetId === draggedId) {
          setHoverDrop(null);
          continue;
        }
        const targetNode = live.find((n) => n.id === targetId);
        if (!targetNode) {
          setHoverDrop(null);
          continue;
        }
        const invalid = dryRunDrop(
          draggedId,
          targetId,
          draggedPos,
          targetNode.position,
        );
        setHoverDrop({ targetId, invalid });
      }
    },
    [getNodes, dryRunDrop],
  );

  const handleNodeDragStop = useCallback<NodeDragHandler>(
    (_event, draggedNode) => {
      setHoverDrop(null);
      const base = tree;
      const shapes = toVerticalShapes(base);
      const draggedId = draggedNode.id;
      const live = getNodes().map((n) =>
        n.id === draggedId ? { ...n, position: draggedNode.position } : n,
      );
      const targetId = findOverlappingNode(
        draggedId,
        draggedNode.position,
        live,
      );
      if (!targetId || targetId === draggedId) return;

      const targetNode = live.find((n) => n.id === targetId);
      if (!targetNode) return;

      const placeAfter =
        draggedNode.position.y + NODE_HEIGHT / 2 >
        targetNode.position.y + NODE_HEIGHT / 2;

      const dragged = shapes.find((s) => s.id === draggedId);
      const target = shapes.find((s) => s.id === targetId);
      if (!dragged || !target) return;

      if (dragged.id === target.id) return;

      if (dragged.parentId === target.parentId) {
        const { nodes: next, error } = reorderSiblingRelative(
          shapes,
          draggedId,
          targetId,
          placeAfter,
        );
        if (error) {
          onStructurePreviewError(verticalTreeErrorMessage(error, t));
          return;
        }
        onCommitStructure(mergeShapesIntoNodes(base, next));
        onStructurePreviewError(null);
        return;
      }

      const { nodes: next, error } = reparentNode(shapes, draggedId, targetId);
      if (error) {
        onStructurePreviewError(verticalTreeErrorMessage(error, t));
        return;
      }
      onCommitStructure(mergeShapesIntoNodes(base, next));
      onStructurePreviewError(null);
    },
    [tree, getNodes, onCommitStructure, onStructurePreviewError, t],
  );

  const handleNodeClick = useCallback<NodeMouseHandler>(
    (_e, clicked) => onSelect(clicked.id),
    [onSelect],
  );

  const handlePaneClick = useCallback(() => onSelect(null), [onSelect]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={handleNodesChange}
      onNodeDragStop={handleNodeDragStop}
      onNodeClick={handleNodeClick}
      onPaneClick={handlePaneClick}
      fitView
      minZoom={0.2}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
      className="bg-background"
    >
      <Background color="hsl(var(--border))" gap={24} />
      <Controls className="!bg-background !border-border" showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        className="!bg-background !border-border"
        maskColor="rgba(0,0,0,0.35)"
      />
    </ReactFlow>
  );
}

// ------------------------------------------------------------
// Custom node
// ------------------------------------------------------------

function VerticalFlowNode({ data }: NodeProps<VerticalFlowNodeData>) {
  const { t, tp } = useI18n();
  const { node, members, selected, onAddChild, dropMark } = data;
  return (
    <div
      className={cn(
        "relative w-[240px] rounded-xl border bg-background/95 p-3 text-left shadow-sm transition-colors",
        selected
          ? "border-crown/70 shadow-[0_0_24px_-8px_rgba(212,175,55,0.8)]"
          : "border-border/80 hover:border-crown/40",
        node.isLobby && "ring-1 ring-inset ring-crown/40",
        dropMark === "blocked" &&
          "border-destructive/80 ring-1 ring-destructive/40 shadow-[0_0_12px_-4px_rgba(220,38,38,0.5)]",
        dropMark === "ok" &&
          "border-emerald-600/70 ring-1 ring-emerald-500/30 shadow-[0_0_12px_-4px_rgba(16,185,129,0.35)]",
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="!bg-transparent !border-none"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.25em] text-foreground/50">
          {t(`verticalEditor.type.${node.type}`)}
          {node.isLobby && ` · ${t("verticalEditor.type.lobby")}`}
        </span>
        <span
          className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-foreground/60"
          title={t("verticalEditor.node.memberCount")}
        >
          {tp("verticalEditor.members", members)}
        </span>
      </div>
      <p className="mt-1 truncate text-sm font-semibold text-foreground">
        {node.title}
      </p>
      <p className="mt-0.5 text-[11px] text-foreground/50">
        {node.permissions.length === 0
          ? t("verticalEditor.node.noPerms")
          : tp("verticalEditor.node.permCount", node.permissions.length)}
      </p>
      <button
        type="button"
        className={cn(
          "nodrag nopan absolute left-1/2 top-full -translate-x-1/2 translate-y-2",
          "flex h-7 w-7 items-center justify-center rounded-full border border-crown/60 bg-background text-crown",
          "hover:bg-crown hover:text-black transition-colors shadow-sm",
        )}
        title={t("verticalEditor.node.addChild")}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onAddChild(node.id);
        }}
      >
        <span aria-hidden className="text-base leading-none">
          +
        </span>
      </button>
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="!bg-transparent !border-none"
      />
    </div>
  );
}

// ------------------------------------------------------------
// Edit panel
// ------------------------------------------------------------

interface EditPanelProps {
  node: VerticalNodeDto;
  memberCount: number;
  onSave: (
    patch: Partial<
      Pick<VerticalNodeDto, "title" | "type" | "permissions" | "parentId">
    >,
  ) => Promise<void> | void;
  onDelete: () => Promise<void> | void;
  onClose: () => void;
}

function EditPanel({
  node,
  memberCount,
  onSave,
  onDelete,
  onClose,
}: EditPanelProps) {
  const { t, tp } = useI18n();
  const [title, setTitle] = useState(node.title);
  const [type, setType] = useState<VerticalNodeType>(node.type);
  const [perms, setPerms] = useState<string[]>(node.permissions);
  const [permDraft, setPermDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(node.title);
    setType(node.type);
    setPerms(node.permissions);
    setPermDraft("");
  }, [node.id, node.title, node.type, node.permissions]);

  const dirty =
    title.trim() !== node.title ||
    type !== node.type ||
    !arraysEqual(perms, node.permissions);

  const addPerm = () => {
    const key = permDraft.trim();
    if (!key) return;
    if (!/^[a-z0-9_.*-]+$/i.test(key)) return;
    if (perms.includes(key)) return;
    setPerms([...perms, key]);
    setPermDraft("");
  };

  const removePerm = (key: string) => setPerms(perms.filter((p) => p !== key));

  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        type,
        permissions: perms,
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (node.isLobby) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        t("verticalEditor.panel.confirmDelete", { title: node.title }),
      );
      if (!ok) return;
    }
    await onDelete();
  };

  return (
    <Card className="sticky top-20 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.3em] text-crown">
            {t("verticalEditor.panel.eyebrow")}
          </p>
          <CardTitle className="mt-1 truncate">{node.title}</CardTitle>
          <CardDescription>
            {tp("verticalEditor.members", memberCount)}
            {" · "}
            <code className="text-[10px]">{node.id}</code>
          </CardDescription>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-foreground/40 hover:text-foreground"
          title={t("common.close")}
          aria-label={t("common.close")}
        >
          ✕
        </button>
      </div>

      <Field label={t("verticalEditor.panel.title")}>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
        />
      </Field>

      <Field label={t("verticalEditor.panel.type")}>
        <select
          className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
          value={type}
          onChange={(e) => setType(e.target.value as VerticalNodeType)}
        >
          <option value="position">
            {t("verticalEditor.type.position")}
          </option>
          <option value="department">
            {t("verticalEditor.type.department")}
          </option>
          <option value="rank">{t("verticalEditor.type.rank")}</option>
        </select>
      </Field>

      <Field label={t("verticalEditor.panel.permissions")}>
        <div className="flex flex-wrap gap-1.5">
          {perms.length === 0 && (
            <span className="text-xs text-foreground/40">
              {t("verticalEditor.panel.permsEmpty")}
            </span>
          )}
          {perms.map((p) => (
            <span
              key={p}
              className="inline-flex items-center gap-1 rounded-full border border-crown/40 bg-crown/10 px-2 py-0.5 text-[11px] text-crown"
            >
              <code className="font-mono">{p}</code>
              <button
                type="button"
                onClick={() => removePerm(p)}
                className="text-crown/70 hover:text-crown"
                aria-label={t("verticalEditor.panel.permRemove", { key: p })}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
        <div className="mt-2 flex gap-1">
          <Input
            value={permDraft}
            onChange={(e) => setPermDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addPerm();
              }
            }}
            placeholder={t("verticalEditor.panel.permPlaceholder")}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addPerm}
            disabled={!permDraft.trim()}
          >
            +
          </Button>
        </div>
        <p className="mt-1 text-[11px] text-foreground/50">
          {t("verticalEditor.panel.permHint")}
        </p>
      </Field>

      <div className="flex items-center justify-between gap-2 pt-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void remove()}
          disabled={node.isLobby || saving}
          className="text-destructive hover:bg-destructive/10"
          title={
            node.isLobby ? t("verticalEditor.panel.lobbyLocked") : undefined
          }
        >
          {t("verticalEditor.panel.delete")}
        </Button>
        <Button
          variant="crown"
          size="sm"
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          {saving ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-foreground/60">
        {label}
      </span>
      {children}
    </label>
  );
}

// ------------------------------------------------------------
// Token gate
// ------------------------------------------------------------

function TokenPrompt({ onSubmit }: { onSubmit: (token: string) => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  return (
    <div className="px-6">
      <Card className="mx-auto mt-24 max-w-md">
        <CardTitle>{t("verticalEditor.token.title")}</CardTitle>
        <CardDescription>
          {t("verticalEditor.token.desc.before")} <code>system.admin</code>
          {t("verticalEditor.token.desc.middle")} <code>krwn token mint</code>
          {t("verticalEditor.token.desc.after")}
        </CardDescription>
        <form
          className="mt-4 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) onSubmit(value.trim());
          }}
        >
          <Input
            placeholder="kt_…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
          <Button type="submit" variant="crown">
            {t("common.login")}
          </Button>
        </form>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------
// Layout — position every node in the canvas
// ------------------------------------------------------------

/**
 * Deterministic top-down tree layout. Each subtree reserves as
 * much horizontal space as it needs (based on leaf count); each
 * node is then centred over the middle of its children. The
 * algorithm is O(n) and runs in the browser — there is no need
 * to pull in `dagre` for the modest sizes we expect (≤ 2000 nodes).
 */
function layoutTree(
  nodes: readonly VerticalNodeDto[],
): Map<string, { x: number; y: number }> {
  const childrenByParent = new Map<string | null, VerticalNodeDto[]>();
  for (const n of nodes) {
    const key = n.parentId ?? null;
    const bucket = childrenByParent.get(key);
    if (bucket) bucket.push(n);
    else childrenByParent.set(key, [n]);
  }
  for (const bucket of childrenByParent.values()) {
    bucket.sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
  }

  const positions = new Map<string, { x: number; y: number }>();
  const stride = NODE_WIDTH + H_GAP;
  const vStride = NODE_HEIGHT + V_GAP;

  const subtreeLeaves = new Map<string, number>();
  const computeLeaves = (nodeId: string): number => {
    if (subtreeLeaves.has(nodeId)) return subtreeLeaves.get(nodeId) as number;
    const kids = childrenByParent.get(nodeId) ?? [];
    if (kids.length === 0) {
      subtreeLeaves.set(nodeId, 1);
      return 1;
    }
    let total = 0;
    for (const k of kids) total += computeLeaves(k.id);
    subtreeLeaves.set(nodeId, total);
    return total;
  };

  const place = (nodeId: string, depth: number, leftUnits: number): number => {
    const kids = childrenByParent.get(nodeId) ?? [];
    let cursor = leftUnits;
    let firstChildCentre: number | null = null;
    let lastChildCentre: number | null = null;

    if (kids.length === 0) {
      const x = leftUnits * stride;
      positions.set(nodeId, { x, y: depth * vStride });
      return leftUnits + 1;
    }

    for (const kid of kids) {
      const before = cursor;
      cursor = place(kid.id, depth + 1, cursor);
      const kidPos = positions.get(kid.id);
      if (kidPos) {
        const centre = kidPos.x + NODE_WIDTH / 2;
        if (firstChildCentre === null) firstChildCentre = centre;
        lastChildCentre = centre;
      }
      if (cursor === before) cursor = before + 1;
    }

    const centreX =
      firstChildCentre !== null && lastChildCentre !== null
        ? (firstChildCentre + lastChildCentre) / 2 - NODE_WIDTH / 2
        : leftUnits * stride;
    positions.set(nodeId, { x: centreX, y: depth * vStride });
    return cursor;
  };

  const roots = childrenByParent.get(null) ?? [];
  for (const r of roots) computeLeaves(r.id);

  let cursor = 0;
  for (const root of roots) cursor = place(root.id, 0, cursor);

  return positions;
}

/**
 * Given a dragged node's proposed position, return the id of
 * the node it visually overlaps (excluding itself). Used to
 * resolve "drop onto" re-parenting.
 */
function findOverlappingNode(
  draggedId: string,
  draggedPos: { x: number; y: number } | null,
  nodes: ReadonlyArray<Node<VerticalFlowNodeData>>,
): string | null {
  if (!draggedPos) return null;
  const cx = draggedPos.x + NODE_WIDTH / 2;
  const cy = draggedPos.y + NODE_HEIGHT / 2;
  for (const n of nodes) {
    if (n.id === draggedId) continue;
    const pos = n.position;
    if (!pos) continue;
    if (
      cx >= pos.x &&
      cx <= pos.x + NODE_WIDTH &&
      cy >= pos.y &&
      cy <= pos.y + NODE_HEIGHT
    ) {
      return n.id;
    }
  }
  return null;
}

function arraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}
