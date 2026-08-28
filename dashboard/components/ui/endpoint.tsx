import { cn } from "@/lib/utils";

/** A route, always monospace, always in a hairline chip: `GET /api/deezer`. */
export function Endpoint({ className, children }: React.ComponentProps<"code">) {
  return (
    <code
      className={cn(
        "inline-block rounded-md border bg-muted/60 px-2 py-0.5 font-mono text-xs whitespace-nowrap text-muted-foreground",
        className,
      )}
    >
      {children}
    </code>
  );
}
