import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/utils";

export function SegmentedControl({ children }: { children: ReactNode }) {
  return <div className="segmented">{children}</div>;
}

type SegmentButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
};

export function SegmentButton({ active, className, ...props }: SegmentButtonProps) {
  return <button className={cn("segment", active && "active", className)} {...props} />;
}
