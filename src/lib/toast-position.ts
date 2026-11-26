export const TOAST_POSITIONS = ["center", "top", "top-left", "top-right"] as const;

export type ToastPosition = (typeof TOAST_POSITIONS)[number];
