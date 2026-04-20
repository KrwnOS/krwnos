"use client";

import { type RefObject, useEffect, useRef } from "react";

const TABBABLE_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function tabbableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR),
  ).filter((el) => {
    if (el.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return el.getClientRects().length > 0;
  });
}

export interface UseFocusTrapOptions {
  /** @default true */
  restoreFocus?: boolean;
  /** @default true */
  lockBodyScroll?: boolean;
  onEscape?: () => void;
}

/**
 * Keeps keyboard focus inside `rootRef` while `active`, restores the
 * previously focused element on deactivate, and optionally locks body scroll.
 */
export function useFocusTrap(
  active: boolean,
  rootRef: RefObject<HTMLElement | null>,
  options?: UseFocusTrapOptions,
): void {
  const restoreFocus = options?.restoreFocus ?? true;
  const lockBodyScroll = options?.lockBodyScroll ?? true;
  const onEscapeRef = useRef(options?.onEscape);
  onEscapeRef.current = options?.onEscape;

  useEffect(() => {
    if (!active) return;
    const root = rootRef.current;
    if (!root) return;

    const previous = document.activeElement as HTMLElement | null;
    let addedTabIndex = false;
    let raf = 0;

    const focusInitial = () => {
      const nodes = tabbableIn(root);
      const firstNode = nodes[0];
      if (firstNode) {
        firstNode.focus();
        return;
      }
      if (!root.hasAttribute("tabindex")) {
        root.setAttribute("tabindex", "-1");
        addedTabIndex = true;
      }
      root.focus();
    };

    raf = window.requestAnimationFrame(focusInitial);

    const prevOverflow = document.body.style.overflow;
    if (lockBodyScroll) {
      document.body.style.overflow = "hidden";
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onEscapeRef.current) {
        e.preventDefault();
        onEscapeRef.current();
        return;
      }
      if (e.key !== "Tab") return;

      const nodes = tabbableIn(root);
      if (nodes.length === 0) return;

      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) return;

      const cur = document.activeElement as HTMLElement | null;

      if (!cur || !root.contains(cur)) {
        e.preventDefault();
        first.focus();
        return;
      }

      if (e.shiftKey) {
        if (cur === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (cur === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      window.cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown, true);
      if (lockBodyScroll) {
        document.body.style.overflow = prevOverflow;
      }
      if (addedTabIndex) {
        root.removeAttribute("tabindex");
      }
      if (restoreFocus && previous && document.contains(previous)) {
        previous.focus();
      }
    };
  }, [active, rootRef, restoreFocus, lockBodyScroll]);
}
