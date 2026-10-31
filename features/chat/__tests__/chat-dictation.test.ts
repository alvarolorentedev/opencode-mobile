import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { it } from 'vitest';
import { createTranscriptAccumulator } from '@/shared/platform/voice/transcript-accumulate';

it('keeps the existing chat draft and checkpoints unfinished dictation across recognition ends', async () => {
  const source = await readFile(new URL('../ui/use-chat-view-voice.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('controller.ts', source, ts.ScriptTarget.Latest, true);
  let declaration = '';
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'speechInput') {
      declaration = node.parent.parent.getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(declaration);
  let callbacks: { onResult: (text: string, final: boolean) => void; onEnd: () => void };
  let draft = 'Typed prefix ';
  const context = {
    conversationActiveRef: { current: false },
    chatPreferences: { speechLocale: 'ru-RU', preferOnDeviceRecognition: true },
    speechDraftPrefixRef: { current: draft },
    dictationAccumulatorRef: { current: createTranscriptAccumulator() },
    setDraft: (value: string) => { draft = value; },
    useSpeechInput: (options: typeof callbacks) => { callbacks = options; },
  };
  runInNewContext(ts.transpileModule(declaration, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  callbacks!.onResult('Привет неверно', false);
  callbacks!.onResult('Привет', false);
  callbacks!.onEnd();
  callbacks!.onResult('мир', true);
  callbacks!.onResult('мир', true);
  assert.equal(draft, 'Typed prefix Привет мир мир');
  context.conversationActiveRef.current = true;
  callbacks!.onResult('conversation speech', true);
  assert.equal(draft, 'Typed prefix Привет мир мир');
  context.conversationActiveRef.current = false;
  context.speechDraftPrefixRef.current = `${draft} `;
  context.dictationAccumulatorRef.current.reset();
  callbacks!.onResult('你好', true);
  assert.equal(draft, 'Typed prefix Привет мир мир 你好');
});
