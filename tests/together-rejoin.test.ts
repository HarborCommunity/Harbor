import assert from "node:assert/strict";
import test from "node:test";
import {
  REJOIN_WINDOW_MS,
  clearSavedRoom,
  loadRecentRoom,
  saveRoom,
} from "../src/lib/together/rejoin.ts";

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
};

const state = {
  mediaId: "tt9",
  mediaTitle: "Show",
  episode: { season: 1, episode: 2 },
  posterUrl: null,
  positionSeconds: 10,
  playing: true,
  updatedAt: 0,
  updatedBy: "host",
  hostClientId: "host",
};

test("a recent room on the same relay is offered with what it was watching", () => {
  saveRoom("wss://relay", "ABC123", state);
  const saved = loadRecentRoom("wss://relay");
  assert.equal(saved?.room, "ABC123");
  assert.deepEqual(saved?.media, {
    id: "tt9",
    type: "series",
    name: "Show",
    episode: { season: 1, episode: 2 },
  });
});

test("old rooms, other relays and deliberate leaves are not offered", () => {
  saveRoom("wss://relay", "ABC123", null);
  assert.equal(loadRecentRoom("wss://other"), null);
  assert.equal(loadRecentRoom("wss://relay", Date.now() + REJOIN_WINDOW_MS + 1), null);
  clearSavedRoom();
  assert.equal(loadRecentRoom("wss://relay"), null);
});
