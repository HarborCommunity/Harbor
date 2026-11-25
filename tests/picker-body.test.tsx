import assert from "node:assert/strict";
import test from "node:test";
import { FILM, renderElement } from "./helpers/picker-dom.tsx";

const { useModernPickerState } = await import("@/views/play-picker/modern/modern-state");
const { PickerBody } = await import("@/views/play-picker/picker-body");

test("the other looks have the page's column as the page has always drawn it", async () => {
  const warned: string[] = [];
  const { error } = console;
  console.error = (what: unknown) => warned.push(String(what));
  const view = await renderElement(
    <PickerBody nav={<nav />} shell={null}>
      {null}
      <p>A header</p>
      <ul />
    </PickerBody>,
  );
  try {
    assert.equal(
      document.getElementById("root")!.innerHTML,
      '<div class="relative z-20 mx-auto flex min-h-full w-full max-w-5xl flex-col gap-5 px-12 pb-32 pt-6"><nav></nav><p>A header</p><ul></ul></div>',
    );
    assert.deepEqual(warned, []);
  } finally {
    console.error = error;
    await view.unmount();
  }
});

test("Back and Refresh stand above both columns, in a page with room for them", async () => {
  function Page() {
    const state = useModernPickerState();
    const shell = {
      state,
      meta: FILM,
      streams: [],
      isCached: () => false,
      isAnime: false,
      pipelineDone: true,
      cachedOnly: false,
      onCachedOnly: () => {},
    };
    return (
      <PickerBody nav={<nav />} shell={shell}>
        <ul />
      </PickerBody>
    );
  }
  const view = await renderElement(<Page />);
  try {
    const column = document.getElementById("root")!.firstElementChild!;
    const [nav, look] = column.children;
    assert.equal(column.children.length, 2);
    assert.equal(nav.tagName, "NAV");
    assert.ok(look.querySelector("h1") && look.querySelector("ul"));
    assert.match(column.className, /(?:^| )max-w-\[1640px\](?: |$)/);
    assert.doesNotMatch(column.className, /max-w-5xl/);
  } finally {
    await view.unmount();
  }
});
