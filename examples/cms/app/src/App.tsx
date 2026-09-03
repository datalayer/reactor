/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * A CMS whose every feature arrived from a Python package.
 *
 * The application owns three things and no more: the document, the three
 * contribution points, and how each of them is drawn. It contains no markdown
 * tools, no content types and no publish rules — those are plugins, and this
 * file does not name one of them.
 *
 * The hierarchy the example exists to make concrete:
 *
 *     Python package  →  Extension  →  Plugin  →  Contribution  →  Point
 *     cms                Core          Gallery    a content type   cms.contentType
 *     cms-pro            Pro           Product    a content type   cms.contentType
 *
 * Packaging and licensing sit at the top of that chain; the extension mechanism
 * sits at the bottom. Nothing in between knows which package paid for what,
 * which is why the free and paid packages can fill the *same* point.
 */

import React, { useMemo, useState, useSyncExternalStore } from "react";
import {
  buildReactorFromPlugins,
  type LazyPluginRef,
  type ReactorExtension,
} from "@datalayer/reactor";
import { CommandsPlugin } from "@datalayer/reactor-commands";
// By path, not from the main barrel — see the music example for why.
import { ThemePlugin } from "@datalayer/primer-addons/lib/reactor";

import { CmsCommandsPlugin } from "./commands";
import { docStore } from "./docStore";
import {
  ReactorSlot,
  useContributions,
  usePluginManifests,
  useReactor,
} from "@datalayer/reactor/react";
import { FileText, Package, Rocket, Sparkles } from "lucide-react";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  Separator,
  Textarea,
} from "./ui";
import {
  ContentTypes,
  EditorToolbar,
  PublishLifecycle,
  type Doc,
} from "./points";

/** The toolbar: every contribution is drawn, and the application chooses none. */
function Toolbar({
  doc,
  onChange,
}: {
  doc: Doc;
  onChange: (doc: Doc) => void;
}) {
  const tools = useContributions(EditorToolbar);

  if (tools.length === 0) {
    return <Empty>No editor tools are installed.</Empty>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {tools.map((tool) => (
        <Button
          key={tool.id}
          variant="outline"
          size="sm"
          title={`${tool.value.hint ?? ""} — from ${tool.plugin}`}
          onClick={() => onChange({ ...doc, body: tool.value.run(doc.body) })}
        >
          {tool.value.label}
        </Button>
      ))}
    </div>
  );
}

/** Content types: the application draws a chooser and shows exactly one. */
function ContentTypePicker({
  doc,
  onChange,
}: {
  doc: Doc;
  onChange: (doc: Doc) => void;
}) {
  const types = useContributions(ContentTypes);
  const active =
    types.find((entry) => entry.value.id === doc.contentType) ?? types[0];

  if (types.length === 0) {
    return (
      <Empty>
        No content types are installed — there is nothing to author.
      </Empty>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {types.map((entry) => (
          <Button
            key={entry.id}
            size="sm"
            variant={entry.id === active?.id ? "default" : "outline"}
            onClick={() =>
              onChange({
                ...doc,
                contentType: entry.value.id,
                body: entry.value.template,
              })
            }
          >
            {entry.value.label}
          </Button>
        ))}
      </div>
      {active ? (
        <p className="text-xs text-muted-foreground">
          {active.value.description}{" "}
          <span className="opacity-70">— contributed by {active.plugin}</span>
        </p>
      ) : null}
      {active?.value.fields?.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {active.value.fields.map((field) => (
            <input
              key={field.name}
              placeholder={field.placeholder}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Publish: every contribution runs, and any one of them can stop it. */
function Publish({ doc }: { doc: Doc }) {
  const steps = useContributions(PublishLifecycle);
  const [results, setResults] = useState<
    { label: string; ok: boolean; message: string }[]
  >([]);
  const [published, setPublished] = useState(false);

  const publish = () => {
    const outcome = steps.map((step) => ({
      label: step.value.label,
      ...step.value.run(doc),
    }));
    setResults(outcome);
    setPublished(outcome.every((entry) => entry.ok));
  };

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2">
        <Button onClick={publish} disabled={steps.length === 0}>
          <Rocket size={14} /> Publish
        </Button>
        <span className="text-xs text-muted-foreground">
          {steps.length} step{steps.length === 1 ? "" : "s"} in the lifecycle
        </span>
      </div>
      {steps.length === 0 ? (
        <Empty>
          Nothing runs on publish. Install a plugin that fills this point.
        </Empty>
      ) : null}
      {results.length > 0 ? (
        <div className="grid gap-1.5">
          {results.map((result) => (
            <div
              key={result.label}
              className="flex items-baseline gap-2 text-xs"
            >
              <Badge variant={result.ok ? "success" : "destructive"}>
                {result.ok ? "ok" : "blocked"}
              </Badge>
              <span className="font-medium">{result.label}</span>
              <span className="text-muted-foreground">{result.message}</span>
            </div>
          ))}
          <p className="pt-1 text-xs">
            {published
              ? "🎉 Published."
              : "⛔ Publishing was stopped by a step above."}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** What arrived, and from where — the hierarchy, as a list. */
function Installed() {
  const manifests = usePluginManifests();
  const byExtension = new Map<string, typeof manifests>();
  for (const manifest of manifests) {
    const key = manifest.extension ?? "Not grouped";
    byExtension.set(key, [...(byExtension.get(key) ?? []), manifest]);
  }

  return (
    <div className="grid gap-3">
      {[...byExtension].map(([extension, plugins]) => (
        <div key={extension} className="grid gap-1.5">
          <div className="flex items-center gap-2">
            <Package size={13} className="text-muted-foreground" />
            <span className="text-xs font-semibold">{extension}</span>
            <Badge variant="muted">{plugins.length}</Badge>
          </div>
          {plugins.map((manifest) => (
            <div key={manifest.name} className="pl-5 text-xs">
              <span className="font-medium">{manifest.displayName}</span>
              <span className="text-muted-foreground">
                {" "}
                — {manifest.description}
              </span>
            </div>
          ))}
        </div>
      ))}
      {manifests.length === 0 ? (
        <Empty>Nothing installed. Try `pip install -e examples/cms/cms`.</Empty>
      ) : null}
    </div>
  );
}

export default function App({
  remotes = [],
}: {
  // What `bootstrapExtensions` hands back: plugin refs, and the extension
  // groups that deliver several at once.
  remotes?: (LazyPluginRef | ReactorExtension)[];
}) {
  // Everything *content* here came from the server; this application bundles no
  // plugins of its own. The palette is the exception, and deliberately so: it is
  // part of the shell rather than something a CMS package ships.
  const reactor = useMemo(
    () =>
      buildReactorFromPlugins([
        CommandsPlugin,
        CmsCommandsPlugin,
        ThemePlugin,
        ...remotes,
      ]),
    [remotes],
  );
  useReactor(reactor);

  // Read from the store rather than component state: a command is invoked from
  // the palette, which is outside this tree, so both have to see one document.
  const doc = useSyncExternalStore(docStore.subscribe, docStore.get);
  const setDoc = docStore.set;

  return (
    <div className="mx-auto grid max-w-6xl gap-4 p-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      {/* Rendered once, for plugins that need a mount point but position
          themselves — the command palette floats over everything from here. */}
      <ReactorSlot slot="root" />
      <header className="lg:col-span-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Sparkles size={18} className="text-primary" /> Reactor CMS
        </h1>
        <p className="text-sm text-muted-foreground">
          Every feature below arrived from a Python package. This application
          has three contribution points and no opinions about what fills them.
        </p>
      </header>

      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText size={14} /> Editor
            </CardTitle>
            <CardDescription>
              The toolbar is <code>cms.editorToolbar</code> — every contribution
              is drawn.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Toolbar doc={doc} onChange={setDoc} />
            <Separator />
            <Textarea
              rows={12}
              value={doc.body}
              onChange={(event) => setDoc({ ...doc, body: event.target.value })}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Content type</CardTitle>
            <CardDescription>
              <code>cms.contentType</code> — the application chooses one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ContentTypePicker doc={doc} onChange={setDoc} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 content-start">
        <Card>
          <CardHeader>
            <CardTitle>Publish</CardTitle>
            <CardDescription>
              <code>cms.publishLifecycle</code> — every step runs, and any one
              can stop it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Publish doc={doc} />
          </CardContent>
        </Card>

        {/* Whatever a plugin wants beside the editor, drawn with this host's
            kit because the host published it. Empty until something fills it. */}
        <ReactorSlot slot="cms.aside" props={{ doc }} />

        <Card>
          <CardHeader>
            <CardTitle>Installed</CardTitle>
            <CardDescription>
              Python package → extension → plugin.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Installed />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
