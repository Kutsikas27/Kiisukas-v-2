import { Listener } from "@sapphire/framework";
import type { Events, GuildMember } from "discord.js";
import humanizeDuration from "humanize-duration";
import { ChannelType } from "discord.js";

export class UserListener extends Listener<Events.GuildMemberRemove> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, {
      ...options,
      event: "guildMemberRemove",
    });
  }

  public async run(member: GuildMember) {
    const channel = member.guild.channels.cache.get(
      process.env.MAIN_CHANNEL_ID || "",
    );
    if (!channel)
      return console.log(
        "GuildMemberRemove.LeaveMessage:MAIN_CHANNEL_ID on seadistamata",
      );
    if (channel.type !== ChannelType.GuildText) {
      return console.log(this.name, `Ei ole tekstikanal`);
    }

    if (!member.joinedAt)
      return await channel.send(
        `**${member.displayName}** lahkus meie hulgast.`,
      );

    const duration = Date.now() - member.joinedAt.getTime();
    return await channel.send(
      `**${
        member.displayName
      }** lahkus meie hulgast. Tema elueaks jäi ${humanizeDuration(duration, {
        language: "et",
        round: true,
        conjunction: " ja ",
        largest: 2,
        serialComma: false,
      })}! Aamen! 🙏`,
    );
  }
}
