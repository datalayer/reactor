---
sidebar_position: 3
title: Slots or contribution points?
---

# Slots or contribution points?

Both let a plugin add something. They answer different questions, and choosing
the wrong one is the most common way to end up fighting the runtime.

**A slot** answers *"render everything plugins put here"* — a header, a toolbar,
a status bar. Every contribution is rendered, the application does not choose,
and the plugin supplies a component.

**A contribution point** answers *"what do plugins offer, so the application can
choose?"* — a set of views of which one is on screen, commands of which one is
invoked, mention namespaces resolved on demand. Contributions are typed records
rather than components, the application enumerates them and decides, and a
record can carry anything: a title, an icon, an ordering, a lazy module.

| | Slot | Contribution point |
| --- | --- | --- |
| The question | render everything put here | what is on offer? |
| What is contributed | a component | a typed record |
| Who chooses | nobody — all of it renders | the application |
| Typical use | header, toolbar, status bar | view switcher, command palette, rules |
| API | `ReactorSlot` | `defineContributionPoint`, `useContributions`, `ReactorViewHost` |

> Reach for a slot when everything contributed should appear. Reach for a
> contribution point when something has to pick.

The [music example](/examples/music/) has one of each, side by side and
deliberately: the store header is a slot, and the playlist's rule chooser is a
contribution point. See
[the two-plugin pair](/examples/music/architecture) for the shape a slot cannot
express.

Details and code: [Contribution points](/typescript/contribution-points) and
[React bindings](/typescript/react).
