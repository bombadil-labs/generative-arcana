import type { DeckManifest } from "@/decks/manifest";

export interface CatalogDeckSummary {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  visibility: "private" | "unlisted" | "public";
  revision: number;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

export interface SharedCatalogDeck extends CatalogDeckSummary {
  manifest: DeckManifest;
}

export type ImportMyDeckRequest =
  | { manifest: unknown; replaceExisting?: boolean }
  | { data: unknown; tagline?: string; spreads?: unknown[]; replaceExisting?: boolean };

export async function listPublicDecks(signal?: AbortSignal): Promise<CatalogDeckSummary[]> {
  return requestJson<CatalogDeckSummary[]>("/api/decks/public", { signal });
}

export async function getSharedDeck(id: string, signal?: AbortSignal): Promise<SharedCatalogDeck> {
  return requestJson<SharedCatalogDeck>(`/api/decks/${encodeURIComponent(id)}`, { signal });
}

export async function listMyDecks(signal?: AbortSignal): Promise<CatalogDeckSummary[]> {
  return requestJson<CatalogDeckSummary[]>("/api/me/decks", { signal, credentials: "same-origin" });
}

export async function importMyDeck(input: ImportMyDeckRequest): Promise<CatalogDeckSummary> {
  return requestJson<CatalogDeckSummary>("/api/me/decks", jsonRequest("POST", input));
}

export async function setMyDeckVisibility(
  id: string,
  visibility: CatalogDeckSummary["visibility"],
): Promise<CatalogDeckSummary> {
  return requestJson<CatalogDeckSummary>(`/api/me/decks/${encodeURIComponent(id)}`, jsonRequest("PATCH", { visibility }));
}

export async function deleteMyDeck(id: string): Promise<{ id: string; deleted: true }> {
  return requestJson<{ id: string; deleted: true }>(`/api/me/decks/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
}

/** Accept the canonical manifest directly while preserving raw deck JSON as a compatibility path. */
export function importRequestFromJson(value: unknown, replaceExisting = false): ImportMyDeckRequest {
  if (isRecord(value) && isRecord(value.data) && typeof value.tagline === "string") {
    if (value.spreads !== undefined && !Array.isArray(value.spreads)) {
      throw new Error("Manifest spreads must be an array when provided.");
    }
    return {
      manifest: value,
      ...(replaceExisting ? { replaceExisting: true } : {}),
    };
  }
  return { data: value, ...(replaceExisting ? { replaceExisting: true } : {}) };
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: "same-origin",
    ...init,
    headers: { accept: "application/json", ...init?.headers },
  });
  if (!response.ok) {
    let message = response.status === 404 ? "Deck not found." : `Request failed (${response.status}).`;
    try {
      const body = await response.json() as { message?: unknown };
      if (typeof body.message === "string" && body.message.trim()) message = body.message;
    } catch { /* keep transport-level message */ }
    throw new CatalogApiError(response.status, message);
  }
  return await response.json() as T;
}

function jsonRequest(method: "POST" | "PATCH", body: unknown): RequestInit {
  return {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export class CatalogApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "CatalogApiError";
  }
}
