import { KeyRoundIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { ago, type Key, type Provider } from "@/lib/client";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { Secret } from "./ui/secret";
import { StatusBadge } from "./ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

const numeric = "text-right tabular-nums";

export function KeyTable({ provider, keys, onEdit, onRemove, onAddKey }: {
  provider: Provider;
  keys: Key[];
  onEdit: (key: Key) => void;
  onRemove: (key: Key) => void;
  onAddKey: () => void;
}) {
  if (keys.length === 0)
    return (
      // Inside the provider slab, so it drops the dashed border a standalone empty state draws.
      <Empty className="border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <KeyRoundIcon />
          </EmptyMedia>
          <EmptyTitle>No {provider.label} keys yet</EmptyTitle>
          <EmptyDescription>
            <code className="font-mono">GET /api/{provider.slug}</code> answers{" "}
            <code className="font-mono">503 no_working_keys</code> until this pool has one.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={onAddKey}>
            <PlusIcon />
            Add key
          </Button>
        </EmptyContent>
      </Empty>
    );

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-4">Name</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Secrets</TableHead>
          <TableHead>Last used</TableHead>
          <TableHead className={numeric}>Uses</TableHead>
          <TableHead className={numeric}>Fails</TableHead>
          <TableHead className="pr-4" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {keys.map((k) => (
          <TableRow key={k.id}>
            <TableCell className="pl-4 align-top">
              <div className="font-medium">{k.name}</div>
              {k.note && <div className="mt-0.5 text-xs text-muted-foreground">{k.note}</div>}
            </TableCell>
            <TableCell className="align-top">
              <StatusBadge value={k.status} />
              {k.flag_reason && (
                <div className="mt-1.5 max-w-[28ch] text-xs whitespace-normal text-warn">
                  {k.flag_reason}
                </div>
              )}
            </TableCell>
            <TableCell className="align-top">
              <div className="space-y-1">
                {Object.entries(k.secrets).map(([field, value]) => (
                  <div key={field} className="flex items-baseline gap-2.5">
                    <span className="font-mono text-xs text-muted-foreground">{field}</span>
                    <Secret value={value} />
                  </div>
                ))}
              </div>
            </TableCell>
            <TableCell className="align-top text-muted-foreground">{ago(k.last_used_at)}</TableCell>
            <TableCell className={cn(numeric, "align-top", !k.use_count && "text-muted-foreground")}>
              {k.use_count}
            </TableCell>
            <TableCell className={cn(numeric, "align-top", !k.fail_count && "text-muted-foreground")}>
              {k.fail_count}
            </TableCell>
            <TableCell className="pr-4 text-right align-top">
              <div className="flex justify-end gap-1.5">
                <Button variant="ghost" size="sm" onClick={() => onEdit(k)}>
                  <PencilIcon />
                  Edit
                </Button>
                <Button variant="destructive" size="icon-sm" onClick={() => onRemove(k)}>
                  <Trash2Icon />
                  <span className="sr-only">Delete {k.name}</span>
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
