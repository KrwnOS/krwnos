"use client";

import { useEffect } from "react";

const TOKEN_STORAGE_KEY = "krwn.token";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** Persist subscription after SW is active; no-op without VAPID or CLI token. */
async function syncPushIfPossible(reg: ServiceWorkerRegistration) {
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  if (!vapid) return;
  const token = window.localStorage.getItem(TOKEN_STORAGE_KEY);
  if (!token) return;
  if (!("PushManager" in window)) return;

  let perm = Notification.permission;
  if (perm === "default") {
    perm = await Notification.requestPermission();
  }
  if (perm !== "granted") return;

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapid) as BufferSource,
  });

  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      subscription: sub.toJSON(),
      prefs: {
        notifyDirectiveAcks: true,
        notifyProposalVotes: true,
      },
    }),
  });
  if (!res.ok) {
    console.warn("KrwnOS: push subscribe failed", res.status);
  }
}

/**
 * Registers `public/sw.js` in production builds only (avoids fighting Next.js HMR).
 * When `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is set and the user grants notifications,
 * syncs the PushSubscription to `POST /api/push/subscribe`.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((reg) =>
          navigator.serviceWorker.ready.then(() => syncPushIfPossible(reg)),
        )
        .catch(() => undefined);
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
