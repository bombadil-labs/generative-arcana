import type { UserDeckManifest } from "@/decks/catalog";

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
  manifest: UserDeckManifest;
}

export async function listPublicDecks(signal?: AbortSignal): Promise<CatalogDeckSummary[]> {
  return requestJson<CatalogDeckSummary[]>("/api/decks/public", { signal });
}

export async function getSharedDeck(id: string, signal?: AbortSignal): Promise<SharedCatalogDeck> {
  return requestJson<SharedCatalogDeck>(`/api/decks/${encodeURIComponent(id)}`, { signal });
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
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

export class CatalogApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "CatalogApiError";
  }
}
