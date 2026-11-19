/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * Where diagrams live, and the Mermaid that checks and draws them.
 *
 * The tools ask a host for diagrams by id, and are handed Mermaid rather than
 * importing it: the page that shows the diagrams has it already, at the
 * version it chose, and initialised with its theme.
 *
 * @module host
 */

/** One diagram. */
export interface MermaidDiagram {
  id: string;
  source: string;
  title?: string;
}

/**
 * What keeps the diagrams. A method that names a diagram there is none of
 * throws, with a message telling the model what to do next.
 */
export interface MermaidDiagramHost {
  listDiagrams(): Promise<MermaidDiagram[]>;
  readDiagram(id: string): Promise<MermaidDiagram>;
  writeDiagram(diagram: MermaidDiagram): Promise<void>;
  /** Make a new diagram; answers its id. */
  insertDiagram(diagram: Omit<MermaidDiagram, 'id'>): Promise<string>;
}

/**
 * The two calls of Mermaid's API the tools use — the `mermaid` module's
 * default export has both, so a host passes it as it is.
 *
 * `parse` throws on a source that does not parse (or answers `false`, when
 * asked to suppress errors, which the tools do not ask). `render` draws a
 * source into SVG under an element id it needs to be unique on the page.
 */
export interface MermaidEngine {
  parse(source: string): Promise<unknown>;
  render(id: string, source: string): Promise<{ svg: string }>;
}

/**
 * A host that keeps its diagrams in memory, in insertion order: what a page
 * with a diagram view needs, and what the tests use.
 */
export function createMemoryDiagramHost(
  options: {
    diagrams?: MermaidDiagram[];
    /** Told after every change, with the diagram's id. */
    onChange?: (id: string) => void;
    newId?: () => string;
  } = {},
): MermaidDiagramHost & {
  /** The diagram of an id, or undefined: for a view, which does not throw. */
  get(id: string): MermaidDiagram | undefined;
  /** Put a diagram in, or replace the one of its id: what a view or a restore does. */
  set(diagram: MermaidDiagram): void;
} {
  const diagrams = new Map<string, MermaidDiagram>();
  for (const diagram of options.diagrams ?? []) {
    diagrams.set(diagram.id, { ...diagram });
  }
  let counter = diagrams.size;
  const newId = options.newId ?? (() => `diagram-${(counter += 1)}`);
  const changed = (id: string) => options.onChange?.(id);

  const require = (id: string): MermaidDiagram => {
    const found = diagrams.get(id);
    if (!found) {
      throw new Error(`No diagram '${id}'. Call mermaidListDiagrams to find the diagrams there are.`);
    }
    return found;
  };

  return {
    get: (id) => diagrams.get(id),
    set: (diagram) => {
      diagrams.set(diagram.id, { ...diagram });
      changed(diagram.id);
    },
    listDiagrams: async () => [...diagrams.values()].map((diagram) => ({ ...diagram })),
    readDiagram: async (id) => ({ ...require(id) }),
    writeDiagram: async (diagram) => {
      require(diagram.id);
      diagrams.set(diagram.id, { ...diagram });
      changed(diagram.id);
    },
    insertDiagram: async (diagram) => {
      let id = newId();
      while (diagrams.has(id)) {
        id = newId();
      }
      diagrams.set(id, { ...diagram, id });
      changed(id);
      return id;
    },
  };
}
