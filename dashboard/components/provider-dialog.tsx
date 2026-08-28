import { useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { api, API_URL, type Field, type Provider } from "@/lib/client";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Endpoint } from "./ui/endpoint";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

/** Add / edit a provider and its field list. This is the entire "deploy" for a new provider. */
export function ProviderDialog({ existing, onClose, onSaved }: {
  existing: Provider | null; onClose: () => void; onSaved: () => void;
}) {
  const [slug, setSlug] = useState(existing?.slug ?? "");
  const [label, setLabel] = useState(existing?.label ?? "");
  const [fields, setFields] = useState<Field[]>(existing?.fields ?? [{ name: "", secret: true, required: true }]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const patch = (i: number, f: Partial<Field>) => setFields(fields.map((old, j) => (j === i ? { ...old, ...f } : old)));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const body = JSON.stringify({ slug, label: label || slug, fields: fields.filter((f) => f.name.trim()) });
    try {
      await (existing
        ? api(`/api/admin/providers/${existing.slug}`, { method: "PATCH", body })
        : api("/api/admin/providers", { method: "POST", body }));
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{existing ? `Edit ${existing.label}` : "Add provider"}</DialogTitle>
            <DialogDescription>
              The slug is the route and the fields are what each key must carry. No deploy either way.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <Label htmlFor="provider-slug">Slug</Label>
            <Input
              id="provider-slug"
              className="font-mono"
              value={slug}
              required
              autoFocus
              disabled={!!existing}
              onChange={(e) => setSlug(e.target.value)}
            />
            <Endpoint>GET {API_URL}/api/{slug || "<slug>"}</Endpoint>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="provider-label">Label</Label>
            <Input id="provider-label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>

          <div className="grid gap-2">
            <Label>Fields a key must carry</Label>
            {fields.map((f, i) => (
              // Positional key on purpose: a field's name is blank while it is being typed.
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2">
                <Input
                  className="min-w-24 flex-1 font-mono"
                  placeholder="name"
                  aria-label={`Field ${i + 1} name`}
                  value={f.name}
                  onChange={(e) => patch(i, { name: e.target.value })}
                />
                <Input
                  className="min-w-24 flex-1"
                  placeholder="label"
                  aria-label={`Field ${i + 1} label`}
                  value={f.label ?? ""}
                  onChange={(e) => patch(i, { label: e.target.value })}
                />
                <Label htmlFor={`field-${i}-secret`} className="text-xs font-normal">
                  <Checkbox
                    id={`field-${i}-secret`}
                    checked={!!f.secret}
                    onCheckedChange={(c) => patch(i, { secret: c === true })}
                  />
                  secret
                </Label>
                <Label htmlFor={`field-${i}-required`} className="text-xs font-normal">
                  <Checkbox
                    id={`field-${i}-required`}
                    checked={!!f.required}
                    onCheckedChange={(c) => patch(i, { required: c === true })}
                  />
                  required
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="ml-auto"
                  onClick={() => setFields(fields.filter((_, j) => j !== i))}
                >
                  <XIcon />
                  <span className="sr-only">Remove {f.name || `field ${i + 1}`}</span>
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() => setFields([...fields, { name: "", secret: true }])}
            >
              <PlusIcon />
              Add field
            </Button>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={busy || !slug}>{busy ? "Saving…" : "Save provider"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
