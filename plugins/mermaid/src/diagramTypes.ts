/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * The diagram types Mermaid draws, and which one a source is.
 *
 * A source says its type with its first word — `flowchart`, `sequenceDiagram`
 * — after any front matter, directive or comment. Reading that word is plain
 * text work, so it is done here without Mermaid: a model asking which types
 * exist, or which one it just wrote, need not load a renderer.
 *
 * @module diagramTypes
 */

/** One diagram type. */
export interface MermaidDiagramType {
  /** The type's name, as Mermaid reports it. */
  type: string;
  /** The words a source may open with to be this type. */
  keywords: string[];
  /** What it is called. */
  name: string;
  /** What it is for, in a line. */
  description: string;
  /** A small, valid source to start from. */
  example: string;
  /** Mermaid marks it beta: its syntax may still change. */
  beta?: boolean;
}

export const MERMAID_DIAGRAM_TYPES: MermaidDiagramType[] = [
  {
    type: 'flowchart',
    keywords: ['flowchart', 'graph'],
    name: 'Flowchart',
    description: 'Steps and decisions joined by arrows; LR, TD, RL or BT sets the direction.',
    example: 'flowchart LR\n  A[Start] --> B{Ready?}\n  B -->|yes| C[Ship]\n  B -->|no| A',
  },
  {
    type: 'sequence',
    keywords: ['sequenceDiagram'],
    name: 'Sequence diagram',
    description: 'Messages between participants over time.',
    example: 'sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi',
  },
  {
    type: 'class',
    keywords: ['classDiagram', 'classDiagram-v2'],
    name: 'Class diagram',
    description: 'Classes, their members and how they relate.',
    example: 'classDiagram\n  Animal <|-- Dog\n  Animal : +String name',
  },
  {
    type: 'state',
    keywords: ['stateDiagram', 'stateDiagram-v2'],
    name: 'State diagram',
    description: 'States and the transitions between them.',
    example: 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running\n  Running --> [*]',
  },
  {
    type: 'er',
    keywords: ['erDiagram'],
    name: 'Entity relationship diagram',
    description: 'Entities, their attributes and the cardinality of their relations.',
    example: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places',
  },
  {
    type: 'journey',
    keywords: ['journey'],
    name: 'User journey',
    description: 'The steps of a task, scored by how each one feels.',
    example: 'journey\n  title Checkout\n  section Cart\n    Add item: 5: Me',
  },
  {
    type: 'gantt',
    keywords: ['gantt'],
    name: 'Gantt chart',
    description: 'Tasks on a timeline, with dates, durations and dependencies.',
    example:
      'gantt\n  dateFormat YYYY-MM-DD\n  section Build\n    Design :a1, 2026-01-01, 7d\n    Code :after a1, 14d',
  },
  {
    type: 'pie',
    keywords: ['pie'],
    name: 'Pie chart',
    description: 'Shares of a whole.',
    example: 'pie title Pets\n  "Dogs" : 40\n  "Cats" : 35',
  },
  {
    type: 'quadrantChart',
    keywords: ['quadrantChart'],
    name: 'Quadrant chart',
    description: 'Points on two axes, read by the quadrant they fall in.',
    example:
      'quadrantChart\n  x-axis Low effort --> High effort\n  y-axis Low value --> High value\n  A: [0.3, 0.8]',
  },
  {
    type: 'requirement',
    keywords: ['requirementDiagram'],
    name: 'Requirement diagram',
    description: 'Requirements and the elements that satisfy or verify them.',
    example:
      'requirementDiagram\n  requirement r1 {\n    id: 1\n    text: Log in\n    risk: low\n    verifymethod: test\n  }',
  },
  {
    type: 'gitGraph',
    keywords: ['gitGraph'],
    name: 'Git graph',
    description: 'Commits, branches and merges.',
    example: 'gitGraph\n  commit\n  branch feature\n  commit\n  checkout main\n  merge feature',
  },
  {
    type: 'c4',
    keywords: ['C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment'],
    name: 'C4 diagram',
    description: 'A software system at the context, container, component or deployment level.',
    example: 'C4Context\n  Person(user, "User")\n  System(app, "App")\n  Rel(user, app, "Uses")',
  },
  {
    type: 'mindmap',
    keywords: ['mindmap'],
    name: 'Mind map',
    description: 'Ideas branching from a centre, by indentation.',
    example: 'mindmap\n  root((Plan))\n    Goals\n    Risks',
  },
  {
    type: 'timeline',
    keywords: ['timeline'],
    name: 'Timeline',
    description: 'Events in order, grouped by period.',
    example: 'timeline\n  title Releases\n  2025 : 1.0\n  2026 : 2.0',
  },
  {
    type: 'sankey',
    keywords: ['sankey-beta', 'sankey'],
    name: 'Sankey diagram',
    description: 'Flows between nodes, drawn as wide as their value; rows of source,target,value.',
    example: 'sankey-beta\nIncome,Rent,1200\nIncome,Food,400',
    beta: true,
  },
  {
    type: 'xychart',
    keywords: ['xychart-beta', 'xychart'],
    name: 'XY chart',
    description: 'Bars and lines over an x axis.',
    example: 'xychart-beta\n  x-axis [Q1, Q2, Q3]\n  bar [10, 20, 15]',
    beta: true,
  },
  {
    type: 'block',
    keywords: ['block-beta', 'block'],
    name: 'Block diagram',
    description: 'Blocks laid out in columns, with arrows between them.',
    example: 'block-beta\n  columns 2\n  A B\n  A --> B',
    beta: true,
  },
  {
    type: 'packet',
    keywords: ['packet-beta', 'packet'],
    name: 'Packet diagram',
    description: 'The fields of a network packet, by bit range.',
    example: 'packet-beta\n  0-15: "Source Port"\n  16-31: "Destination Port"',
    beta: true,
  },
  {
    type: 'kanban',
    keywords: ['kanban'],
    name: 'Kanban board',
    description: 'Cards in columns.',
    example: 'kanban\n  Todo\n    [Write]\n  Done\n    [Plan]',
  },
  {
    type: 'architecture',
    keywords: ['architecture-beta', 'architecture'],
    name: 'Architecture diagram',
    description: 'Services and resources in groups, joined by edges.',
    example: 'architecture-beta\n  service db(database)[Database]\n  service api(server)[API]\n  api:R -- L:db',
    beta: true,
  },
  {
    type: 'radar',
    keywords: ['radar-beta', 'radar'],
    name: 'Radar chart',
    description: 'Several values per item on axes around a centre.',
    example: 'radar-beta\n  axis a, b, c\n  curve x{1, 2, 3}',
    beta: true,
  },
];

/**
 * The source with its front matter, directives and comments taken off, so
 * its first word is its type.
 */
export function stripPreamble(source: string): string {
  let text = source.replace(/^﻿/, '');
  // Front matter: a YAML block between two `---` lines, at the very top.
  const frontMatter = /^\s*---\r?\n[\s\S]*?\r?\n---\s*(\r?\n|$)/;
  text = text.replace(frontMatter, '');
  const lines = text.split(/\r?\n/);
  let first = 0;
  while (first < lines.length) {
    const line = lines[first].trim();
    // `%%{init: …}%%` directives and `%%` comments come before the type.
    if (line === '' || line.startsWith('%%')) {
      first += 1;
      continue;
    }
    break;
  }
  return lines.slice(first).join('\n');
}

/** The type of a source, from its first word; undefined when no type opens it. */
export function detectDiagramType(source: string): MermaidDiagramType | undefined {
  const word = stripPreamble(source).trim().split(/[\s;]/, 1)[0] ?? '';
  return MERMAID_DIAGRAM_TYPES.find((type) => type.keywords.includes(word));
}
