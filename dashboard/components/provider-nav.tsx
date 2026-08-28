import { PlusIcon } from "lucide-react";
import type { Provider } from "@/lib/client";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

/** working/total per provider, so an emptying pool is visible without opening it. */
export function ProviderNav({ providers, slug, onSelect, onAdd }: {
  providers: Provider[]; slug: string | null; onSelect: (slug: string) => void; onAdd: () => void;
}) {
  return (
    // A left rail from md up, a sideways-scrolling strip of chips below it — no card, no shadow.
    <aside className="shrink-0 md:w-56 md:self-start">
      <p className="hidden px-2.5 pb-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase md:block">
        Providers
      </p>
      <nav aria-label="Providers" className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:gap-0.5 md:pb-0">
        {providers.map((p) => (
          <button
            key={p.slug}
            onClick={() => onSelect(p.slug)}
            aria-current={p.slug === slug ? "page" : undefined}
            title={p.enabled ? `${p.working} working of ${p.total}` : "Provider disabled"}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 md:w-full",
              // Selected sits one surface step above hover, so the two never read as the same row.
              p.slug === slug
                ? "bg-secondary font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <span className={cn("truncate md:flex-1", !p.enabled && "line-through")}>{p.label}</span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {p.working}/{p.total}
            </span>
          </button>
        ))}
      </nav>
      <Button variant="outline" size="sm" className="mt-2 w-full" onClick={onAdd}>
        <PlusIcon />
        Provider
      </Button>
    </aside>
  );
}
