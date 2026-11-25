import type { ReactNode } from "react";
import { ModernShell, type ModernShellProps } from "./modern/modern-shell";

export function PickerBody({
  nav,
  shell,
  children,
}: {
  nav: ReactNode;
  shell: Omit<ModernShellProps, "children"> | null;
  children: ReactNode;
}) {
  return (
    <div
      className={`relative z-20 mx-auto flex min-h-full w-full ${
        shell ? "max-w-[1640px]" : "max-w-5xl"
      } flex-col gap-5 px-12 pb-32 pt-6`}
    >
      {nav}
      {shell ? <ModernShell {...shell}>{children}</ModernShell> : children}
    </div>
  );
}
