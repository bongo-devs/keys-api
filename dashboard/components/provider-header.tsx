import { PlusIcon, PowerIcon, Settings2Icon, Trash2Icon } from "lucide-react";
import { API_URL, type Provider } from "@/lib/client";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Endpoint } from "./ui/endpoint";

export function ProviderHeader({ provider, onToggle, onFields, onDelete, onAddKey }: {
  provider: Provider; onToggle: () => void; onFields: () => void; onDelete: () => void; onAddKey: () => void;
}) {
  return (
    // The slab's header row — dashboard.tsx owns the card, so this only draws the divider under itself.
    <div className="flex flex-wrap items-start gap-x-4 gap-y-3 border-b px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="truncate font-heading text-base font-medium">{provider.label}</h2>
          {/* The pool is parked: the GET answers 503 provider_disabled until it is switched back on. */}
          {!provider.enabled && (
            <Badge variant="secondary" className="bg-warn/12 text-warn">
              <span className="size-2 shrink-0 rounded-full bg-warn" />
              disabled
            </Badge>
          )}
        </div>
        {/* Both halves of the contract: bots take a key from the first and report on it to the second.
            API_URL-prefixed because the API is a different host now — these are meant to be copied. */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Endpoint>GET {API_URL}/api/{provider.slug}</Endpoint>
          <Endpoint>PATCH {API_URL}/api/{provider.slug}/&lt;id&gt;</Endpoint>
        </div>
      </div>
      {/* Full-width below md so four buttons wrap under the title instead of crushing it. */}
      <div className="flex w-full flex-wrap items-center gap-1.5 md:ml-auto md:w-auto">
        <Button variant="ghost" size="sm" onClick={onToggle}>
          <PowerIcon />
          {provider.enabled ? "Disable" : "Enable"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onFields}>
          <Settings2Icon />
          Fields
        </Button>
        <Button variant="destructive" size="sm" onClick={onDelete}>
          <Trash2Icon />
          Delete
        </Button>
        <Button size="sm" onClick={onAddKey}>
          <PlusIcon />
          Add key
        </Button>
      </div>
    </div>
  );
}
