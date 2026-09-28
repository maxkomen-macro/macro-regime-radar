/**
 * "How this was built": a section the Build Notes page prints from its own
 * source, after the notes file's "Prototypes, and how I would build them"
 * (or, when the file has no such section, before §1.0.1's lists). The notes
 * file carries the same words under the same heading; the page prints this
 * copy in its place, and BuildNotesPage.test.tsx holds the two word for word.
 */

export const BUILT_TITLE = "How this was built";

/** The file section it follows. */
export const BUILT_AFTER = "Prototypes, and how I would build them";

/** Its id, outside the file sections' `bn-…` namespace. */
export const BUILT_ID = "bnx-built";

export const BUILT_PARAGRAPHS: readonly string[] = [
  "The work was split into parallel branches, each built by an AI coding agent in its own git worktree, one commit per item.",
  "Every commit passed type checks, unit tests, a production build and its related browser tests; each branch then passed the full test suite and the full Desk browser suite once before merge.",
  "An independent AI reviewer checked every branch before it merged, with read-only access, and reproduced each finding as a test. Every blocking finding was fixed and reviewed again before release. The findings tables are in each branch's report in docs/desk/.",
  "I set the scope, the rules and the priorities, adjudicated every finding, and made every merge.",
  "The tests enforce three rules: no invented number on a LIVE card; illustrative values only inside marked prototype cards; no control that does nothing.",
];
