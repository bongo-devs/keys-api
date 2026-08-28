import { KeyRoundIcon, LogOutIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "./ui/button";
import { TabsList, TabsTrigger } from "./ui/tabs";

export type Tab = "keys" | "tokens";

/** The TabsList lives here but its <Tabs> root is in dashboard.tsx, since the panels are further down. */
export function TopBar({ onRefresh, onSignOut }: { onRefresh: () => void; onSignOut: () => void }) {
  return (
    // A hairline rule is the whole separation — no raised slab, no shadow.
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3 sm:gap-4 sm:px-4 md:px-6">
      <span className="flex items-center gap-2 font-mono text-sm font-semibold tracking-tight">
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
          <KeyRoundIcon className="size-4" />
        </span>
        {/* Below sm the mark carries the brand on its own — the row has no space for the word. */}
        <span className="hidden sm:inline">kyes-api</span>
      </span>
      <TabsList aria-label="Section" className="shrink-0">
        <TabsTrigger value="keys">Keys</TabsTrigger>
        <TabsTrigger value="tokens">Tokens</TabsTrigger>
      </TabsList>
      <div className="ml-auto flex items-center gap-1">
        {/* aria-label, not just the span: `hidden` drops the text out of the accessibility tree too. */}
        <Button variant="ghost" size="sm" aria-label="Refresh" onClick={onRefresh}>
          <RefreshCwIcon />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
        <Button variant="ghost" size="sm" aria-label="Sign out" onClick={onSignOut}>
          <LogOutIcon />
          <span className="hidden sm:inline">Sign out</span>
        </Button>
      </div>
    </header>
  );
}
