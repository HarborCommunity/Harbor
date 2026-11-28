import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { afterEach } from "node:test";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { act } from "react";
import { createRoot } from "react-dom/client";
import * as icons from "lucide-react";

const mounted: Array<() => void> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!();
});

function setup() {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://fixture.invalid" });
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let now = 0;
  let nextId = 0;
  Object.assign(dom.window, {
    setTimeout: (fn: () => void, ms: number) => {
      timers.push({ at: now + ms, fn, id: ++nextId });
      return nextId;
    },
    clearTimeout: (id: number) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const opened: string[] = [];
  const together: any = {
    rejoinOffer: {
      room: "ABC123",
      relayUrl: "r",
      at: 0,
      media: { id: "tt9", type: "movie", name: "Film" },
    },
    acceptRejoin: () => {},
    dismissRejoin: () => {},
    snapshot: { state: "disconnected" },
    incomingInvite: null,
  };
  const deps: Record<string, unknown> = {
    react: React,
    "react/jsx-runtime": jsx,
    "lucide-react": icons,
    "@/lib/i18n": { useT: () => (s: string) => s },
    "@/lib/together/provider": { useTogether: () => together },
    "@/lib/view": { useView: () => ({ openPicker: (meta: any) => opened.push(meta.id) }) },
  };
  const output = ts.transpileModule(
    readFileSync("src/components/together-rejoin-toast.tsx", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const module = { exports: {} as any };
  new Function("require", "module", "exports", output)(
    (name: string) => {
      assert.ok(name in deps, `unexpected dependency ${name}`);
      return deps[name];
    },
    module,
    module.exports,
  );
  const Toast = module.exports.TogetherRejoinToast;
  const root = createRoot(dom.window.document.getElementById("root")!);
  const render = (patch: Record<string, unknown> = {}) => {
    Object.assign(together, patch);
    act(() => root.render(React.createElement(Toast)));
  };
  const advance = (ms: number) => {
    now += ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers.splice(timers.indexOf(due), 1);
      act(() => due.fn());
    }
  };
  render();
  mounted.push(() => act(() => root.unmount()));
  const rejoin = () => {
    const button = [...dom.window.document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Rejoin"),
    )!;
    act(() => button.click());
  };
  return { render, advance, rejoin, opened };
}

test("a host who rejoins gets the title reopened once", () => {
  const h = setup();
  h.rejoin();
  h.render({ rejoinOffer: null, snapshot: { state: "joined" } });
  h.advance(2000);
  assert.deepEqual(h.opened, ["tt9"]);
});

test("a failed rejoin never reopens the old title later", () => {
  const h = setup();
  h.rejoin();
  h.render({ rejoinOffer: null, snapshot: { state: "error" } });
  // Much later the person joins some other room.
  h.render({ snapshot: { state: "joined" } });
  h.advance(5000);
  assert.deepEqual(h.opened, []);
});

test("when the room's invite arrives it takes over, even after it is accepted", () => {
  const h = setup();
  h.rejoin();
  h.render({ rejoinOffer: null, snapshot: { state: "joined" } });
  h.render({ incomingInvite: { from: "host" } });
  h.render({ incomingInvite: null });
  h.advance(5000);
  assert.deepEqual(h.opened, []);
});
