import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { NeonArtworkRepository } from "../src/neonArtworkRepository";
import { ArtworkError, type ArtworkRecord } from "../src/cardArtwork";
import { neutralManifest } from "./protocol-fixtures";

const db = new PGlite();
try {
  await db.exec(await readFile(new URL("../migrations/001-domain.sql", import.meta.url), "utf8"));
  const migration = await readFile(new URL("../migrations/002-card-artwork.sql", import.meta.url), "utf8");
  await db.exec(migration); await db.exec(migration);
  await db.query("INSERT INTO arcana_user_decks(id,owner_id,slug,manifest) VALUES($1,$2,$3,$4::jsonb)", ["deck", "alice", "test", JSON.stringify(neutralManifest())]);
  // PGlite has one connection. Queue connection leases to model a one-slot pg pool faithfully.
  let tail: Promise<void> = Promise.resolve();
  const statements: string[] = [];
  const query = async (sql: string, values?: unknown[]) => { statements.push(sql); return db.query(sql, values); };
  const pool = { query, async connect() { const before = tail; let release!: () => void; tail = new Promise<void>(resolve => { release = resolve; }); await before; return { query, release }; } };
  const repository = new NeonArtworkRepository(pool as unknown as Pick<Pool, "query" | "connect">);
  const record = (): ArtworkRecord => ({ id: randomUUID(), deckId: "deck", cardSlug: "major-0", objectKey: `card-artwork/${randomUUID()}.webp`, mediaType: "image/webp", width: 32, height: 48, byteLength: 100, integrity: "sha256-test", createdAt: new Date().toISOString() });
  const first = record();
  const fails = (expected: number) => (error: unknown) => error instanceof ArtworkError && error.status === expected;
  await assert.rejects(repository.attach("bob", 1, null, first), fails(404));
  await assert.rejects(repository.attach("alice", 2, null, first), fails(409));
  await assert.rejects(repository.attach("alice", 1, null, { ...first, cardSlug: "not-a-card" }), fails(404));
  assert.equal(await repository.attach("alice", 1, null, first), null);
  assert.deepEqual(await repository.get("deck", "major-0"), first);
  assert.deepEqual(await repository.list("deck"), [first]);
  const changes = await Promise.allSettled([repository.attach("alice", 1, first.id, record()), repository.attach("alice", 1, first.id, record())]);
  assert.equal(changes.filter(result => result.status === "fulfilled").length, 1);
  assert.ok(statements.some(sql => /arcana_user_decks.*FOR UPDATE/.test(sql)), "attachment locks deck against deletion/revision races");
  const current = await repository.get("deck", "major-0");
  await db.query("UPDATE arcana_user_decks SET revision=2 WHERE id='deck'");
  await assert.rejects(repository.attach("alice", 1, current!.id, record()), fails(409));
  await db.query("UPDATE arcana_user_decks SET manifest=jsonb_set(manifest, '{data,cards}', '{}'::jsonb) WHERE id='deck'");
  await assert.rejects(repository.attach("alice", 2, current!.id, record()), fails(404));
  await db.query("DELETE FROM arcana_user_decks WHERE id='deck'");
  assert.equal(await repository.get("deck", "major-0"), null, "FK cascades metadata deletion");
  await assert.rejects(repository.attach("alice", 2, null, record()), fails(404));
  console.log("Artwork additive migration and atomic attachment tests passed (PostgreSQL/PGlite).");
} finally { await db.close(); }
