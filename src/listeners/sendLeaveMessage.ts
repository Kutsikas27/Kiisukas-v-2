import { Listener } from "@sapphire/framework";
import type { Events, GuildMember } from "discord.js";
import humanizeDuration from "humanize-duration";
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

    const descriptionRows = [];
    descriptionRows.push(`Nimi: ${member.user.username}`);
    descriptionRows.push(`ID: ${member.id}`);
    if (member.joinedAt)
      descriptionRows.push(
        ` Viibis serveris: ${humanizeDuration(
          Date.now() - member.joinedAt.getTime(),
          {
            language: "et",
            round: true,
            conjunction: " ja ",
            largest: 2,
            serialComma: false,
          },
        )}`,
      );

    const embed = new EmbedBuilder()
      .setTitle(`${member.displayName} lahkus serverist `)
      .setDescription(descriptionRows.join("\n"))
      .setThumbnail(`${member.user.displayAvatarURL()}`)
      .setColor("#E10000");

    await channel.send({ embeds: [embed] });
  }
}
