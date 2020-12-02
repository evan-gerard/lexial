// @flow strict

import type {ViewType} from './OutlineView';
import type {OutlineNode, NodeKey} from './OutlineNode';
import type {Node as ReactNode} from 'react';

import {createRoot, RootNode, TextNode, ParagraphNode, ListItemNode} from '.';
import {
  applyTextTransforms,
  cloneViewModel,
  enterViewModelScope,
  garbageCollectDetachedNodes,
  viewModelHasDirtySelection,
  ViewModel,
  commitPendingUpdates,
  triggerUpdateListeners,
} from './OutlineView';
import {createSelection} from './OutlineSelection';
import {generateRandomKey} from './OutlineUtils';

export function createEditor(): OutlineEditor {
  const root = createRoot();
  const viewModel = new ViewModel(root);
  viewModel.nodeMap.root = root;
  return new OutlineEditor(viewModel);
}

export type onChangeType = (
  viewModel: ViewModel,
  nodeDecorators: {[NodeKey]: ReactNode},
) => void;

export class OutlineEditor {
  _editorElement: null | HTMLElement;
  _viewModel: ViewModel;
  _pendingViewModel: null | ViewModel;
  _isComposing: boolean;
  _key: string;
  _keyToDOMMap: Map<NodeKey, HTMLElement>;
  _updateListeners: Set<onChangeType>;
  _updateTimeStamp: number;
  _textTransforms: Set<(node: TextNode, view: ViewType) => void>;
  _registeredNodeTypes: Map<string, Class<OutlineNode>>;
  _needsReconcile: boolean;
  _nodeDecorators: {[NodeKey]: ReactNode};
  _pendingNodeDecorators: null | {[NodeKey]: ReactNode};

  constructor(viewModel: ViewModel) {
    // The editor element associated with this editor
    this._editorElement = null;
    // The current view model
    this._viewModel = viewModel;
    // Handling of drafts and updates
    this._pendingViewModel = null;
    // Used to help co-ordinate events through plugins
    this._isComposing = false;
    // Used during reconcilation
    this._keyToDOMMap = new Map();
    // onChange listeners
    this._updateListeners = new Set();
    this._updateTimeStamp = 0;
    // Handling of transform
    this._textTransforms = new Set();
    // Mapping of types to their nodes
    this._registeredNodeTypes = new Map([
      ['text', TextNode],
      ['root', RootNode],
      ['paragraph', ParagraphNode],
      ['listitem', ListItemNode],
    ]);
    this._key = generateRandomKey();
    // React node decorators for portals
    this._nodeDecorators = {};
    // Outline tries to garbage collect nodes
    // so if it garbage collects a node with
    // a decorator, it should set the next
    // decorators to pending until the update
    // is complete.
    this._pendingNodeDecorators = null;
  }
  isComposing(): boolean {
    return this._isComposing;
  }
  setComposing(isComposing: boolean): void {
    this._isComposing = isComposing;
  }
  addNodeDecorator(key: NodeKey, decorator: ReactNode): void {
    const nodeDecorators = {...this._nodeDecorators};
    nodeDecorators[key] = decorator;
    this._nodeDecorators = nodeDecorators;
    if (this._pendingViewModel === null) {
      triggerUpdateListeners(this);
    }
  }
  addNodeType(nodeType: string, klass: Class<OutlineNode>): () => void {
    this._registeredNodeTypes.set(nodeType, klass);
    return () => {
      this._registeredNodeTypes.delete(nodeType);
    };
  }
  addUpdateListener(onChange: onChangeType): () => void {
    this._updateListeners.add(onChange);
    return () => {
      this._updateListeners.delete(onChange);
    };
  }
  addTextTransform(
    transformFn: (node: TextNode, view: ViewType) => void,
  ): () => void {
    this._textTransforms.add(transformFn);
    return () => {
      this._textTransforms.delete(transformFn);
    };
  }
  getNodeDecorators(): {[NodeKey]: ReactNode} {
    return this._nodeDecorators;
  }
  getEditorKey(): string {
    return this._key;
  }
  getEditorElement(): null | HTMLElement {
    return this._editorElement;
  }
  setEditorElement(editorElement: null | HTMLElement): void {
    this._editorElement = editorElement;
    if (editorElement === null) {
      this._keyToDOMMap.delete('root');
    } else {
      this._keyToDOMMap.set('root', editorElement);
      const pendingViewModel = this._pendingViewModel;
      if (pendingViewModel !== null) {
        this._pendingViewModel = null;
        commitPendingUpdates(this);
      }
    }
  }
  getElementByKey(key: NodeKey): HTMLElement {
    const element = this._keyToDOMMap.get(key);
    if (element === undefined) {
      throw new Error('getElementByKey failed for key ' + key);
    }
    return element;
  }
  getViewModel(): ViewModel {
    return this._viewModel;
  }
  setViewModel(viewModel: ViewModel): void {
    if (this._pendingViewModel !== null) {
      commitPendingUpdates(this);
    }
    this._pendingViewModel = viewModel;
    commitPendingUpdates(this);
  }
  update(callbackFn: (view: ViewType) => void, timeStamp?: number): boolean {
    let pendingViewModel = this._pendingViewModel;

    if (this._updateTimeStamp !== timeStamp) {
      if (pendingViewModel !== null) {
        commitPendingUpdates(this);
        pendingViewModel = null;
      }
      if (timeStamp !== undefined) {
        this._updateTimeStamp = timeStamp;
      }
    }
    let viewModelWasCloned = false;

    if (pendingViewModel === null) {
      pendingViewModel = this._pendingViewModel = cloneViewModel(
        this._viewModel,
      );
      viewModelWasCloned = true;
    }
    const currentPendingViewModel = pendingViewModel;

    enterViewModelScope(
      (view: ViewType) => {
        if (viewModelWasCloned) {
          currentPendingViewModel.selection = createSelection(
            currentPendingViewModel,
            this,
          );
        }
        callbackFn(view);
        if (currentPendingViewModel.hasDirtyNodes()) {
          applyTextTransforms(currentPendingViewModel, this);
          garbageCollectDetachedNodes(currentPendingViewModel, this);
        }
      },
      pendingViewModel,
      false,
    );
    const shouldUpdate =
      pendingViewModel.hasDirtyNodes() ||
      viewModelHasDirtySelection(pendingViewModel, this);

    if (!shouldUpdate) {
      this._pendingViewModel = null;
      return false;
    }
    if (timeStamp === undefined) {
      commitPendingUpdates(this);
    } else if (viewModelWasCloned) {
      Promise.resolve().then(() => {
        commitPendingUpdates(this);
      });
    }
    return true;
  }
}
