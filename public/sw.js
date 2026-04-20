/**
 * KrwnOS service worker — production only (registered from the app shell).
 *
 * Offline Pulse: GET /api/state/pulse is cached per Authorization bearer token
 * (SHA-256 key) so we do not reuse one user's cached JSON for another token
 * on the same browser profile.
 *
 * Static: runtime cache for /_next/static/* (hashed assets) for offline shell.
 */
const PULSE_PATH = "/api/state/pulse";
const CACHE_STATIC = "krwn-static-v1";
const CACHE_PULSE = "krwn-pulse-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("krwn-") && k !== CACHE_STATIC && k !== CACHE_PULSE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.method === "GET" && url.pathname === PULSE_PATH) {
    const auth = event.request.headers.get("Authorization") || "";
    if (!auth.toLowerCase().startsWith("bearer ")) {
      return;
    }
    event.respondWith(networkFirstPulse(event.request));
    return;
  }

  if (
    event.request.method === "GET" &&
    url.pathname.startsWith("/_next/static/")
  ) {
    event.respondWith(networkFirstStatic(event.request, CACHE_STATIC));
  }
});

async function digestAuthHeader(request) {
  const auth = request.headers.get("Authorization") || "";
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(auth),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Synthetic cache key — Response body is still JSON from /api/state/pulse. */
async function pulseCacheRequest(request) {
  const hex = await digestAuthHeader(request);
  return new Request(new URL(`/__krwn_sw/pulse/${hex}`, self.location.origin).href, {
    method: "GET",
  });
}

async function networkFirstPulse(request) {
  const key = await pulseCacheRequest(request);
  const cache = await caches.open(CACHE_PULSE);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      await cache.put(key, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cached = await cache.match(key);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("X-Krwn-Pulse-Cache", "offline");
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers,
      });
    }
    throw new Error("offline");
  }
}

async function networkFirstStatic(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      await cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error("offline");
  }
}

// --- Web Push (payload JSON: { title, body, data }) ---
self.addEventListener("push", (event) => {
  let payload = { title: "KrwnOS", body: "", data: {} };
  try {
    const text = event.data?.text?.() ?? "";
    if (text) payload = JSON.parse(text);
  } catch {
    /* keep defaults */
  }
  const title = typeof payload.title === "string" ? payload.title : "KrwnOS";
  const body = typeof payload.body === "string" ? payload.body : "";
  const data =
    payload.data && typeof payload.data === "object" ? payload.data : {};
  const icon = "/icons/icon-192.png";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data,
      icon,
      badge: icon,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = event.notification.data && event.notification.data.url;
  const path =
    typeof raw === "string" && raw.startsWith("/") ? raw : "/dashboard";
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    self.clients.openWindow
      ? self.clients.openWindow(target)
      : Promise.resolve(),
  );
});
