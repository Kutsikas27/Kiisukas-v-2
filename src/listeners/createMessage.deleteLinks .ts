import { Listener } from "@sapphire/framework";
import type { Events, Message } from "discord.js";

export class UserListener extends Listener<Events.MessageCreate> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, {
      ...options,
      event: "messageCreate",
    });
  }
  public async run(message: Message) {
    if (message.author.id === process.env.OWNER_ID || !message.member) return;
    if (message.member.roles.cache.size === 1) {
      if (
        message.content.match(
          /(http|https):\/\/[^\s]+|discord\.com\/invite\/\w+/gi,
        )
      ) {
        await message.delete();
      }
    }
  }
}

