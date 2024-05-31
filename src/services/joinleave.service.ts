import { GuildMember } from "discord.js";
import humanizeDuration from "humanize-duration";

const humanizeJoinLeaveDuration = (milliseconds: number) =>
  humanizeDuration(milliseconds, {
    language: "et",
    round: true,
    conjunction: " ja ",
    largest: 2,
    serialComma: false,
  });

export const getJoinLeaveDescription = (
  member: GuildMember,
  isJoinEvent: boolean,
) => {
  const descriptionRows: string[] = [];
  descriptionRows.push(`Nimi: ${member.user.username}`);


  if (!member.joinedAt) return descriptionRows.join("\n");
  const now = Date.now();

  const accountAge = now - member.user.createdTimestamp;
  const serverTime = now - member.joinedAt.getTime();

  descriptionRows.push(
    isJoinEvent
      ? `Konto vanus: ${humanizeJoinLeaveDuration(accountAge)}`
      : `Viibis serveris: ${humanizeJoinLeaveDuration(serverTime)}`,
  );

  return descriptionRows.join("\n");
};
