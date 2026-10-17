---
sidebar_position: 1
title: Displays and audiences
---

# Displays and audiences

A display is what the host asks the page to draw: a typed payload with a
MIME-like type, a version, an id, its data, the actions it offers — and a text.

## Declaring a type

Subclass `Display`, declare fields, say what it reads as, and name it with
`@display_type`:

```python
from typing import Annotated, Literal
from pydantic import SecretStr
from reactor.ui import Display, audience, display_type

@display_type("application/vnd.example.approval+json", version=1)
class Approval(Display):
    title: str
    amount_eur: float
    status: Literal["pending", "approved", "rejected"] = "pending"
    reviewer_note: Annotated[str, audience("page")] = ""
    vendor_key: SecretStr | None = None

    def text(self) -> str:
        return f"{self.title}: {self.amount_eur:.2f} EUR ({self.status})"
```

The decorator refuses what would not work on the wire:

- a type that is not a media type (`top/sub`, lowercase — `application/vnd.x+json`),
- a version below `1`,
- a class that is not a `Display` subclass, or that does not define `text()`.

`text()` is mandatory. It is what a page with no renderer for the type draws,
what a log or a transcript keeps, and what a model reads first.

`id` (a fresh hex uuid unless given) and `actions` belong to the envelope;
every other field is the display's `data`.

## The wire form

`display.wire()` is the display as the page receives it, a `DisplayWire`:

```python
approval = Approval(id="a1", title="Laptop", amount_eur=1890, reviewer_note="Over budget", vendor_key="vk-1")
approval.wire().model_dump(mode="json")
```

```json
{
  "type": "application/vnd.example.approval+json",
  "version": 1,
  "id": "a1",
  "text": "Laptop: 1890.00 EUR (pending)",
  "data": { "title": "Laptop", "amount_eur": 1890.0, "status": "pending", "reviewer_note": "Over budget" },
  "actions": []
}
```

The wire models are strict (`extra="forbid"`): a member nobody declared is a
bug on the other side, and is refused rather than carried along.

`Approval.from_wire(wire)` reads it back — refusing another type or version —
and so does a registry, which finds the class by type and version first.

## Audiences

Each field says who it is for, where it is declared; the views apply it once,
at the wire boundary:

| Field | Page (`wire()`, `page_view`) | Model (`model_view()`) |
| --- | --- | --- |
| plain, or `Annotated[..., audience("both")]` | yes | yes |
| `Annotated[..., audience("page")]` | yes | no |
| `SecretStr` / `SecretBytes`, optional or not | no | no |

```python
>>> approval.model_view()
{'type': 'application/vnd.example.approval+json',
 'text': 'Laptop: 1890.00 EUR (pending)',
 'data': {'title': 'Laptop', 'amount_eur': 1890.0, 'status': 'pending'}}
```

The rules go all the way down: a nested pydantic model's own fields are
filtered by their own audiences, and a secret inside a list or a dict the
annotation did not name is sent as `null`.

`model_view(model)` and `page_view(model)` are also functions, for any pydantic
model — the same filter applies to an action's payload, so what a person typed
on the page reaches a model through `model_view` or not at all.

:::warning The text is for both
`model_view()` includes `text()`. A page-only field must not appear in it, or
the text tells the model what the field's audience hid.
:::

## The registry

Every `@display_type` class is recorded in `reactor.ui.DISPLAY_TYPES`, the
process-wide registry. A host that runs plugins asks them instead, so that a
disabled plugin's types are not there:

```python
class ApprovalPlugin:
    def provide_display_types(self, registry):
        registry.register(Approval)

registry = platform.display_types()           # the enabled plugins' types, read fresh
display = registry.parse(wire)                # back to its class; an unknown type is a LookupError
registry.types()                              # [('application/vnd.example.approval+json', 1)]
registry.schemas()                            # {'application/vnd.example.approval+json@1': {...JSON Schema...}}
```

`PluginPlatform.display_types()` gives each plugin a registry of its own and
merges it only once the plugin's hook returned: a plugin that fails halfway
leaves none of its types behind, and is logged and skipped without hiding the
others. A type and version can belong to one class only — registering another
class under it is a `ValueError`, and a merge with one such conflict takes
none of the other registry's classes.

`registry.get(type)` without a version answers the latest registered.
