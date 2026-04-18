/**
 * Tiny HTTP client used by every command.
 */
export async function call(profile, path, { method = "GET", body, query } = {}) {
  const url = new URL(path, profile.host);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v == null) continue;
      url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${profile.token}`,
      "content-type": "application/json",
      "user-agent": "krwn-cli/0.1",
    },
    body: body == null ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    const detail =
      data && typeof data === "object" && "error" in data ? data.error : text;
    throw new Error(
      `HTTP ${res.status} ${res.statusText}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`,
    );
  }

  return data;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
