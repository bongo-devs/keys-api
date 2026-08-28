import type { Status } from "@/lib/client";
import { cn } from "@/lib/utils";
import { Badge } from "./badge";

// Complete class tokens, not interpolated ones, so Tailwind can see them in source.
// ok/warn are Discord's own green and yellow — the only two hues in the app that are not blurple.
const tint: Record<Status, string> = {
  working: "bg-ok/12 text-ok",
  flagged: "bg-warn/12 text-warn",
  disabled: "bg-muted text-muted-foreground",
};
const dot: Record<Status, string> = {
  working: "bg-ok",
  flagged: "bg-warn",
  disabled: "bg-muted-foreground",
};

/**
 * Read-only on purpose: status is owned by whoever is using the key, and the only way to move it is
 * PATCH /api/<provider>/<id>. Dot + word, so status never rides on colour alone.
 */
export function StatusBadge({ value }: { value: Status }) {
  return (
    <Badge variant="secondary" className={tint[value]}>
      <span className={cn("size-2 shrink-0 rounded-full", dot[value])} />
      {value}
    </Badge>
  );
}
