import axios from 'axios';

export type Beach = {
  name: string;
  forecast: {
    beach: [{ icon: string; dateTime: string; temperature: number; waterTemperature: number; flag: string; uvIndex: number; crowd: number }];
  };
};

export const beachFlags: { [key: string]: string } = {
  yellow: '<:yellow:1101471020860313640>',
  red: '<:red:1101471038132465724>',
  green: '<:green:1101471005312024667>',
  purple: '<:purple:1105437530368778300>',
  Default: '<:grey:1105458610126987355>'
};

export const beachService = {
  async getBeaches() {
    return await axios
      .get<Beach[]>('https://services.postimees.ee/weather/v4/groups/beach/forecast?type=beach&language=et')
      .then((response) => response.data);
  },
  names: [
    'Pirita rand',
    'Stroomi rand',
    'Kakumäe rand',
    'Harku järv',
    'Pikakari rand',
    'Paralepa rand',
    'Vasikaholmi rand',
    'Pärnu rand',
    'Emajõgi',
    'Anne kanal',
    'Verevi järv',
    'Viljandi järv',
    'Viljandi Paala järv',
    'Tõrva Riiska rand',
    'Tõrva Vanamõisa rand',
    'Kuressaare rand',
    'Paide tehisjärv',
    'Põlva paisjärv',
    'Pühajärv'
  ]
};
