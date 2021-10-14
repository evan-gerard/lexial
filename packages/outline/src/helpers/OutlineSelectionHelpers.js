/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

import type {
  NodeKey,
  OutlineNode,
  Selection,
  TextFormatType,
  TextNode,
  BlockPoint,
  BlockNode,
  Point,
} from 'outline';

import {
  createLineBreakNode,
  isDecoratorNode,
  isLeafNode,
  isTextNode,
  isBlockNode,
  createTextNode,
  isRootNode,
} from 'outline';
import {isHashtagNode} from 'outline/HashtagNode';

import isImmutableOrInert from 'shared/isImmutableOrInert';
import invariant from 'shared/invariant';
import {doesContainGrapheme} from 'outline/TextHelpers';
import getPossibleDecoratorNode from 'shared/getPossibleDecoratorNode';

const cssToStyles: Map<string, {[string]: string}> = new Map();

function cloneWithProperties<T: OutlineNode>(node: T): T {
  const latest = node.getLatest();
  const constructor = latest.constructor;
  const clone = constructor.clone(latest);
  clone.__flags = latest.__flags;
  clone.__parent = latest.__parent;
  if (isBlockNode(latest)) {
    clone.__children = Array.from(latest.__children);
  } else if (isTextNode(latest)) {
    clone.__format = latest.__format;
    clone.__style = latest.__style;
  }
  return clone;
}

function getIndexFromPossibleClone(
  node: OutlineNode,
  parent: BlockNode,
  nodeMap: Map<NodeKey, OutlineNode>,
): number {
  const parentClone = nodeMap.get(parent.getKey());
  if (isBlockNode(parentClone)) {
    return parentClone.__children.indexOf(node.getKey());
  }
  return node.getIndexWithinParent();
}

function getParentAvoidingExcludedBlocks(node: OutlineNode): BlockNode | null {
  let parent = node.getParent();
  while (parent !== null && parent.excludeFromCopy()) {
    parent = parent.getParent();
  }
  return parent;
}

function copyLeafNodeBranchToRoot(
  leaf: OutlineNode,
  startingOffset: number,
  isLeftSide: boolean,
  range: Array<NodeKey>,
  nodeMap: Map<NodeKey, OutlineNode>,
) {
  let node = leaf;
  let offset = startingOffset;
  while (node !== null) {
    const parent = getParentAvoidingExcludedBlocks(node);
    if (parent === null) {
      break;
    }
    if (!isBlockNode(node) || !node.excludeFromCopy()) {
      const key = node.getKey();
      let clone = nodeMap.get(key);
      const needsClone = clone === undefined;
      if (needsClone) {
        clone = cloneWithProperties<OutlineNode>(node);
        nodeMap.set(key, clone);
      }
      if (isTextNode(clone) && !clone.isSegmented() && !clone.isImmutable()) {
        clone.__text = clone.__text.slice(
          isLeftSide ? offset : 0,
          isLeftSide ? undefined : offset,
        );
      } else if (isBlockNode(clone)) {
        clone.__children = clone.__children.slice(
          isLeftSide ? offset : 0,
          isLeftSide ? undefined : offset + 1,
        );
      }
      if (isRootNode(parent)) {
        if (needsClone) {
          // We only want to collect a range of top level nodes.
          // So if the parent is the root, we know this is a top level.
          range.push(key);
        }
        break;
      }
    }
    offset = getIndexFromPossibleClone(node, parent, nodeMap);
    node = parent;
  }
}

export function cloneContents(selection: Selection): {
  range: Array<NodeKey>,
  nodeMap: Array<[NodeKey, OutlineNode]>,
} {
  const anchor = selection.anchor;
  const focus = selection.focus;
  const anchorNode = anchor.getNode();
  const focusNode = focus.getNode();
  const anchorOffset = anchor.getCharacterOffset();
  const focusOffset = focus.getCharacterOffset();
  let startOffset;
  let endOffset;

  if (anchorNode === focusNode && isTextNode(anchorNode)) {
    const firstNode = cloneWithProperties<TextNode>(anchorNode);
    const isBefore = focusOffset > anchorOffset;
    startOffset = isBefore ? anchorOffset : focusOffset;
    endOffset = isBefore ? focusOffset : anchorOffset;
    firstNode.__text = firstNode.__text.slice(startOffset, endOffset);
    const key = firstNode.getKey();
    return {range: [key], nodeMap: [[key, firstNode]]};
  }
  const nodes = selection.getNodes();
  if (nodes.length === 0) {
    return {range: [], nodeMap: []};
  }
  const nodesLength = nodes.length;
  const firstNode = nodes[0];
  const lastNode = nodes[nodesLength - 1];
  const isBefore = anchor.isBefore(focus);
  const nodeMap = new Map();
  const range = [];

  // Do first node to root
  copyLeafNodeBranchToRoot(
    firstNode,
    isBefore ? anchorOffset : focusOffset,
    true,
    range,
    nodeMap,
  );
  // Copy all nodes between
  for (let i = 0; i < nodesLength; i++) {
    const node = nodes[i];
    const key = node.getKey();
    if (!nodeMap.has(key) && (!isBlockNode(node) || !node.excludeFromCopy())) {
      const clone = cloneWithProperties<OutlineNode>(node);
      if (isRootNode(node.getParent())) {
        range.push(node.getKey());
      }
      nodeMap.set(key, clone);
    }
  }
  // Do last node to root
  copyLeafNodeBranchToRoot(
    lastNode,
    isBefore ? focusOffset : anchorOffset,
    false,
    range,
    nodeMap,
  );
  return {range, nodeMap: Array.from(nodeMap.entries())};
}

export function extractSelection(selection: Selection): Array<OutlineNode> {
  const selectedNodes = selection.getNodes();
  const selectedNodesLength = selectedNodes.length;
  const lastIndex = selectedNodesLength - 1;
  const anchor = selection.anchor;
  const focus = selection.focus;
  let firstNode = selectedNodes[0];
  let lastNode = selectedNodes[lastIndex];

  const anchorOffset = anchor.getCharacterOffset();
  const focusOffset = focus.getCharacterOffset();
  let startOffset;
  let endOffset;

  if (selectedNodesLength === 0) {
    return [];
  } else if (selectedNodesLength === 1) {
    if (isTextNode(firstNode)) {
      startOffset = anchorOffset > focusOffset ? focusOffset : anchorOffset;
      endOffset = anchorOffset > focusOffset ? anchorOffset : focusOffset;
      const splitNodes = firstNode.splitText(startOffset, endOffset);
      const node = startOffset === 0 ? splitNodes[0] : splitNodes[1];
      return [node];
    }
    return [firstNode];
  }
  const isBefore = anchor.isBefore(focus);

  if (isTextNode(firstNode)) {
    startOffset = isBefore ? anchorOffset : focusOffset;
    if (startOffset !== 0) {
      [, firstNode] = firstNode.splitText(startOffset);
    }
    selectedNodes[0] = firstNode;
  }
  if (isTextNode(lastNode)) {
    const lastNodeText = lastNode.getTextContent();
    const lastNodeTextLength = lastNodeText.length;
    endOffset = isBefore ? focusOffset : anchorOffset;
    if (endOffset !== lastNodeTextLength) {
      [lastNode] = lastNode.splitText(endOffset);
    }
    selectedNodes[lastIndex] = lastNode;
  }
  return selectedNodes;
}

export function getStyleObjectFromCSS(css: string): {[string]: string} | null {
  return cssToStyles.get(css) || null;
}

function getCSSFromStyleObject(styles: {[string]: string}): string {
  let css = '';
  for (const style in styles) {
    if (style) {
      css += `${style}: ${styles[style]};`;
    }
  }
  return css;
}

function patchNodeStyle(node: TextNode, patch: {[string]: string}): void {
  const prevStyles = getStyleObjectFromCSS(node.getStyle());
  const newStyles = prevStyles ? {...prevStyles, ...patch} : patch;
  const newCSSText = getCSSFromStyleObject(newStyles);
  node.setStyle(newCSSText);
  cssToStyles.set(newCSSText, newStyles);
}

export function patchStyleText(
  selection: Selection,
  patch: {[string]: string},
): void {
  const selectedNodes = selection.getNodes();
  const selectedNodesLength = selectedNodes.length;
  const lastIndex = selectedNodesLength - 1;
  let firstNode = selectedNodes[0];
  let lastNode = selectedNodes[lastIndex];

  if (selection.isCollapsed()) {
    return;
  }
  const anchor = selection.anchor;
  const focus = selection.focus;
  const firstNodeText = firstNode.getTextContent();
  const firstNodeTextLength = firstNodeText.length;
  const focusOffset = focus.offset;
  let anchorOffset = anchor.offset;
  let startOffset;
  let endOffset;

  const isBefore = anchor.isBefore(focus);
  startOffset = isBefore ? anchorOffset : focusOffset;
  endOffset = isBefore ? focusOffset : anchorOffset;

  // This is the case where the user only selected the very end of the
  // first node so we don't want to include it in the formatting change.
  if (startOffset === firstNode.getTextContentSize()) {
    const nextSibling = firstNode.getNextSibling();

    if (isTextNode(nextSibling)) {
      // we basically make the second node the firstNode, changing offsets accordingly
      anchorOffset = 0;
      startOffset = 0;
      firstNode = nextSibling;
    }
  }

  // This is the case where we only selected a single node
  if (firstNode === lastNode) {
    if (isTextNode(firstNode)) {
      startOffset = anchorOffset > focusOffset ? focusOffset : anchorOffset;
      endOffset = anchorOffset > focusOffset ? anchorOffset : focusOffset;

      // No actual text is selected, so do nothing.
      if (startOffset === endOffset) {
        return;
      }
      // The entire node is selected, so just format it
      if (startOffset === 0 && endOffset === firstNodeTextLength) {
        patchNodeStyle(firstNode, patch);
        firstNode.select(startOffset, endOffset);
      } else {
        // The node is partially selected, so split it into two nodes
        // and style the selected one.
        const splitNodes = firstNode.splitText(startOffset, endOffset);
        const replacement = startOffset === 0 ? splitNodes[0] : splitNodes[1];
        patchNodeStyle(replacement, patch);
        replacement.select(0, endOffset - startOffset);
      }
    }
    // multiple nodes selected.
  } else {
    if (isTextNode(firstNode)) {
      if (startOffset !== 0) {
        // the entire first node isn't selected, so split it
        [, firstNode] = firstNode.splitText(startOffset);
        startOffset = 0;
      }
      patchNodeStyle(firstNode, patch);
    }

    if (isTextNode(lastNode)) {
      const lastNodeText = lastNode.getTextContent();
      const lastNodeTextLength = lastNodeText.length;
      // if the entire last node isn't selected, split it
      if (endOffset !== lastNodeTextLength) {
        [lastNode] = lastNode.splitText(endOffset);
      }
      patchNodeStyle(lastNode, patch);
    }

    // style all the text nodes in between
    for (let i = 1; i < lastIndex; i++) {
      const selectedNode = selectedNodes[i];
      const selectedNodeKey = selectedNode.getKey();
      if (
        isTextNode(selectedNode) &&
        selectedNodeKey !== firstNode.getKey() &&
        selectedNodeKey !== lastNode.getKey() &&
        !selectedNode.isImmutable()
      ) {
        patchNodeStyle(selectedNode, patch);
      }
    }
  }
}

export function getSelectionStyleValueForProperty(
  selection: Selection,
  styleProperty: string,
  defaultValue: string = '',
): string {
  let styleValue = null;
  const nodes = selection.getNodes();
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (isTextNode(node)) {
      const nodeStyleValue = getNodeStyleValueForProperty(
        node,
        styleProperty,
        defaultValue,
      );
      if (styleValue === null) {
        styleValue = nodeStyleValue;
      } else if (styleValue !== nodeStyleValue) {
        // multiple text nodes are in the selection and they don't all
        // have the same font size.
        styleValue = '';
        break;
      }
    }
  }
  return styleValue === null ? defaultValue : styleValue;
}

function getNodeStyleValueForProperty(
  node: TextNode,
  styleProperty: string,
  defaultValue: string,
): string {
  const css = node.getStyle();
  const styleObject = getStyleObjectFromCSS(css);
  if (styleObject !== null) {
    return styleObject[styleProperty] || defaultValue;
  }
  return defaultValue;
}

export function formatText(
  selection: Selection,
  formatType: TextFormatType,
): void {
  const selectedNodes = selection.getNodes();
  const selectedNodesLength = selectedNodes.length;
  const lastIndex = selectedNodesLength - 1;
  let firstNode = selectedNodes[0];
  let lastNode = selectedNodes[lastIndex];

  if (selection.isCollapsed()) {
    selection.toggleTextFormatType(formatType);
    return;
  }
  const anchor = selection.anchor;
  const focus = selection.focus;
  const firstNodeText = firstNode.getTextContent();
  const firstNodeTextLength = firstNodeText.length;
  const focusOffset = focus.offset;
  let firstNextFormat = 0;
  for (let i = 0; i < selectedNodes.length; i++) {
    const selectedNode = selectedNodes[i];
    if (isTextNode(selectedNode)) {
      firstNextFormat = selectedNode.getTextNodeFormat(formatType, null);
      break;
    }
  }
  let anchorOffset = anchor.offset;
  let startOffset;
  let endOffset;

  const isBefore = anchor.isBefore(focus);
  startOffset = isBefore ? anchorOffset : focusOffset;
  endOffset = isBefore ? focusOffset : anchorOffset;

  // This is the case where the user only selected the very end of the
  // first node so we don't want to include it in the formatting change.
  if (startOffset === firstNode.getTextContentSize()) {
    const nextSibling = firstNode.getNextSibling();

    if (isTextNode(nextSibling)) {
      // we basically make the second node the firstNode, changing offsets accordingly
      anchorOffset = 0;
      startOffset = 0;
      firstNode = nextSibling;
      firstNextFormat = firstNode.getTextNodeFormat(formatType, null);
    }
  }

  // This is the case where we only selected a single node
  if (firstNode === lastNode) {
    if (isTextNode(firstNode)) {
      startOffset = anchorOffset > focusOffset ? focusOffset : anchorOffset;
      endOffset = anchorOffset > focusOffset ? anchorOffset : focusOffset;

      // No actual text is selected, so do nothing.
      if (startOffset === endOffset) {
        return;
      }
      // The entire node is selected, so just format it
      if (startOffset === 0 && endOffset === firstNodeTextLength) {
        firstNode.setFormat(firstNextFormat);
        firstNode.select(startOffset, endOffset);
      } else {
        // ndoe is partially selected, so split it into two nodes
        // adnd style the selected one.
        const splitNodes = firstNode.splitText(startOffset, endOffset);
        const replacement = startOffset === 0 ? splitNodes[0] : splitNodes[1];
        replacement.setFormat(firstNextFormat);
        replacement.select(0, endOffset - startOffset);
      }
    }
    // multiple nodes selected.
  } else {
    if (isTextNode(firstNode)) {
      if (startOffset !== 0) {
        // the entire first node isn't selected, so split it
        [, firstNode] = firstNode.splitText(startOffset);
        startOffset = 0;
      }
      firstNode.setFormat(firstNextFormat);
    }
    let lastNextFormat = firstNextFormat;

    if (isTextNode(lastNode)) {
      lastNextFormat = lastNode.getTextNodeFormat(formatType, firstNextFormat);
      const lastNodeText = lastNode.getTextContent();
      const lastNodeTextLength = lastNodeText.length;
      // if the entire last node isn't selected, so split it
      if (endOffset !== lastNodeTextLength) {
        [lastNode] = lastNode.splitText(endOffset);
      }
      lastNode.setFormat(lastNextFormat);
    }

    // deal with all the nodes in between
    for (let i = 1; i < lastIndex; i++) {
      const selectedNode = selectedNodes[i];
      const selectedNodeKey = selectedNode.getKey();
      if (
        isTextNode(selectedNode) &&
        selectedNodeKey !== firstNode.getKey() &&
        selectedNodeKey !== lastNode.getKey() &&
        !selectedNode.isImmutable()
      ) {
        const selectedNextFormat = selectedNode.getTextNodeFormat(
          formatType,
          lastNextFormat,
        );
        selectedNode.setFormat(selectedNextFormat);
      }
    }
  }
}

export function insertParagraph(selection: Selection): void {
  if (!selection.isCollapsed()) {
    removeText(selection);
  }
  const anchor = selection.anchor;
  const anchorOffset = anchor.offset;
  let currentBlock;
  let nodesToMove = [];

  if (anchor.type === 'text') {
    const anchorNode = anchor.getNode();
    const textContent = anchorNode.getTextContent();
    const textContentLength = textContent.length;
    nodesToMove = anchorNode.getNextSiblings().reverse();
    currentBlock = anchorNode.getParentBlockOrThrow();

    if (anchorOffset === 0) {
      nodesToMove.push(anchorNode);
    } else if (anchorOffset !== textContentLength) {
      const [, splitNode] = anchorNode.splitText(anchorOffset);
      nodesToMove.push(splitNode);
    }
  } else {
    currentBlock = anchor.getNode();
    nodesToMove = currentBlock.getChildren().slice(anchorOffset).reverse();
  }
  const newBlock = currentBlock.insertNewAfter(selection);
  if (newBlock === null) {
    // Handle as a line break insertion
    insertLineBreak(selection);
  } else if (isBlockNode(newBlock)) {
    const nodesToMoveLength = nodesToMove.length;
    let firstChild = null;

    if (nodesToMoveLength === 0) {
      newBlock.select(0, 0);
    } else {
      for (let i = 0; i < nodesToMoveLength; i++) {
        const nodeToMove = nodesToMove[i];
        if (firstChild === null) {
          newBlock.append(nodeToMove);
        } else {
          firstChild.insertBefore(nodeToMove);
        }
        firstChild = nodeToMove;
      }
    }
    newBlock.selectStart();
  }
}

function moveCaretSelection(
  selection: Selection,
  isHoldingShift: boolean,
  isBackward: boolean,
  granularity: 'character' | 'word' | 'lineboundary',
): void {
  updateCaretSelectionForRange(
    selection,
    isBackward,
    granularity,
    !isHoldingShift,
  );
}

function isTopLevelBlockRTL(selection: Selection): boolean {
  const anchorNode = selection.anchor.getNode();
  const topLevelBlock = anchorNode.getTopParentBlockOrThrow();
  const direction = topLevelBlock.getDirection();
  return direction === 'rtl';
}

export function moveCharacter(
  selection: Selection,
  isHoldingShift: boolean,
  isBackward: boolean,
): void {
  const isRTL = isTopLevelBlockRTL(selection);
  moveCaretSelection(
    selection,
    isHoldingShift,
    isBackward ? !isRTL : isRTL,
    'character',
  );
}

export function deleteLineBackward(selection: Selection): void {
  if (selection.isCollapsed()) {
    updateCaretSelectionForRange(selection, true, 'lineboundary', false);
  }
  removeText(selection);
}

export function deleteLineForward(selection: Selection): void {
  if (selection.isCollapsed()) {
    updateCaretSelectionForRange(selection, false, 'lineboundary', false);
  }
  removeText(selection);
}

export function deleteWordBackward(selection: Selection): void {
  if (selection.isCollapsed()) {
    updateCaretSelectionForRange(selection, true, 'word', false);
  }
  removeText(selection);
}

export function deleteWordForward(selection: Selection): void {
  if (selection.isCollapsed()) {
    updateCaretSelectionForRange(selection, false, 'word', false);
  }
  removeText(selection);
}

export function updateCaretSelectionForUnicodeCharacter(
  selection: Selection,
  isBackward: boolean,
): void {
  const anchor = selection.anchor;
  const focus = selection.focus;
  const anchorNode = anchor.getNode();
  const focusNode = focus.getNode();

  if (
    anchorNode === focusNode &&
    anchor.type === 'text' &&
    focus.type === 'text'
  ) {
    // Handling of multibyte characters
    const anchorOffset = anchor.offset;
    const focusOffset = focus.offset;
    const isBefore = anchorOffset < focusOffset;
    const startOffset = isBefore ? anchorOffset : focusOffset;
    const endOffset = isBefore ? focusOffset : anchorOffset;
    const characterOffset = endOffset - 1;

    if (startOffset !== characterOffset) {
      const text = anchorNode.getTextContent().slice(startOffset, endOffset);
      if (!doesContainGrapheme(text)) {
        if (isBackward) {
          focus.offset = characterOffset;
        } else {
          anchor.offset = characterOffset;
        }
      }
    }
  } else {
    // TODO Handling of multibyte characters
  }
}

export function updateCaretSelectionForAdjacentHashtags(
  selection: Selection,
): void {
  const anchor = selection.anchor;
  if (anchor.type !== 'text') {
    return;
  }
  let anchorNode = anchor.getNode();
  const textContent = anchorNode.getTextContent();
  const anchorOffset = selection.anchor.offset;

  if (anchorOffset === 0 && anchorNode.isSimpleText()) {
    let sibling = anchorNode.getPreviousSibling();
    if (isTextNode(sibling) && isHashtagNode(sibling)) {
      sibling.select();
      const siblingTextContent = sibling.getTextContent();
      sibling = sibling.setTextContent(siblingTextContent + textContent);
      anchorNode.remove();
    }
  } else if (
    isHashtagNode(anchorNode) &&
    anchorOffset === anchorNode.getTextContentSize()
  ) {
    const sibling = anchorNode.getNextSibling();
    if (isTextNode(sibling) && sibling.isSimpleText()) {
      const siblingTextContent = sibling.getTextContent();
      anchorNode = anchorNode.setTextContent(textContent + siblingTextContent);
      sibling.remove();
    }
  }
}

function deleteCharacter(selection: Selection, isBackward: boolean): void {
  if (selection.isCollapsed()) {
    updateCaretSelectionForRange(selection, isBackward, 'character', false);
    const anchor = selection.anchor;
    const focus = selection.focus;

    if (!selection.isCollapsed()) {
      const focusNode = focus.type === 'text' ? focus.getNode() : null;
      const anchorNode = anchor.type === 'text' ? anchor.getNode() : null;

      if (focusNode !== null && focusNode.isSegmented()) {
        const offset = focus.offset;
        const textContentSize = focusNode.getTextContentSize();
        if (
          focusNode.is(anchorNode) ||
          (isBackward && offset !== textContentSize) ||
          (!isBackward && offset !== 0)
        ) {
          removeSegment(focusNode, isBackward);
          return;
        }
      } else if (anchorNode !== null && anchorNode.isSegmented()) {
        const offset = anchor.offset;
        const textContentSize = anchorNode.getTextContentSize();
        if (
          anchorNode.is(focusNode) ||
          (isBackward && offset !== 0) ||
          (!isBackward && offset !== textContentSize)
        ) {
          removeSegment(anchorNode, isBackward);
          return;
        }
      }
      updateCaretSelectionForUnicodeCharacter(selection, isBackward);
    } else if (isBackward && anchor.offset === 0) {
      // Special handling around rich text nodes
      const block =
        anchor.type === 'block'
          ? anchor.getNode()
          : anchor.getNode().getParentOrThrow();
      if (block.collapseAtStart(selection)) {
        return;
      }
    }
  }
  removeText(selection);
  updateCaretSelectionForAdjacentHashtags(selection);
}

export function deleteBackward(selection: Selection): void {
  deleteCharacter(selection, true);
}

export function deleteForward(selection: Selection): void {
  deleteCharacter(selection, false);
}

function removeSegment(node: TextNode, isBackward: boolean): void {
  let textNode = node;
  const textContent = textNode.getTextContent();
  const split = textContent.split(/\s/g);

  if (isBackward) {
    split.pop();
  } else {
    split.shift();
  }
  const nextTextContent = split.join(' ');

  if (nextTextContent === '') {
    textNode.remove();
  } else {
    textNode = textNode.setTextContent(nextTextContent);
    if (isBackward) {
      textNode.select();
    } else {
      textNode.select(0, 0);
    }
  }
}

function moveSelection(
  domSelection,
  collapse: boolean,
  isBackward: boolean,
  granularity: 'character' | 'word' | 'lineboundary',
): void {
  domSelection.modify(
    collapse ? 'move' : 'extend',
    isBackward ? 'backward' : 'forward',
    granularity,
  );
}

export function updateCaretSelectionForRange(
  selection: Selection,
  isBackward: boolean,
  granularity: 'character' | 'word' | 'lineboundary',
  collapse: boolean,
): void {
  const domSelection = window.getSelection();
  const focus = selection.focus;
  const anchor = selection.anchor;

  // Handle the selection movement around decorators.
  const possibleDecoratorNode = getPossibleDecoratorNode(focus, isBackward);

  if (isDecoratorNode(possibleDecoratorNode)) {
    const sibling = isBackward
      ? possibleDecoratorNode.getPreviousSibling()
      : possibleDecoratorNode.getNextSibling();
    if (!isTextNode(sibling)) {
      const blockKey = possibleDecoratorNode.getParentOrThrow().getKey();
      const offset = possibleDecoratorNode.getIndexWithinParent();
      focus.set(blockKey, offset, 'block');
      if (collapse) {
        anchor.set(blockKey, offset, 'block');
      }
      return;
    }
  }
  // We use the DOM selection.modify API here to "tell" us what the selection
  // will be. We then use it to update the Outline selection accordingly. This
  // is much more reliable than waiting for a beforeinput and using the ranges
  // from getTargetRanges(), and is also better than trying to do it ourselves
  // using Intl.Segmenter or other workarounds that struggle with word segments
  // and line segments (especially with word wrapping and non-Roman languages).
  moveSelection(domSelection, collapse, isBackward, granularity);
  // Guard against no ranges
  if (domSelection.rangeCount > 0) {
    const range = domSelection.getRangeAt(0);
    // Apply the DOM selection to our Outline selection.
    selection.applyDOMRange(range);
    // Because a range works on start and end, we might need to flip
    // the anchor and focus points to match what the DOM has, not what
    // the range has specifically.
    if (
      !collapse &&
      (domSelection.anchorNode !== range.startContainer ||
        domSelection.anchorOffset !== range.startOffset)
    ) {
      selection.swapPoints();
    }
  }
}

export function removeText(selection: Selection): void {
  insertText(selection, '');
}

export function insertLineBreak(
  selection: Selection,
  selectStart?: boolean,
): void {
  const lineBreakNode = createLineBreakNode();
  if (selectStart) {
    insertNodes(selection, [lineBreakNode], true);
  } else {
    if (insertNodes(selection, [lineBreakNode])) {
      lineBreakNode.selectNext(0, 0);
    }
  }
}

export function insertNodes(
  selection: Selection,
  nodes: Array<OutlineNode>,
  selectStart?: boolean,
): boolean {
  // If there is a range selected remove the text in it
  if (!selection.isCollapsed()) {
    removeText(selection);
  }
  const anchor = selection.anchor;
  const anchorOffset = anchor.offset;
  const anchorNode = anchor.getNode();
  let target = anchorNode;

  if (anchor.type === 'block') {
    const block = anchor.getNode();
    const placementNode = block.getChildAtIndex(anchorOffset - 1);
    if (placementNode === null) {
      target = block;
    } else {
      target = placementNode;
    }
  }
  const siblings = [];

  // Get all remaining text node siblings in this block so we can
  // append them after the last node we're inserting.
  const nextSiblings = anchorNode.getNextSiblings();
  const topLevelBlock = anchorNode.getTopParentBlockOrThrow();

  if (isTextNode(anchorNode)) {
    const textContent = anchorNode.getTextContent();
    const textContentLength = textContent.length;
    if (anchorOffset === 0 && textContentLength !== 0) {
      const prevSibling = anchorNode.getPreviousSibling();
      if (prevSibling !== null) {
        target = prevSibling;
      } else {
        target = anchorNode.getParentOrThrow();
      }
      siblings.push(anchorNode);
    } else if (anchorOffset === textContentLength) {
      target = anchorNode;
    } else if (isImmutableOrInert(anchorNode)) {
      // Do nothing if we're inside an immutable/inert node
      return false;
    } else {
      // If we started with a range selected grab the danglingText after the
      // end of the selection and put it on our siblings array so we can
      // append it after the last node we're inserting
      let danglingText;
      [target, danglingText] = anchorNode.splitText(anchorOffset);
      siblings.push(danglingText);
    }
  }
  const startingNode = target;

  siblings.push(...nextSiblings);

  const firstNode = nodes[0];

  // Time to insert the nodes!
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];

    if (isBlockNode(node)) {
      // If we have an incoming block node as the first node, then we'll need
      // see if we can merge any descendant leafe nodes into our existing target.
      // We can do this by finding the first descendant in our node and then we can
      // pluck it and its parent (siblings included) out and insert them directly
      // into our target. We only do this for the first node, as we are only
      // interested in merging with the anchor, which is our target.

      if (node.is(firstNode)) {
        if (
          isBlockNode(target) &&
          target.isEmpty() &&
          target.canReplaceWith(node)
        ) {
          target.replace(node);
          target = node;
          continue;
        }
        // We may have a node tree where there are many levels, for example with
        // lists and tables. So let's find the first descendant to try and merge
        // with. So if we have the target:
        //
        // Paragraph (1)
        //   Text (2)
        //
        // and we are trying to insert:
        //
        // ListNode (3)
        //   ListItemNode (4)
        //     Text (5)
        //   ListItemNode (6)
        //
        // The result would be:
        //
        // Paragraph (1)
        //   Text (2)
        //   Text (5)
        //

        const firstDescendant = node.getFirstDescendant();
        if (isLeafNode(firstDescendant)) {
          const block = firstDescendant.getParentOrThrow();
          const children = block.getChildren();
          const childrenLength = children.length;
          if (isBlockNode(target)) {
            for (let s = 0; s < childrenLength; s++) {
              target.append(children[s]);
            }
          } else {
            for (let s = childrenLength - 1; s >= 0; s--) {
              target.insertAfter(children[s]);
            }
            target = target.getParentOrThrow();
          }
          block.remove();
          if (block.is(node)) {
            continue;
          }
        }
      }
      if (isTextNode(target)) {
        target = topLevelBlock;
      }
    }
    if (isBlockNode(target)) {
      if (!isBlockNode(node)) {
        const firstChild = target.getFirstChild();
        if (firstChild !== null) {
          firstChild.insertBefore(node);
        } else {
          target.append(node);
        }
        target = node;
      } else {
        if (!node.canBeEmpty() && node.isEmpty()) {
          continue;
        }
        target = target.insertAfter(node);
      }
    } else if (!isBlockNode(node)) {
      target = target.insertAfter(node);
    } else {
      target = node.getParentOrThrow();
      // Re-try again with the target being the parent
      i--;
      continue;
    }
  }

  if (selectStart) {
    // Handle moving selection to start for all nodes
    if (isTextNode(startingNode)) {
      startingNode.select();
    } else {
      const prevSibling = target.getPreviousSibling();
      if (isTextNode(prevSibling)) {
        prevSibling.select();
      } else {
        const index = target.getIndexWithinParent();
        target.getParentOrThrow().select(index, index);
      }
    }
  }

  if (isBlockNode(target)) {
    const lastChild = target.getLastDescendant();
    if (!selectStart) {
      // Handle moving selection to end for blocks
      if (lastChild === null) {
        target.select();
      } else if (isTextNode(lastChild)) {
        lastChild.select();
      } else {
        lastChild.selectNext();
      }
    }
    if (siblings.length !== 0) {
      for (let i = siblings.length - 1; i >= 0; i--) {
        const sibling = siblings[i];
        const prevParent = sibling.getParent();

        if (isBlockNode(target) && !isBlockNode(sibling)) {
          target.append(sibling);
          target = sibling;
        } else {
          target.insertAfter(sibling);
        }
        // Check if the prev parent is empty, as it might need
        // removing.
        if (
          isBlockNode(prevParent) &&
          prevParent.isEmpty() &&
          !prevParent.canBeEmpty()
        ) {
          prevParent.remove();
        }
      }
    }
  } else if (!selectStart) {
    // Handle moving selection to end for other nodes
    if (isTextNode(target)) {
      target.select();
    } else {
      const block = target.getParentOrThrow();
      const index = target.getIndexWithinParent() + 1;
      block.select(index, index);
    }
  }
  return true;
}

export function insertRichText(selection: Selection, text: string): void {
  const parts = text.split(/\r?\n/);
  if (parts.length === 1) {
    insertText(selection, text);
  } else {
    const nodes = [];
    const length = parts.length;
    for (let i = 0; i < length; i++) {
      const part = parts[i];
      if (part !== '') {
        nodes.push(createTextNode(part));
      }
      if (i !== length - 1) {
        nodes.push(createLineBreakNode());
      }
    }
    insertNodes(selection, nodes);
  }
}

function transferStartingBlockPointToTextPoint(start: BlockPoint, end: Point) {
  const block = start.getNode();
  const placementNode = block.getChildAtIndex(start.offset);
  const textNode = createTextNode();
  if (placementNode === null) {
    block.append(textNode);
  } else {
    placementNode.insertBefore(textNode);
  }
  // If we are inserting a node to the start point, then we'll need to
  // adjust the offset of the end point accordingly. Either by making it
  // the same text node, or by increasing the offset to account for the
  //
  if (end.type === 'block' && block.is(end.getNode())) {
    if (end.offset === start.offset) {
      end.set(textNode.getKey(), 0, 'text');
    } else {
      end.offset++;
    }
  }
  // Transfer the block point to a text point.
  start.set(textNode.getKey(), 0, 'text');
}

export function insertText(selection: Selection, text: string): void {
  const anchor = selection.anchor;
  const focus = selection.focus;
  const isBefore = selection.isCollapsed() || anchor.isBefore(focus);

  if (isBefore && anchor.type === 'block') {
    transferStartingBlockPointToTextPoint(anchor, focus);
  } else if (!isBefore && focus.type === 'block') {
    transferStartingBlockPointToTextPoint(focus, anchor);
  }
  const selectedNodes = selection.getNodes();
  const selectedNodesLength = selectedNodes.length;
  const textFormat = selection.textFormat;
  const firstPoint = isBefore ? anchor : focus;
  const endPoint = isBefore ? focus : anchor;
  const startOffset = firstPoint.offset;
  const endOffset = endPoint.offset;
  let firstNode: OutlineNode = selectedNodes[0];

  if (!isTextNode(firstNode)) {
    invariant(false, 'insertText: first node is not a text node');
  }
  const firstNodeText = firstNode.getTextContent();
  const firstNodeTextLength = firstNodeText.length;
  if (
    firstNode.isSegmented() ||
    firstNode.isImmutable() ||
    !firstNode.canInsertTextAtEnd()
  ) {
    const offset = firstPoint.offset;
    if (selection.isCollapsed() && offset === firstNodeTextLength) {
      let nextSibling = firstNode.getNextSibling();
      if (
        !isTextNode(nextSibling) ||
        isImmutableOrInert(nextSibling) ||
        nextSibling.isSegmented()
      ) {
        nextSibling = createTextNode();
        firstNode.insertAfter(nextSibling);
      }
      nextSibling.select(0, 0);
      firstNode = nextSibling;
      if (text !== '') {
        insertText(selection, text);
        return;
      }
    } else if (selection.isCollapsed() && offset === 0) {
      let prevSibling = firstNode.getPreviousSibling();
      if (
        !isTextNode(prevSibling) ||
        isImmutableOrInert(prevSibling) ||
        prevSibling.isSegmented()
      ) {
        prevSibling = createTextNode();
        firstNode.insertBefore(prevSibling);
      }
      prevSibling.select();
      firstNode = prevSibling;
      if (text !== '') {
        insertText(selection, text);
        return;
      }
    } else if (firstNode.isSegmented() && offset !== firstNodeTextLength) {
      const textNode = createTextNode(firstNode.getTextContent());
      firstNode.replace(textNode);
      firstNode = textNode;
    }
  }

  if (selectedNodesLength === 1) {
    if (isImmutableOrInert(firstNode)) {
      firstNode.remove();
      return;
    }
    const firstNodeFormat = firstNode.getFormat();

    if (startOffset === endOffset && firstNodeFormat !== textFormat) {
      if (firstNode.getTextContent() === '') {
        firstNode.setFormat(textFormat);
      } else {
        const [targetNode] = firstNode.splitText(startOffset);
        const textNode = createTextNode(text);
        textNode.setFormat(textFormat);
        targetNode.insertAfter(textNode);
        textNode.select();
        return;
      }
    }
    const delCount = endOffset - startOffset;

    firstNode = firstNode.spliceText(startOffset, delCount, text, true);
    if (firstNode.getTextContent() === '') {
      firstNode.remove();
    } else if (firstNode.isComposing() && selection.anchor.type === 'text') {
      selection.anchor.offset -= text.length;
    }
  } else {
    const lastIndex = selectedNodesLength - 1;
    let lastNode = selectedNodes[lastIndex];
    const markedNodeKeysForKeep = new Set([
      ...firstNode.getParentKeys(),
      ...lastNode.getParentKeys(),
    ]);
    const firstBlock = isBlockNode(firstNode)
      ? firstNode
      : firstNode.getParentOrThrow();
    const lastBlock = isBlockNode(lastNode)
      ? lastNode
      : lastNode.getParentOrThrow();

    // Handle mutations to the last node.
    if (
      (endPoint.type === 'text' &&
        (endOffset !== 0 || lastNode.getTextContent() === '')) ||
      (endPoint.type === 'block' && lastNode.getIndexWithinParent() < endOffset)
    ) {
      if (
        isTextNode(lastNode) &&
        !isImmutableOrInert(lastNode) &&
        endOffset !== lastNode.getTextContentSize()
      ) {
        if (lastNode.isSegmented()) {
          const textNode = createTextNode(lastNode.getTextContent());
          lastNode.replace(textNode);
          lastNode = textNode;
        }
        lastNode = lastNode.spliceText(0, endOffset, '');
        markedNodeKeysForKeep.add(lastNode.getKey());
      } else {
        lastNode.remove();
      }
    } else {
      markedNodeKeysForKeep.add(lastNode.getKey());
    }

    // Either move the remaining nodes of the last parent to after
    // the first child, or remove them entirely. If the last parent
    // is the same as the first parent, this logic also works.
    const lastNodeChildren = lastBlock.getChildren();
    const selectedNodesSet = new Set(selectedNodes);
    const firstAndLastBlocksAreEqual = firstBlock.is(lastBlock);

    for (let i = lastNodeChildren.length - 1; i >= 0; i--) {
      const lastNodeChild = lastNodeChildren[i];

      if (lastNodeChild.is(firstNode)) {
        break;
      }

      if (lastNodeChild.isAttached()) {
        if (
          !selectedNodesSet.has(lastNodeChild) ||
          lastNodeChild.is(lastNode)
        ) {
          if (!firstAndLastBlocksAreEqual) {
            firstNode.insertAfter(lastNodeChild);
          }
        } else {
          lastNodeChild.remove();
        }
      }
    }

    if (!firstAndLastBlocksAreEqual) {
      // Check if we have already moved out all the nodes of the
      // last parent, and if so, traverse the parent tree and mark
      // them all as being able to deleted too.
      let parent = lastBlock;
      let lastRemovedParent = null;
      while (parent !== null) {
        const children = parent.getChildren();
        const childrenLength = children.length;
        if (
          childrenLength === 0 ||
          children[childrenLength - 1].is(lastRemovedParent)
        ) {
          markedNodeKeysForKeep.delete(parent.getKey());
          lastRemovedParent = parent;
        }
        parent = parent.getParent();
      }
    }

    // Ensure we do splicing after moving of nodes, as splicing
    // can have side-effects (in the case of hashtags).
    if (!isImmutableOrInert(firstNode)) {
      firstNode = firstNode.spliceText(
        startOffset,
        firstNodeTextLength - startOffset,
        text,
        true,
      );
      if (firstNode.getTextContent() === '') {
        firstNode.remove();
      } else if (firstNode.isComposing() && selection.anchor.type === 'text') {
        selection.anchor.offset -= text.length;
      }
    } else if (startOffset === firstNodeTextLength) {
      firstNode.select();
    } else {
      firstNode.remove();
    }

    // Remove all selected nodes that haven't already been removed.
    for (let i = 1; i < selectedNodesLength; i++) {
      const selectedNode = selectedNodes[i];
      if (!markedNodeKeysForKeep.has(selectedNode.getKey())) {
        selectedNode.remove();
      }
    }
  }
}

export function selectAll(selection: Selection): void {
  const anchor = selection.anchor;
  const focus = selection.focus;
  const anchorNode = anchor.getNode();
  const topParent = anchorNode.getTopParentBlockOrThrow();
  const root = topParent.getParentOrThrow();
  let firstNode = root.getFirstDescendant();
  let lastNode = root.getLastDescendant();
  let firstType = 'block';
  let lastType = 'block';
  let lastOffset = 0;

  if (isTextNode(firstNode)) {
    firstType = 'text';
  } else if (!isBlockNode(firstNode) && firstNode !== null) {
    firstNode = firstNode.getParentOrThrow();
  }
  if (isTextNode(lastNode)) {
    lastType = 'text';
    lastOffset = lastNode.getTextContentSize();
  } else if (!isBlockNode(lastNode) && lastNode !== null) {
    lastNode = lastNode.getParentOrThrow();
    lastOffset = lastNode.getChildrenSize();
  }
  if (firstNode && lastNode) {
    anchor.set(firstNode.getKey(), 0, firstType);
    focus.set(lastNode.getKey(), lastOffset, lastType);
  }
}
