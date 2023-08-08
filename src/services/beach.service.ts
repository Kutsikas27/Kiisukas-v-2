import axios from "axios";

export type Beach = {
  name: string;
  forecast: {
    beach: [
      {
        icon: string;
        dateTime: string;
        temperature: number;
        waterTemperature: number;
        flag: string;
        uvIndex: number;
        crowd: number;
      },
    ];
  };
};

export const beachFlags: { [key: string]: string } = {
  yellow: "<:yellow:1136634248904851627>",
  red: "<:red:1136634224464646174>",
  green: "<:green:1136634168474873888>",
  purple: "<:purple:1136634234178646136>",
  Default: "<:grey:1136634185528901672>",
};

export const beachService = {
  async getBeaches() {
    return await axios
      .get<Beach[]>(
        "https://services.postimees.ee/weather/v4/groups/beach/forecast?type=beach&language=et",
      )
      .then((response) => response.data);
  },
  names: [
    "Pirita rand",
    "Stroomi rand",
    "Kakumäe rand",
    "Harku järv",
    "Pikakari rand",
    "Paralepa rand",
    "Vasikaholmi rand",
    "Pärnu rand",
    "Emajõgi",
    "Anne kanal",
    "Verevi järv",
    "Viljandi järv",
    "Viljandi Paala järv",
    "Tõrva Riiska rand",
    "Tõrva Vanamõisa rand",
    "Kuressaare rand",
    "Paide tehisjärv",
    "Põlva paisjärv",
    "Pühajärv",
  ],
};
