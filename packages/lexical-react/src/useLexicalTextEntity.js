/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

import type {EntityMatch} from '@lexical/text';

import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import withSubscriptions from '@lexical/react/withSubscriptions';
import {registerLexicalTextEntity} from '@lexical/text';
import {TextNode} from 'lexical';
import {useEffect} from 'react';

export default function useLexicalTextEntity<N: TextNode>(
  getMatch: (text: string) => null | EntityMatch,
  targetNode: Class<N>,
  createNode: (textNode: TextNode) => N,
): void {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return withSubscriptions(
      ...registerLexicalTextEntity(editor, getMatch, targetNode, createNode),
    );
  }, [createNode, editor, getMatch, targetNode]);
}
