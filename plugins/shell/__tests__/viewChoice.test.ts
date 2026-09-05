/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  NONE_VIEW,
  chooseView,
  getViewChoice,
  nextView,
  seedViewChoice,
  setViewOptions,
} from "../src/viewChoice";

describe("the view choice store", () => {
  beforeEach(() => {
    setViewOptions([], true);
    seedViewChoice(NONE_VIEW);
  });

  it("cycles through none by default", () => {
    setViewOptions(["a", "b"]);
    expect(getViewChoice().viewId).toBe(NONE_VIEW);
    expect(nextView()).toBe("a");
    chooseView("b");
    expect(nextView()).toBe(NONE_VIEW);
  });

  it("never rests on none when none is not offered", () => {
    // The options arrive with the plugins; the choice moves to the first.
    setViewOptions(["decks"], false);
    expect(getViewChoice().viewId).toBe("decks");
    // A single view wraps onto itself rather than through none.
    expect(nextView()).toBe("decks");
    setViewOptions(["decks", "graph"], false);
    expect(nextView()).toBe("graph");
    chooseView("graph");
    expect(nextView()).toBe("decks");
    // The chosen view's plugin goes away: the choice follows the options.
    setViewOptions(["decks"], false);
    expect(getViewChoice().viewId).toBe("decks");
    // And with nothing on offer there is nothing else to say.
    setViewOptions([], false);
    expect(getViewChoice().viewId).toBe(NONE_VIEW);
    expect(nextView()).toBe(NONE_VIEW);
  });

  it("keeps a chosen view that is still offered", () => {
    setViewOptions(["a", "b"], false);
    chooseView("b");
    setViewOptions(["b", "c"], false);
    expect(getViewChoice().viewId).toBe("b");
  });
});
