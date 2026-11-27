// The in-player chat panels (history, reaction picker) are non-modal, so they
// do not own Escape or Back. The player asks them to close as one step of its
// own dismissal order (after the shortcuts panel and draw mode, before leaving
// playback). The most recently opened panel closes first.
const closers: (() => void)[] = [];

export function registerChatHistoryDismiss(close: () => void): () => void {
  closers.push(close);
  return () => {
    const i = closers.lastIndexOf(close);
    if (i >= 0) closers.splice(i, 1);
  };
}

export function dismissChatHistory(): boolean {
  const close = closers.pop();
  if (!close) return false;
  close();
  return true;
}
