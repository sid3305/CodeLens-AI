/**
 * jsdom has no layout: give Range the measuring methods CodeMirror calls.
 * Imported by the tests that render the code viewer (not by setup.ts).
 */
const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = emptyRects
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect()
