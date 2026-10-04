import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

// An icon-only button. `label` is required: it is the tooltip and what a screen reader announces.
export function IconButton({ label, icon: Icon, variant = "ghost", size = "icon-sm", className, ...props }: { label: string; icon: LucideIcon } & Omit<React.ComponentProps<typeof Button>, "children">) {
  return (
    <Button size={size} variant={variant} aria-label={label} title={label} className={className} {...props}>
      <Icon />
    </Button>
  );
}
