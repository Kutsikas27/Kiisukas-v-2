import { type Events, Listener, type ChatInputCommandErrorPayload } from '@sapphire/framework';

const errorMessage = { content: 'Midagi läks valesti...' };

export class CoreEvent extends Listener<typeof Events.ChatInputCommandError> {
  public async run(error: Error, payload: ChatInputCommandErrorPayload) {
    console.log(error);
    if (payload.interaction.deferred) {
      await payload.interaction.followUp(errorMessage);
    } else {
      await payload.interaction.reply(errorMessage);
    }
  }
}
