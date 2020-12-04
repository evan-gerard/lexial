// @flow strict-local

import type {OutlineEditor, View, NodeKey} from 'outline';

import {useEffect} from 'react';
import {TextNode} from 'outline';

const baseEmojiStyle =
  'background-size: 16px 16px;' +
  'height: 16px;' +
  'width: 16px;' +
  'background-position: center;' +
  'background-repeat: no-repeat;' +
  'display: inline-block;' +
  'margin: 0 1px;' +
  'text-align: center;' +
  'vertical-align: middle;';

const happySmile =
  baseEmojiStyle +
  'background-image: url(https://static.xx.fbcdn.net/images/emoji.php/v9/t4c/1/16/1f642.png);';
const veryHappySmile =
  baseEmojiStyle +
  'background-image: url(https://static.xx.fbcdn.net/images/emoji.php/v9/t51/1/16/1f603.png);';
const unhappySmile =
  baseEmojiStyle +
  'background-image: url(https://static.xx.fbcdn.net/images/emoji.php/v9/tcb/1/16/1f641.png);';
const heart =
  baseEmojiStyle +
  'background-image: url(https://static.xx.fbcdn.net/images/emoji.php/v9/t6c/1/16/2764.png);';

const specialSpace = '　';

const emojis: {[string]: string} = {
  ':)': happySmile,
  ':D': veryHappySmile,
  ':(': unhappySmile,
  '<3': heart,
};

function textNodeTransform(node: TextNode, view: View): void {
  const text = node.getTextContent();
  for (let i = 0; i < text.length; i++) {
    const possibleEmoji = text.slice(i, i + 2);
    const emojiStyle = emojis[possibleEmoji];

    if (emojiStyle !== undefined) {
      let targetNode;
      if (i === 0) {
        [targetNode] = node.splitText(i + 2);
      } else {
        [, targetNode] = node.splitText(i, i + 2);
      }
      const emojiNode = createEmoji(emojiStyle);
      targetNode.replace(emojiNode);
      emojiNode.wrapInTextNodes();
      emojiNode.selectAfter(0, 0);
      emojiNode.getParentOrThrow().normalizeTextNodes(true);
      break;
    }
  }
}

export function useEmojiPlugin(editor: null | OutlineEditor): void {
  useEffect(() => {
    if (editor !== null) {
      const removeNodeType = editor.addNodeType('emoji', EmojiNode);
      const removeTransform = editor.addTextTransform(textNodeTransform);
      return () => {
        removeNodeType();
        removeTransform();
      };
    }
  }, [editor]);
}

function createEmoji(cssText: string): EmojiNode {
  return new EmojiNode(cssText, specialSpace).makeImmutable();
}

class EmojiNode extends TextNode {
  cssText: string;

  constructor(cssText: string, text: string, key?: NodeKey) {
    super(text, key);
    this.cssText = cssText;
    // $FlowFixMe: this is an emoji type
    this.type = 'emoji';
  }
  // $FlowFixMe: TODO
  static parse(data: {
    cssText: string,
    text: string,
    flags: number,
  }): EmojiNode {
    const emoji = new EmojiNode(data.cssText, data.text);
    emoji.flags = data.flags;
    return emoji;
  }
  clone() {
    const clone = new EmojiNode(this.cssText, this.text, this.key);
    clone.parent = this.parent;
    clone.flags = this.flags;
    return clone;
  }
  createDOM() {
    const dom = super.createDOM();
    dom.style.cssText = this.cssText;
    return dom;
  }
}
