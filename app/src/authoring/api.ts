import type { DeckAuthoringValidation } from "@/decks/authoring";

export interface ValidateAuthoringOptions {
  includeNormalizedManifest?: boolean;
  signal?: AbortSignal;
}

/** Stateless preflight against the same server-side deck-domain validator used by host authoring tools. */
export async function validateAuthoringArtifact(
  artifact: unknown,
  options: ValidateAuthoringOptions = {},
): Promise<DeckAuthoringValidation> {
  const query = options.includeNormalizedManifest ? "?includeNormalizedManifest=true" : "";
  const response = await fetch(`/api/authoring/validate${query}`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(artifact),
    signal: options.signal,
  });
  if (!response.ok) {
    let message = `Authoring validation failed (${response.status}).`;
    try {
      const body = await response.json() as { message?: unknown };
      if (typeof body.message === "string" && body.message.trim()) message = body.message;
    } catch { /* keep transport-level message */ }
    throw new Error(message);
  }
  return await response.json() as DeckAuthoringValidation;
}
