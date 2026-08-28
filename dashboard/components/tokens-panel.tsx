import { useCallback, useEffect, useState } from "react";
import { CheckIcon, CopyIcon, KeyRoundIcon, TriangleAlertIcon } from "lucide-react";
import { ago, api, type Guard, type Token } from "@/lib/client";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { Input } from "./ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

export function TokensPanel({ guard }: { guard: Guard }) {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [name, setName] = useState("");
  const [minted, setMinted] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(
    () => guard(async () => setTokens((await api<{ tokens: Token[] }>("/api/admin/tokens")).tokens)),
    [guard],
  );
  useEffect(() => void load(), [load]);

  const mint = () =>
    guard(async () => {
      const res = await api<{ token: string }>("/api/admin/tokens", { method: "POST", body: JSON.stringify({ name }) });
      setMinted(res.token); // shown once — only the sha256 is stored
      setCopied(false);
      setName("");
      await load();
    });

  const revoke = (t: Token) =>
    guard(async () => {
      if (!window.confirm(`Revoke ${t.name}? Any bot using it stops working immediately.`)) return;
      await api(`/api/admin/tokens/${t.id}`, { method: "DELETE" });
      await load();
    });

  return (
    // One slab, like a provider pool: mint row, the once-only reveal, then the list.
    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-heading text-base font-medium">Bot tokens</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            One per bot. Only a sha256 is stored, so a lost token is replaced.
          </p>
        </div>
        <div className="flex w-full gap-2 md:ml-auto md:w-auto">
          <Input
            className="flex-1 md:w-44 md:flex-none"
            placeholder="bot name"
            aria-label="Bot name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button disabled={!name} onClick={mint}>
            Mint token
          </Button>
        </div>
      </div>

      {minted && (
        // A band inside the slab rather than a card on top of it — the token belongs to this panel.
        <div className="space-y-3 border-b bg-warn/8 px-4 py-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-warn">
            <TriangleAlertIcon className="size-4" />
            Copy this now — it is never shown again
          </p>
          <code className="block rounded-md border bg-background px-3 py-2 font-mono text-xs break-all">
            {minted}
          </code>
          <div className="flex gap-2">
            {/* guard() owns the failure path, so a blocked clipboard raises the banner instead of claiming success. */}
            <Button
              size="sm"
              onClick={() => guard(async () => { await navigator.clipboard.writeText(minted); setCopied(true); })}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setMinted(null)}>
              Done
            </Button>
          </div>
        </div>
      )}

      {tokens.length === 0 ? (
        <Empty className="border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KeyRoundIcon />
            </EmptyMedia>
            <EmptyTitle>No bot tokens yet</EmptyTitle>
            <EmptyDescription>
              Name a bot above and mint one. It goes out as{" "}
              <code className="font-mono">Authorization: Bearer nunu_…</code> on every call to{" "}
              <code className="font-mono">/api/&lt;provider&gt;</code>.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-4">Name</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead className="pr-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tokens.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="pl-4 font-mono">
                  {t.name}
                  {t.revoked_at && <span className="ml-2 font-sans text-xs text-muted-foreground">revoked</span>}
                </TableCell>
                <TableCell className="text-muted-foreground">{ago(t.created_at)}</TableCell>
                <TableCell className="text-muted-foreground">{ago(t.last_used_at)}</TableCell>
                <TableCell className="pr-4 text-right">
                  {!t.revoked_at && (
                    <Button variant="destructive" size="sm" onClick={() => revoke(t)}>
                      Revoke
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
