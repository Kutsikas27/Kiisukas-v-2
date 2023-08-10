import { Listener } from "@sapphire/framework";
import type { Events, GuildMember } from "discord.js";
import { ChannelType } from "discord.js";

export class UserListener extends Listener<Events.GuildMemberAdd> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, {
      ...options,
      event: "guildMemberAdd",
    });
  }
  public async run(member: GuildMember) {
    const channel = member.guild.channels.cache.get(
      process.env.MAIN_CHANNEL_ID || "",
    );
    if (!channel) return console.log("MAIN_CHANNEL_ID on seadistamata");
    if (channel.type !== ChannelType.GuildText) {
      return console.log(this.name, `Ei ole tekstikanal`);
    }

    await channel.send(`<@${member.id}> liitus serveriga! 👋`);
  }
}
