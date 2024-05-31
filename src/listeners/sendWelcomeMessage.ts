import { Listener } from "@sapphire/framework";
import type { Events, GuildMember } from "discord.js";
import { ChannelType, EmbedBuilder } from "discord.js";
import { getJoinLeaveDescription } from "../services/joinleave.service";

export class UserListener extends Listener<Events.GuildMemberAdd> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, {
      ...options,
      event: "guildMemberAdd",
    });
  }
  public async run(member: GuildMember) {
    const channel = member.guild.channels.cache.get(
      process.env.JOIN_LEAVE_CHANNEL_ID || "",
    );
    if (!channel) return console.log("JOIN_LEAVE_CHANNEL_ID on seadistamata");
    if (channel.type !== ChannelType.GuildText) {
      return console.log(this.name, `Ei ole tekstikanal`);
    }

    const embed = new EmbedBuilder()
      .setTitle(`${member.displayName} liitus 👋`)
      .setDescription(getJoinLeaveDescription(member, true))
      .setThumbnail(`${member.user.displayAvatarURL()}`)
      .setFooter({ text: `ID: ${member.id}` })
      .setColor("#18E72B");

    await channel.send({ embeds: [embed] });
  }
}
