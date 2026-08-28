import { useState } from "react";
import { api, type Key, type Provider } from "@/lib/client";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

/** Every input comes from provider.fields — that is why adding a provider needs no code here. */
export function KeyDialog({ provider, existing, onClose, onSaved }: {
  provider: Provider; existing: Key | null; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [secrets, setSecrets] = useState<Record<string, string>>(existing?.secrets ?? {});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    // Blank fields are dropped rather than stored as "": an empty ARL is worse than an absent one.
    const filled = Object.fromEntries(Object.entries(secrets).filter(([, v]) => v.trim()));
    const body = JSON.stringify({ name, note, secrets: filled });
    try {
      await (existing
        ? api(`/api/admin/keys/${existing.id}`, { method: "PATCH", body })
        : api(`/api/admin/providers/${provider.slug}/keys`, { method: "POST", body }));
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{existing ? `Edit ${existing.name}` : `Add ${provider.label} key`}</DialogTitle>
            <DialogDescription>
              Status is not set here — a bot moves it with <code className="font-mono">PATCH /api/{provider.slug}/&lt;id&gt;</code>.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <Label htmlFor="key-name">Name</Label>
            <Input id="key-name" value={name} required autoFocus onChange={(e) => setName(e.target.value)} />
          </div>

          {provider.fields.length === 0 && (
            <p className="text-sm text-warn">
              This provider has no fields yet — edit the provider to add some.
            </p>
          )}

          {provider.fields.map((f) => (
            <div key={f.name} className="grid gap-1.5">
              <Label htmlFor={`key-field-${f.name}`}>
                {f.label ?? f.name}
                {f.required && <span aria-hidden> *</span>}
              </Label>
              <Textarea
                id={`key-field-${f.name}`}
                className="min-h-14 font-mono text-xs"
                rows={2}
                required={f.required}
                value={secrets[f.name] ?? ""}
                onChange={(e) => setSecrets({ ...secrets, [f.name]: e.target.value })}
              />
            </div>
          ))}

          <div className="grid gap-1.5">
            <Label htmlFor="key-note">Note</Label>
            <Input id="key-note" value={note} onChange={(e) => setNote(e.target.value)} />
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
            <Button disabled={busy || !name}>{busy ? "Saving…" : "Save key"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
