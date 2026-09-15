/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import { $createCodeNode } from '@lexical/code';
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from '@lexical/list';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { INSERT_HORIZONTAL_RULE_COMMAND } from '@lexical/react/LexicalHorizontalRuleNode';
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin';
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import { $setBlocksType } from '@lexical/selection';
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  type ElementNode,
  type TextNode,
} from 'lexical';
import { Box, Text } from '@primer/react';
import {
  ChecklistIcon,
  ChevronDownIcon,
  CodeIcon,
  DashIcon,
  HashIcon,
  ListOrderedIcon,
  ListUnorderedIcon,
  PencilIcon,
  QuoteIcon,
  TableIcon,
  TypographyIcon,
} from '@primer/octicons-react';
import { useCallback, useMemo, useState, type JSX, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { INSERT_COLLAPSIBLE_COMMAND } from '@datalayer/jupyter-lexical/lib/plugins/CollapsiblePlugin/index.js';
import { INSERT_EXCALIDRAW_COMMAND } from '@datalayer/jupyter-lexical/lib/plugins/ExcalidrawPlugin.js';
import { INSERT_TABLE_WITH_DIALOG_COMMAND } from '@datalayer/jupyter-lexical/lib/plugins/TablePlugin.js';

class CmsSlashOption extends MenuOption {
  title: string;
  icon: JSX.Element;
  keywords: string[];
  run: () => void;

  constructor(
    title: string,
    icon: JSX.Element,
    keywords: string[],
    run: () => void,
  ) {
    super(title);
    this.title = title;
    this.icon = icon;
    this.keywords = keywords;
    this.run = run;
  }
}

export function CmsSlashCommandPlugin(): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [query, setQuery] = useState<string | null>(null);
  const trigger = useBasicTypeaheadTriggerMatch('/', { minLength: 0 });

  const setBlock = useCallback(
    (factory: () => ElementNode) => {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, factory);
        }
      });
    },
    [editor],
  );

  const options = useMemo(() => {
    const all = [
      new CmsSlashOption(
        'Paragraph',
        <TypographyIcon size={16} />,
        ['text', 'normal', 'p'],
        () => setBlock($createParagraphNode),
      ),
      ...([1, 2, 3] as const).map(level =>
        new CmsSlashOption(
          `Heading ${level}`,
          <HashIcon size={16} />,
          ['heading', 'header', `h${level}`],
          () => setBlock(() => $createHeadingNode(`h${level}`)),
        ),
      ),
      new CmsSlashOption(
        'Numbered List',
        <ListOrderedIcon size={16} />,
        ['ordered', 'ol', 'list'],
        () => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined),
      ),
      new CmsSlashOption(
        'Bulleted List',
        <ListUnorderedIcon size={16} />,
        ['unordered', 'ul', 'list'],
        () => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined),
      ),
      new CmsSlashOption(
        'Check List',
        <ChecklistIcon size={16} />,
        ['todo', 'task', 'list'],
        () => editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined),
      ),
      new CmsSlashOption(
        'Quote',
        <QuoteIcon size={16} />,
        ['blockquote'],
        () => setBlock($createQuoteNode),
      ),
      new CmsSlashOption(
        'Code Block',
        <CodeIcon size={16} />,
        ['code', 'javascript', 'python'],
        () => setBlock($createCodeNode),
      ),
      new CmsSlashOption(
        'Divider',
        <DashIcon size={16} />,
        ['horizontal rule', 'hr'],
        () => editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined),
      ),
      new CmsSlashOption(
        'Table',
        <TableIcon size={16} />,
        ['grid', 'rows', 'columns'],
        () =>
          editor.dispatchCommand(INSERT_TABLE_WITH_DIALOG_COMMAND, undefined),
      ),
      new CmsSlashOption(
        'Collapsible Section',
        <ChevronDownIcon size={16} />,
        ['accordion', 'toggle', 'details'],
        () => editor.dispatchCommand(INSERT_COLLAPSIBLE_COMMAND, undefined),
      ),
      new CmsSlashOption(
        'Drawing',
        <PencilIcon size={16} />,
        ['excalidraw', 'diagram', 'sketch'],
        () => editor.dispatchCommand(INSERT_EXCALIDRAW_COMMAND, undefined),
      ),
    ];
    const normalized = query?.trim().toLocaleLowerCase();
    return normalized
      ? all.filter(option =>
          [option.title, ...option.keywords].some(value =>
            value.toLocaleLowerCase().includes(normalized),
          ),
        )
      : all;
  }, [editor, query, setBlock]);

  const select = useCallback(
    (
      option: CmsSlashOption,
      nodeToRemove: TextNode | null,
      closeMenu: () => void,
    ) => {
      editor.update(() => {
        nodeToRemove?.remove();
        option.run();
        closeMenu();
      });
    },
    [editor],
  );

  return (
    <LexicalTypeaheadMenuPlugin<CmsSlashOption>
      triggerFn={trigger}
      onQueryChange={setQuery}
      onSelectOption={select}
      options={options}
      menuRenderFn={(anchorRef, menu) =>
        anchorRef.current && options.length
          ? createPortal(
              <Box
                onMouseDown={(event: MouseEvent) => event.preventDefault()}
                sx={{
                  position: 'relative',
                  zIndex: 1100,
                  minWidth: 240,
                  maxHeight: 320,
                  overflowY: 'auto',
                  p: 1,
                  bg: 'canvas.overlay',
                  border: '1px solid',
                  borderColor: 'border.default',
                  borderRadius: 2,
                  boxShadow: 'shadow.large',
                }}
              >
                <Box as="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                  {options.map((option, index) => {
                    const selected = menu.selectedIndex === index;
                    return (
                      <Box
                        as="li"
                        id={`cms-slash-option-${index}`}
                        key={option.key}
                        role="option"
                        aria-selected={selected}
                        ref={(element: HTMLElement | null) =>
                          option.setRefElement(element)
                        }
                        onMouseEnter={() => menu.setHighlightedIndex(index)}
                        onClick={() => {
                          menu.setHighlightedIndex(index);
                          menu.selectOptionAndCleanUp(option);
                        }}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 2,
                          px: 2,
                          py: '6px',
                          borderRadius: 2,
                          cursor: 'pointer',
                          color: 'fg.default',
                          bg: selected
                            ? 'actionListItem.default.selectedBg'
                            : 'transparent',
                          '&:hover': { bg: 'actionListItem.default.hoverBg' },
                        }}
                      >
                        <Box sx={{ display: 'flex', color: 'fg.muted' }}>
                          {option.icon}
                        </Box>
                        <Text sx={{ fontSize: 1 }}>{option.title}</Text>
                      </Box>
                    );
                  })}
                </Box>
              </Box>,
              anchorRef.current,
            )
          : null
      }
    />
  );
}
