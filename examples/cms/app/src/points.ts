/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * What this CMS lets plugins extend.
 *
 * Three points, and they are deliberately three *different shapes* of answer —
 * because "contribution point" is one mechanism serving several interactions,
 * and an example that only showed the toolbar would suggest otherwise:
 *
 * | Point | The application… |
 * | --- | --- |
 * | `cms.editorToolbar` | renders every contribution, as a button |
 * | `cms.contentType` | renders a chooser and puts **one** on screen |
 * | `cms.publishLifecycle` | runs every contribution, and can be vetoed |
 *
 * The ids are the contract. A plugin arriving from a Python package it was
 * installed with declares `defineContributionPoint('cms.editorToolbar')` of its
 * own; the registry keys on the id, so the two handles are the same point. That
 * is what lets a plugin be written against an application it cannot import.
 */

import { defineContributionPoint } from '@datalayer/reactor';

/** A document being edited. Passed to everything a plugin contributes. */
export type Doc = {
  title: string;
  body: string;
  contentType: string;
};

/** A button in the editor's toolbar. Every contribution is rendered. */
export type EditorTool = {
  label: string;
  hint?: string;
  /** Transform the document body. Pure: it is handed text and returns text. */
  run: (body: string) => string;
};

/** A kind of thing this CMS can author. The application shows one at a time. */
export type ContentType = {
  id: string;
  label: string;
  description: string;
  /** Starting body for a new document of this type. */
  template: string;
  /** Extra fields this type wants, drawn by the application. */
  fields?: { name: string; placeholder: string }[];
};

/** A check or an action that runs when a document is published. */
export type PublishStep = {
  label: string;
  /**
   * Returning `ok: false` stops the publish. A lifecycle that could only
   * observe would make the SEO validator a suggestion rather than a gate.
   */
  run: (doc: Doc) => { ok: boolean; message: string };
};

export const EditorToolbar = defineContributionPoint<EditorTool>('cms.editorToolbar');
export const ContentTypes = defineContributionPoint<ContentType>('cms.contentType');
export const PublishLifecycle = defineContributionPoint<PublishStep>('cms.publishLifecycle');
