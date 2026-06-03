import type { ReactNode } from "react";

import { Button } from "./button";

type DialogProps = {
  children: ReactNode;
  open: boolean;
  title: string;
  onOpenChange: (open: boolean) => void;
};

export function Dialog({ children, open, title, onOpenChange }: DialogProps) {
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={() => onOpenChange(false)}>
      <section
        aria-modal="true"
        className="dialog-panel"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog-header">
          <h2>{title}</h2>
          <Button aria-label="Close dialog" size="icon" variant="ghost" onClick={() => onOpenChange(false)}>
            <span aria-hidden="true">×</span>
          </Button>
        </header>
        {children}
      </section>
    </div>
  );
}
