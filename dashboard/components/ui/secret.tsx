import { useState } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Click to reveal — secrets are live credentials, so they stay masked until asked for. */
export function Secret({ value }: { value: string }) {
  const [shown, setShown] = useState(false);
  const Icon = shown ? EyeOffIcon : EyeIcon;
  return (
    <button
      type="button"
      onClick={() => setShown(!shown)}
      className={cn(
        "group/secret flex max-w-[28ch] items-center gap-2 rounded-sm font-mono text-[13px] outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
        shown ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <span className="truncate">{shown ? value : "•".repeat(Math.min(12, value.length))}</span>
      <Icon className="size-3.5 shrink-0 opacity-50 group-hover/secret:opacity-100" aria-hidden />
      <span className="sr-only">{shown ? "Hide" : "Reveal"}</span>
    </button>
  );
}
