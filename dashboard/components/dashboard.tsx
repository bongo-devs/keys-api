"use client";

// The one client boundary: everything under components/ is pulled into the browser bundle from here.
// State and data loading live in this file; each child is a pure(ish) view over props.

import { useCallback, useEffect, useState } from "react";
import { LayersIcon, PlusIcon } from "lucide-react";
import { api, type Guard, type Key, type Provider, Unauthorized } from "@/lib/client";
import { KeyDialog } from "./key-dialog";
import { KeyTable } from "./key-table";
import { LoginForm } from "./login-form";
import { ProviderDialog } from "./provider-dialog";
import { ProviderHeader } from "./provider-header";
import { ProviderNav } from "./provider-nav";
import { TokensPanel } from "./tokens-panel";
import { type Tab, TopBar } from "./top-bar";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { Tabs, TabsContent } from "./ui/tabs";

export default function Dashboard() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [slug, setSlug] = useState<string | null>(null);
  const [keys, setKeys] = useState<Key[]>([]);
  const [tab, setTab] = useState<Tab>("keys");
  const [error, setError] = useState("");
  const [keyDialog, setKeyDialog] = useState<{ key: Key | null } | null>(null);
  const [providerDialog, setProviderDialog] = useState<{ existing: Provider | null } | null>(null);

  /** The single 401 handler: a dead session drops to the login gate, anything else is a banner. */
  // Nothing sets state before the first await, so effects can call this without cascading renders.
  const guard: Guard = useCallback(async (fn) => {
    try {
      await fn();
      setError("");
    } catch (e) {
      if (e instanceof Unauthorized) setAuthed(false);
      else setError((e as Error).message);
    }
  }, []);

  const loadProviders = useCallback(
    () =>
      guard(async () => {
        const { providers: list } = await api<{ providers: Provider[] }>("/api/admin/providers");
        setProviders(list);
        setSlug((s) => (s && list.some((p) => p.slug === s) ? s : (list[0]?.slug ?? null)));
      }),
    [guard],
  );

  const loadKeys = useCallback(
    (s: string) => guard(async () => setKeys((await api<{ keys: Key[] }>(`/api/admin/providers/${s}/keys`)).keys)),
    [guard],
  );

  useEffect(() => {
    api("/api/admin/me").then(() => setAuthed(true), () => setAuthed(false));
  }, []);
  // guard() only touches state after its first await, but the rule can't see through the callback.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (authed) void loadProviders(); }, [authed, loadProviders]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (authed && slug) void loadKeys(slug); }, [authed, slug, loadKeys]);

  // Counts live on the provider list, so anything that touches a key refreshes both.
  const refresh = () => {
    void loadProviders();
    if (slug) void loadKeys(slug);
  };

  const removeKey = (key: Key) =>
    guard(async () => {
      if (!window.confirm(`Delete key ${key.name}?`)) return;
      await api(`/api/admin/keys/${key.id}`, { method: "DELETE" });
      refresh();
    });

  const toggleProvider = (p: Provider) =>
    guard(async () => {
      await api(`/api/admin/providers/${p.slug}`, { method: "PATCH", body: JSON.stringify({ enabled: !p.enabled }) });
      void loadProviders();
    });

  const removeProvider = (p: Provider) =>
    guard(async () => {
      if (!window.confirm(`Delete provider ${p.slug} and all ${p.total} of its keys?`)) return;
      await api(`/api/admin/providers/${p.slug}`, { method: "DELETE" });
      setSlug(null);
      void loadProviders();
    });

  const logout = () =>
    guard(async () => {
      await api("/api/admin/logout", { method: "POST" });
      setAuthed(false);
    });

  if (authed === null) return <main className="m-auto text-sm text-muted-foreground">Loading…</main>;
  if (!authed) return <main className="flex flex-1 p-4 md:p-6"><LoginForm onDone={() => setAuthed(true)} /></main>;

  const provider = providers.find((p) => p.slug === slug) ?? null;

  return (
    // The tab root spans header + panels, so the trigger list can live inside TopBar.
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="flex-1 flex-col gap-0">
      <TopBar onRefresh={refresh} onSignOut={logout} />

      {error && (
        <Alert variant="destructive" className="mx-4 mt-4 w-auto md:mx-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <TabsContent value="keys" className="flex flex-col gap-4 p-4 md:flex-row md:gap-6 md:p-6">
        <ProviderNav
          providers={providers}
          slug={slug}
          onSelect={setSlug}
          onAdd={() => setProviderDialog({ existing: null })}
        />
        <main className="min-w-0 flex-1">
          {provider ? (
            // Header and table are one object: a bordered slab, not a caption above a card.
            <section className="overflow-hidden rounded-lg border bg-card">
              <ProviderHeader
                provider={provider}
                onToggle={() => toggleProvider(provider)}
                onFields={() => setProviderDialog({ existing: provider })}
                onDelete={() => removeProvider(provider)}
                onAddKey={() => setKeyDialog({ key: null })}
              />
              <KeyTable
                provider={provider}
                keys={keys}
                onEdit={(k) => setKeyDialog({ key: k })}
                onRemove={removeKey}
                onAddKey={() => setKeyDialog({ key: null })}
              />
            </section>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <LayersIcon />
                </EmptyMedia>
                <EmptyTitle>No providers yet</EmptyTitle>
                <EmptyDescription>
                  A provider is a slug and the fields its keys carry. Add one and{" "}
                  <code className="font-mono">GET /api/&lt;slug&gt;</code> starts serving — no deploy.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={() => setProviderDialog({ existing: null })}>
                  <PlusIcon />
                  Add provider
                </Button>
              </EmptyContent>
            </Empty>
          )}
        </main>
      </TabsContent>

      <TabsContent value="tokens">
        <main className="p-4 md:p-6">
          <TokensPanel guard={guard} />
        </main>
      </TabsContent>

      {keyDialog && provider && (
        <KeyDialog
          provider={provider}
          existing={keyDialog.key}
          onClose={() => setKeyDialog(null)}
          onSaved={() => { setKeyDialog(null); refresh(); }}
        />
      )}
      {providerDialog && (
        <ProviderDialog
          existing={providerDialog.existing}
          onClose={() => setProviderDialog(null)}
          onSaved={() => { setProviderDialog(null); void loadProviders(); }}
        />
      )}
    </Tabs>
  );
}
