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
import * as messagesLib from "../src/lib/together/chat-overlay-messages.ts";
import * as colors from "../src/lib/together/colors.ts";
import * as dismiss from "../src/lib/together/chat-history-dismiss.ts";
import * as protocol from "../src/lib/together/protocol.ts";

type Msg = { from: string; name: string; text: string; at: number };

// Always unmount, even when an assertion fails: the overlay runs an interval
// that would otherwise keep the test process alive.
const mounted: Array<() => void> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!();
});

function setup(keepHistoryOpen: boolean, messages: Msg[], forceVisible = false) {
  let props: Record<string, unknown> = {};
  const dom = new JSDOM('<div id="root"></div>', {
    url: "https://fixture.invalid",
    pretendToBeVisual: true,
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Element: dom.window.Element,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    KeyboardEvent: dom.window.KeyboardEvent,
    MouseEvent: dom.window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const settings = { togetherChatHistoryOpen: keepHistoryOpen };
  const deps: Record<string, unknown> = {
    react: React,
    "react/jsx-runtime": jsx,
    "lucide-react": icons,
    "@/lib/together/colors": colors,
    "@/lib/together/chat-overlay-messages": messagesLib,
    "@/lib/together/chat-history-dismiss": dismiss,
    "@/lib/together/protocol": protocol,
    "@/lib/together/use-self-identity": {
      useSelfIdentity: () => ({ avatar: null, color: null }),
    },
    "@/lib/i18n": { useT: () => (s: string) => s },
    "@/lib/settings": { useSettings: () => ({ settings, update: () => {} }) },
  };
  const output = ts.transpileModule(
    readFileSync(new URL("../src/components/player/chat-overlay.tsx", import.meta.url), "utf8"),
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
  const ChatOverlay = module.exports.ChatOverlay;
  const root = createRoot(dom.window.document.getElementById("root")!);
  const render = (extra: Record<string, unknown> = {}) => {
    props = { messages, onSend: () => {}, selfId: "me", participants: [], forceVisible, ...extra };
    act(() => {
      root.render(React.createElement(ChatOverlay, props));
    });
  };
  render();
  let done = false;
  const unmount = () => {
    if (done) return;
    done = true;
    act(() => root.unmount());
  };
  mounted.push(unmount);
  const doc = dom.window.document;
  return {
    doc,
    historyButton: () => doc.querySelector<HTMLButtonElement>('[aria-label="Chat history"]'),
    overlay: () => doc.getElementById("root")!.firstElementChild as HTMLElement,
    rerender: (extra: Record<string, unknown>) => render({ ...props, ...extra }),
    unmount,
  };
}

const now = Date.now();
const older: Msg[] = [
  { from: "a", name: "Aman", text: "first", at: now - 10 * 60_000 },
  { from: "b", name: "Simran", text: "second", at: now - 9 * 60_000 },
];

test("the history opens on click and is the player's next Escape/Back step", () => {
  const ui = setup(false, older);
  assert.equal(ui.doc.body.textContent?.includes("first"), false);
  assert.equal(dismiss.dismissChatHistory(), false, "nothing to dismiss while closed");

  act(() => ui.historyButton()!.click());
  assert.equal(ui.historyButton()!.getAttribute("aria-pressed"), "true");
  assert.ok(ui.doc.body.textContent?.includes("first"));

  let handled = false;
  act(() => {
    handled = dismiss.dismissChatHistory();
  });
  assert.equal(handled, true, "the player's Escape/Back closes the history first");
  assert.equal(ui.historyButton()!.getAttribute("aria-pressed"), "false");
  assert.equal(dismiss.dismissChatHistory(), false, "the next Escape/Back reaches the player");
  ui.unmount();
});

test("keeping the history open never swallows the player's Escape or Back", () => {
  const ui = setup(true, older);
  assert.equal(ui.historyButton()!.getAttribute("aria-pressed"), "true");
  assert.ok(ui.doc.body.textContent?.includes("first"));
  assert.equal(dismiss.dismissChatHistory(), false);
  ui.unmount();
});

test("unmounting with the history open leaves nothing registered", () => {
  const ui = setup(false, older);
  act(() => ui.historyButton()!.click());
  ui.unmount();
  assert.equal(dismiss.dismissChatHistory(), false);
});

test("keeping the history open does not pin an empty overlay over the video", () => {
  const ui = setup(true, []);
  assert.ok(ui.overlay().className.includes("opacity-0"));
  ui.unmount();
});

test("a hidden overlay does not take the player's Escape/Back step", () => {
  const ui = setup(false, older);
  act(() => ui.historyButton()!.click());
  ui.rerender({ hidden: true });
  assert.equal(dismiss.dismissChatHistory(), false, "Escape/Back goes to the player");
  ui.rerender({ hidden: false });
  let handled = false;
  act(() => {
    handled = dismiss.dismissChatHistory();
  });
  assert.equal(handled, true, "showing the overlay again restores the step");
  ui.unmount();
});

test("the reaction row sends one tap each, closes with Escape/Back and stays hidden without relay support", () => {
  const sent: string[] = [];
  const ui = setup(false, older);
  assert.equal(ui.doc.querySelector('[aria-label="React"]'), null, "no relay support, no button");
  ui.rerender({ onReact: (e: string) => sent.push(e) });
  const open = ui.doc.querySelector<HTMLButtonElement>('[aria-label="React"]')!;
  act(() => open.click());
  assert.equal(open.getAttribute("aria-expanded"), "true");
  const reaction = (emoji: string) =>
    [...ui.doc.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === emoji) ??
    null;
  const fire = reaction("🔥")!;
  act(() => fire.click());
  act(() => fire.click());
  assert.deepEqual(sent, ["🔥", "🔥"]);
  let handled = false;
  act(() => {
    handled = dismiss.dismissChatHistory();
  });
  assert.equal(handled, true);
  assert.equal(reaction("🔥"), null);
  assert.equal(dismiss.dismissChatHistory(), false);
  ui.unmount();
});

test("Space and the arrows on the reaction row stay in the row instead of reaching the player", () => {
  const sent: string[] = [];
  const ui = setup(false, older);
  ui.rerender({ onReact: (e: string) => sent.push(e) });
  const playerKeys: string[] = [];
  const onWindowKey = (e: KeyboardEvent) => playerKeys.push(e.key);
  ui.doc.defaultView!.addEventListener("keydown", onWindowKey);
  try {
    act(() => ui.doc.querySelector<HTMLButtonElement>('[aria-label="React"]')!.click());
    const row = [...ui.doc.querySelectorAll("button")].filter((b) =>
      protocol.REACTION_EMOJI.includes(b.getAttribute("aria-label") as never),
    );
    const press = (key: string) =>
      act(() => {
        (ui.doc.activeElement as HTMLElement).dispatchEvent(
          new ui.doc.defaultView!.KeyboardEvent("keydown", {
            key,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    row[0].focus();
    press("ArrowRight");
    assert.equal(ui.doc.activeElement, row[1]);
    press("End");
    assert.equal(ui.doc.activeElement, row.at(-1));
    press("ArrowRight");
    assert.equal(ui.doc.activeElement, row.at(-1), "the last one stays put");
    press("Home");
    assert.equal(ui.doc.activeElement, row[0]);
    press(" ");
    assert.deepEqual(playerKeys, [], "the player never saw Space or the arrows");
    press("t");
    assert.deepEqual(playerKeys, ["t"], "other keys still reach the player");
  } finally {
    ui.doc.defaultView!.removeEventListener("keydown", onWindowKey);
    ui.unmount();
  }
});
