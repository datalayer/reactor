/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * A remote that fails, on purpose.
 *
 * The interesting half of federation is not the happy path — it is what a bad
 * remote costs. This one throws while its module is being evaluated, which is
 * the worst case: the failure happens after the request succeeded, so nothing
 * about the URL predicts it.
 *
 * The shell should carry on with one plugin missing, and say which.
 */

throw new Error('this remote is broken on purpose');
