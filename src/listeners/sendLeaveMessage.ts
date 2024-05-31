import { Listener } from "@sapphire/framework";
import type { Events, GuildMember } from "discord.js";
import { getJoinLeaveDescription } from "../services/joinleave.service";
import { ChannelType, EmbedBuilder } from "discord.js";

export class UserListener extends Listener<Events.GuildMemberRemove> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, {
      ...options,
      event: "guildMemberRemove",
    });
  }

  public async run(member: GuildMember) {
    const channel = member.guild.channels.cache.get(
      process.env.JOIN_LEAVE_CHANNEL_ID || "",
    );
    if (!channel)
      return console.log(
        "GuildMemberRemove.LeaveMessage:JOIN_LEAVE_CHANNEL_ID on seadistamata",
      );
    if (channel.type !== ChannelType.GuildText) {
      return console.log(this.name, `Ei ole tekstikanal`);
    }

    const embed = new EmbedBuilder()
      .setTitle(`${member.displayName} lahkus`)
      .setDescription(getJoinLeaveDescription(member, false))
      .setThumbnail(`${member.user.displayAvatarURL()}`)
      .setFooter({ text: `ID: ${member.id}` })
      .setColor("#E10000");

    await channel.send({ embeds: [embed] });
  }
}
