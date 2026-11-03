// eslint-disable-next-line import/no-unresolved -- Resolved by the real server's plugin loader, never by Mobile.
import { Plugin } from '@opencode/plugin';

// A real server plugin: no model/provider credentials or mobile runtime needed.
export default Plugin.define({
  id: 'mobile.command-fixture',
  async setup(ctx) {
    await ctx.session.hook('prompt', (input) => {
      input.prompt.text = `Server hook: ${input.prompt.text}`;
    });
    const record = async (input) => {
      await ctx.session.update({ sessionID: input.sessionID, metadata: {
        commandFixture: { directory: ctx.location.directory, prompt: input.prompt, delivery: input.delivery },
      } });
    };
    await ctx.command.transform((editor) => {
      editor.add({ name: 'mobile-echo', description: 'Echo from the server plugin', execute: record });
      editor.add({ name: 'Mobile-Echo', description: 'A distinct case-sensitive command', execute: record });
      editor.add({ name: 'review', description: 'Plugin override', execute: record });
      editor.add({ name: 'mobile-fail', description: 'Fail on the server', execute: async () => {
        throw new Error('Fixture command failed');
      } });
      editor.add({ name: 'mobile-hook', description: 'Forward through the server prompt hook', execute: async (input) => {
        await ctx.session.prompt({ sessionID: input.sessionID, ...input.prompt, delivery: input.delivery });
      } });
    });
  },
});
