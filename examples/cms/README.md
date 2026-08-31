[![Datalayer](https://assets.datalayer.tech/datalayer-25.svg)](https://datalayer.io)

# 📝 CMS — two Python packages, one set of extension points

A content management system where **every feature is a plugin**, delivered by
Python packages, drawn with [shadcn/ui](https://ui.shadcn.com).

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
| Extension | Core, Pro |
| Plugin | Gallery, SEO Validator, AI Writing Assistant… |
| Contribution point | Editor Toolbar, Content Types, Publish Lifecycle |
| Contribution | a toolbar button, a content type, a publish step |

```
Python package → Extension → Plugin → Contribution → Contribution point
```

## Run it

```bash
npm run build                              # from the repository root
cd examples/cms/app && npm run build && cd -
mkdir -p examples/cms/cms/share/datalayer/reactor/apps/cms
cp -r examples/cms/app/dist/. examples/cms/cms/share/datalayer/reactor/apps/cms/
pip install examples/cms/cms
datalayer-cms
```

Or `make cms` from the repository root, which does all of that.

Open <http://localhost:8788>. Three plugins, one extension, one package.

## Then buy the paid tier — without stopping the server

```bash
pip install examples/cms/cms-pro     # while `datalayer-cms` is running
# refresh the browser
```

Three more plugins appear, in the **same three points**: a Rewrite button beside
Heading/Bold/Link, a Product type beside Gallery, and a Social step beside SEO.
No restart, no rebuild of the interface, and no change to `cms`.

:::note
Use a regular `pip install`, not `pip install -e`. An editable install writes a
`.pth` file that Python only processes at interpreter startup, so an *editable*
package genuinely does need a restart. A normal install lands in `site-packages`,
which a running process can be made to re-read — which is what the rescan does.
:::

## Why this example exists

**Packaging and licensing are independent of the extension mechanism.** There is
no plugin API for paid plugins, no capability flag, and no tier check anywhere in
the code. `cms-pro` advertises itself under the same entry-point group as `cms`,
registers on the same platform, and fills the same three point ids. What makes it
"pro" is who may download the wheel — a question answered entirely outside
Reactor.

Read `cms-pro/cms_pro/plugins.py` next to `cms/cms/plugins.py` and notice they
are the same kind of file.

**Three points, three shapes.** One mechanism, three different interactions, so
that "contribution point" does not get read as "list of buttons":

| Point | The application… |
| --- | --- |
| `cms.editorToolbar` | renders **every** contribution |
| `cms.contentType` | renders a chooser and shows **one** |
| `cms.publishLifecycle` | **runs** every contribution, and any one can veto |

The SEO validator refuses a publish; the social publisher only announces one.
Both fill the same point, which is why the lifecycle has to allow both.

**The plugins do not know what the CMS looks like.** Almost every contribution
here is a plain record — a label and a function. The application draws them. The
one exception is the AI assistant, which contributes a *panel*, and it draws with
shadcn/ui components it never installed: the host publishes its design system
through `setReactorSharedModules`, so a plugin inherits the theme without
importing anything.

That is the answer to *"is the plugin model independent of the UI kit?"* — not
"plugins avoid the kit", but "the kit is something the host hands over". The
[music store](../music) is the same model with Primer, and the plugins are the
same shape.

:::tip A trap worth knowing
A plugin cannot ship Tailwind classes of its own. Tailwind generates CSS by
scanning source at build time, so a class that appears only inside a module
fetched at runtime is a class nobody generated. Publishing the components — as
this host does — sidesteps it: every class lives in the host's build.
:::

## Layout

```
examples/cms/
  app/                          the shell: Rsbuild + Tailwind + shadcn/ui
  cms/                          the `cms` package — the application AND Core
    cms/plugins.py              the Python halves
    share/.../extensions/cms-core/index.js    the browser halves, un-built
  cms-pro/                      the `cms-pro` package — Pro, and nothing else
```

`cms` is deliberately both the application and an extension: Core is discovered
through the same entry-point group as Pro, so the host has no privileged idea of
its own plugins.
