/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

import type {UndoManager, RelativePosition, XmlText} from 'yjs';
import type {Binding} from './Bindings';

// $FlowFixMe: need Flow typings for yjs
import {UndoManager as YjsUndoManager} from 'yjs';

export type UserState = {
  anchorPos: null | RelativePosition,
  focusPos: null | RelativePosition,
  name: string,
  color: string,
  focusing: boolean,
};

declare class Provider {
  connect(): void;
  disconnect(): void;
  awareness: {
    getLocalState(): UserState,
    setLocalState(UserState): void,
    getStates(): Array<UserState>,
    on(type: 'update', cb: () => void): void,
    off(type: 'update', cb: () => void): void,
  };
  on(type: 'sync', cb: (isSynced: boolean) => void): void;
  on(type: 'status', cb: ({status: string}) => void): void;
  // $FlowFixMe: temp
  on(type: 'update', cb: (any) => void): void;
  off(type: 'sync', cb: (isSynced: boolean) => void): void;
  // $FlowFixMe: temp
  off(type: 'update', cb: (any) => void): void;
  off(type: 'status', cb: ({status: string}) => void): void;
}

export type Operation = {
  insert: string | {...},
  attributes: {__type: string, ...},
};

export type Delta = Array<Operation>;
// $FlowFixMe: todo
export type YjsNode = Object;
// $FlowFixMe: todo
export type YjsEvent = Object;

export type {Provider};

export type {ClientID, Binding} from './Bindings';

export {createBinding} from './Bindings';

export function createUndoManager(
  binding: Binding,
  root: XmlText,
): UndoManager {
  return new YjsUndoManager(root, {
    trackedOrigins: new Set([binding, null]),
  });
}

export function initLocalState(
  provider: Provider,
  name: string,
  color: string,
  focusing: boolean,
): void {
  provider.awareness.setLocalState({
    color,
    name,
    anchorPos: null,
    focusPos: null,
    focusing: focusing,
  });
}

export function setLocalStateFocus(provider: Provider, focusing: boolean) {
  const {awareness} = provider;
  awareness.setLocalState({
    ...awareness.getLocalState(),
    focusing,
  });
}

export {
  syncYjsChangesToLexical,
  syncLexicalUpdateToYjs,
} from './SyncEditorStates';
export {syncCursorPositions} from './SyncCursors';
