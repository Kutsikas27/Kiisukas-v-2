import { EmbedBuilder } from "discord.js";
import { getJobOfferings, type Job } from "../services/jobOffers.service";
import { delay, trim } from "../lib/utils/utils";
import { container } from "@sapphire/framework";
import { isTextBasedChannel } from "@sapphire/discord.js-utilities";

const settings = {
  interval: 60_000,
  isInitialized: false,
};
const getChannel = () => {
  const channel = container.client.channels.cache.get(
    process.env.JOB_CHANNEL_ID || "",
  );
  if (channel && isTextBasedChannel(channel)) return channel;

  return console.log("Kanal seadistamata");
};

const jobIds: number[] = [];

export const initJobsShoutsService = () => {
  const channel = getChannel();
  if (!channel) return;
  setInterval(getJobOffers, settings.interval);
};

const getJobOffers = async () => {
  const jobs = await getJobOfferings();
  for (const job of jobs) {
    if (!jobIds.includes(job.id)) {
      jobIds.push(job.id);
      await delay(1000);
      if (settings.isInitialized) sendMessageToChannel(job);
    }
  }
  settings.isInitialized = true;
};

const sendMessageToChannel = (job: Job) => {
  const {
    salaryFrom,
    salaryTo,
    hourlySalary,
    employerName,
    positionTitle,
    logoId,
    id,
    positionContent,
  } = job;

  const wages = [];
  if (!salaryTo && salaryFrom) wages.push(`Alates ${salaryFrom}€`);
  if (salaryTo && !salaryFrom) wages.push(`Kuni ${salaryTo}€`);
  if (salaryFrom && salaryTo) wages.push(`${salaryFrom} - ${salaryTo}€`);
  if (hourlySalary) wages.push(`tunnis`);
  const salary = wages.join(" ");

  const embed = new EmbedBuilder()
    .setTitle(`${employerName} - ${positionTitle} `)
    .setURL(`https://cv.ee/et/vacancy/${id}`)
    .setColor("#ff7b00");
  if (logoId)
    embed.setThumbnail(`https://cv.ee/api/v1/files-service/${logoId}`);
  if (positionContent && positionContent !== "null")
    embed.setDescription(`${trim(positionContent, 150)}`);
  if (salary) embed.setFooter({ text: salary });
  const channel = getChannel();
  if (!channel) return;

  channel.send({ embeds: [embed] });
};
