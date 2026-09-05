---
sidebar_position: 0
title: CMS (shadcn/ui)
slug: /examples/cms/
---

# 📝 The CMS example

A content management system where every feature is a plugin, delivered by two
Python packages — a free one and a paid one — and drawn with
[shadcn/ui](https://ui.shadcn.com).

> **[Run it on this site →](/examples/cms/demo)** — including the part that
> matters: installing the paid package and watching three plugins appear.

```
CMS
│
├── Python package: cms                    (free — and the application itself)
│   └── Extension: Core
│       ├── Markdown Tools   → Editor Toolbar
│       ├── Gallery          → Content Types
│       └── SEO Validator    → Publish Lifecycle
│
└── Python package: cms-pro                (paid)
    └── Extension: Pro
        ├── AI Writing Assistant → Editor Toolbar
        ├── Product              → Content Types
        └── Social Publisher     → Publish Lifecycle
```

| Concept | Here |
| --- | --- |
| Application | CMS |
| Python package | `cms`, `cms-pro` |
| [Extension](/typescript-plugins/extensions) | Core, Pro |
| [Plugin](/typescript-plugins/plugins) | Gallery, SEO Validator, AI Writing Assistant… |
| [Contribution point](/typescript-plugins/contribution-points) | Editor Toolbar, Content Types, Publish Lifecycle |
| Contribution | a toolbar button, a content type, a publish step |

The hierarchy, which is the thing to hold on to:

```
Python package → Extension → Plugin → Contribution → Contribution point
```

## Run it

```bash
make cms          # build the interface, install the free tier
datalayer-cms     # http://localhost:8788
```

Then, **while it is running**:

```bash
make cms-pro      # or: pip install examples/cms/cms-pro
# refresh the browser
```

Three more plugins appear in the same three points — a Rewrite button beside
Heading/Bold/Link, a Product type beside Gallery, a Social step beside SEO. No
restart, no rebuild of the interface, and no change to `cms`.

:::note
A regular `pip install`, not `pip install -e`. An editable install writes a
`.pth` file that Python only processes at interpreter startup, so an editable
package genuinely does need a restart. A normal install lands in
`site-packages`, which a running process can be made to re-read — see
[packaging](/python-packaged-extensions).
:::

## Packaging is independent of extensibility

This is the reason the example has two packages.

There is **no plugin API for paid plugins**. No capability flag, no tier check,
nothing in the host that knows one package was bought. `cms-pro` advertises
itself under the same entry-point group as `cms`, registers on the same
platform, and contributes to the same three point ids. Read
`cms-pro/cms_pro/plugins.py` beside `cms/cms/plugins.py`: they are the same kind
of file.

What makes it "pro" is who may download the wheel — a question about
distribution, answered entirely outside Reactor. That separation is what lets a
third party write a plugin without asking anybody's permission, and it is what a
marketplace needs to be possible at all.

`cms` is deliberately both the application *and* an extension: Core is
discovered through the same group as Pro, so the host has no privileged idea of
its own plugins.

## Three points, three shapes

One mechanism, three different interactions — so that "contribution point" does
not get read as "list of buttons":

| Point | The application… |
| --- | --- |
| `cms.editorToolbar` | renders **every** contribution, as a button |
| `cms.contentType` | renders a chooser and shows **one** |
| `cms.publishLifecycle` | **runs** every contribution, and any one can veto |

The SEO validator refuses a publish that would be invisible; the social
publisher only announces one and never blocks. Both fill the same point — which
is why a lifecycle whose steps could *only* veto, or *only* observe, would have
been the wrong design.

## The plugins do not know what the CMS looks like

Almost every contribution here is a plain record: a label and a function. The
application draws them, so a plugin never touches a design system.

The exception is the AI assistant, which contributes a **panel** — and draws it
with shadcn/ui components it never installed. The host publishes its design
system alongside React:

```ts
setReactorSharedModules({
  react: React,
  '@datalayer/reactor': Reactor,
  '@cms/ui': UI,          // ← the host's kit, handed to its plugins
});
```

```js
// in the plugin
const ui = shared['@cms/ui'] ?? {};
const Card = ui.Card ?? 'div';   // a host that publishes none still works
```

That is the answer to *"is the plugin model independent of the UI kit?"* — not
"plugins avoid the kit", because some of them must draw, but **the kit is
something the host hands over**. The [music store](/examples/music/) is the same
model with Primer, and its plugins are the same shape.

:::tip A trap worth knowing
A plugin cannot ship Tailwind classes of its own. Tailwind generates CSS by
scanning source at build time, so a class appearing only inside a module fetched
at runtime is a class nobody generated. Publishing the components sidesteps it:
every class lives in the host's build.
:::

## What it demonstrates, in one list

- [One `pip install`, both tiers](/python-packaged-extensions) — each package ships its
  Python plugins *and* their browser halves.
- [A host](/python-plugins/host) — one command serves the interface and the API from one
  origin.
- [Remote plugins](/typescript-plugins/federation) — every plugin arrives from a URL the
  server named; the application bundles none.
- Extensions [group without governing](/typescript-plugins/extensions) — Core and Pro
  each deliver three plugins, and every plugin is still switched on its own.
- [Commands](/commands-registry) on both tiers — Ctrl-K opens the
  [palette](/core-plugins/commands) over the application's own document commands,
  while the Python packages register theirs for the
  [command line](/python-plugins/cli).

## Commands, and what installing changes

Core's Python package ships a `cms` command group and Pro ships a `pro` one, so
the command line grows and shrinks with what is installed — the same claim the
browser half makes, made where there is no browser:

```bash
reactor cms check "A title that is long enough" --description "…"
pip install cms-pro
reactor pro rewrite "hello"          # only after Pro is installed
```
