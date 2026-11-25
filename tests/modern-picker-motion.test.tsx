import assert from "node:assert/strict";
import test from "node:test";
import { act, pointer, renderModern, source } from "./helpers/modern-picker.tsx";

const ROW = 70;

type Glide = { row: string; frames: Keyframe[]; options: KeyframeAnimationOptions };

/**
 * jsdom lays nothing out and animates nothing, so here each row is as high as the next and stands
 * where its place in the list puts it, one that glides halfway there, and what would be animated is
 * written down.
 */
async function withLayout(
  calm: boolean,
  run: (page: {
    glides: () => Glide[];
    running: { id: string; ended: boolean }[];
  }) => Promise<void>,
) {
  const ownRect = Element.prototype.getBoundingClientRect;
  const ownMedia = window.matchMedia;
  const glides: Glide[] = [];
  const running: { id: string; ended: boolean }[] = [];
  const away = new Map<Element, number>();
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const row = this.closest("[data-row]");
    const place = row ? [...row.parentElement!.children].indexOf(row) : 0;
    const top = 400 + place * ROW + (away.get(this) ?? 0);
    return { ...ownRect.call(this), top, height: ROW } as DOMRect;
  };
  window.matchMedia = (query) =>
    ({
      matches: calm && query.includes("reduced-motion"),
      addEventListener() {},
      removeEventListener() {},
    }) as unknown as MediaQueryList;
  Object.assign(Element.prototype, {
    animate(this: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
      if (this.matches("[data-row]")) {
        const row = this.querySelector("[data-name]")!.textContent!;
        glides.push({ row, frames, options });
        running.push({ id: options.id!, ended: false });
        away.set(this, Number(/-?\d+/.exec(String(frames[0].transform))) / 2);
      }
    },
    getAnimations() {
      return running.map((animation) => ({
        id: animation.id,
        finish: () => {
          animation.ended = true;
          away.clear();
        },
      }));
    },
  });
  try {
    await run({ glides: () => glides.splice(0), running });
  } finally {
    Element.prototype.getBoundingClientRect = ownRect;
    window.matchMedia = ownMedia;
    Reflect.deleteProperty(Element.prototype, "animate");
    Reflect.deleteProperty(Element.prototype, "getAnimations");
  }
}

const three = () => [
  source("A.Film.2020.1080p-ALPHA.mkv", { size: 3e9 }),
  source("A.Film.2020.1080p-BRAVO.mkv", { size: 2e9 }),
  source("A.Film.2020.1080p-CHARLIE.mkv", { size: 9e9 }),
];
const sortBySize = () =>
  act(() =>
    [...document.querySelectorAll<HTMLButtonElement>("[data-headings] button")]
      .find((button) => button.textContent === "Size")!
      .click(),
  );
const rowsArea = () => document.querySelector("[data-rows]")!;

test("rows glide from where they stood to where they stand, and by nothing but a transform", () =>
  withLayout(false, async ({ glides }) => {
    const view = await renderModern({ streams: three() });
    try {
      assert.deepEqual(glides(), [], "nothing glides when the list opens");
      await sortBySize();
      const made = glides();
      assert.deepEqual(
        made.map(({ row, frames }) => [row, frames]),
        [
          ["CHARLIE", [{ transform: `translateY(${2 * ROW}px)` }, { transform: "none" }]],
          ["ALPHA", [{ transform: `translateY(${-ROW}px)` }, { transform: "none" }]],
          ["BRAVO", [{ transform: `translateY(${-ROW}px)` }, { transform: "none" }]],
        ],
      );
      assert.equal(made[0].options.duration, 380);
    } finally {
      await view.unmount();
    }
  }));

test("rows that stay where they are do not glide, and new ones only appear", () =>
  withLayout(false, async ({ glides }) => {
    const streams = three();
    const view = await renderModern({ streams });
    try {
      await view.rerender({
        streams: [streams[0], source("A.Film.2020.1080p-NEW.mkv"), streams[1], streams[2]],
      });
      assert.deepEqual(
        glides().map(({ row }) => row),
        ["BRAVO", "CHARLIE"],
      );
      await view.rerender({ streams: streams.map((s) => ({ ...s })), pipelineDone: false });
      glides();
      await view.rerender({ streams: streams.map((s) => ({ ...s, seeders: 5 })) });
      assert.deepEqual(glides(), [], "newer facts of the same rows move nothing");
    } finally {
      await view.unmount();
    }
  }));

test("with reduced motion no row glides", () =>
  withLayout(true, async ({ glides }) => {
    const view = await renderModern({ streams: three() });
    try {
      await sortBySize();
      assert.deepEqual(glides(), []);
    } finally {
      await view.unmount();
    }
  }));

test("more than eighty rows do not glide", () =>
  withLayout(false, async ({ glides }) => {
    for (const [count, expected] of [
      [80, 80],
      [82, 0],
    ]) {
      const streams = Array.from({ length: count }, (_, i) =>
        source(`A.Film.2020.1080p-G${i}.mkv`, { size: (i + 1) * 1e9 }),
      );
      const view = await renderModern({ streams });
      try {
        await sortBySize();
        assert.equal(glides().length, expected, `${count} rows`);
      } finally {
        await view.unmount();
      }
    }
  }));

test("pointing at the list ends what still glides and nothing else", () =>
  withLayout(false, async ({ running }) => {
    const view = await renderModern({ streams: three() });
    try {
      await sortBySize();
      running.push({ id: "", ended: false });
      await pointer("enter", rowsArea());
      assert.deepEqual(
        running.map(({ ended }) => ended),
        [true, true, true, false],
      );
    } finally {
      await view.unmount();
    }
  }));

test("a new order takes the rows over from the glide that is under way", () =>
  withLayout(false, async ({ running, glides }) => {
    const view = await renderModern({ streams: three() });
    try {
      await sortBySize();
      glides();
      await sortBySize();
      const made = glides();
      assert.deepEqual(
        running.map(({ ended }) => ended),
        [true, true, true, ...made.map(() => false)],
      );
      assert.deepEqual(
        made.map(({ row, frames }) => [row, frames[0].transform]),
        [
          ["BRAVO", `translateY(${1.5 * ROW}px)`],
          ["ALPHA", `translateY(${-0.5 * ROW}px)`],
          ["CHARLIE", `translateY(${-ROW}px)`],
        ],
        "each from where it was on its way",
      );
    } finally {
      await view.unmount();
    }
  }));
