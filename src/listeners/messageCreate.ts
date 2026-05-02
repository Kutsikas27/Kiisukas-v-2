import { ApplyOptions } from "@sapphire/decorators";
import { Listener } from "@sapphire/framework";
import type { Message } from "discord.js";
import { ActivityService } from "../services/activity.service";

@ApplyOptions<Listener.Options>({
  event: "messageCreate",
})
export class MessageCreateListener extends Listener {
  public override async run(message: Message) {
    if (!message.guild) return;
    if (message.author.bot) return;
    if (message.system) return;

    try {
      await ActivityService.recordMessage({
        guildId: message.guild.id,
        userId: message.author.id,
        content: message.content ?? "",
        createdAt: message.createdAt.toISOString(),
      });
    } catch (error) {
      console.error(
        "Sõnumi statistika MongoDB-sse salvestamine ebaõnnestus:",
        error,
      );
    }
  }
}
