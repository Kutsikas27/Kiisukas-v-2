import axios from "axios";
export const getWeatherEmoji = (icon: string) =>
  ({
    clear: "☀️",
    "partly-cloudy": "⛅️",
    cloudy: "☁️",
    snow: "🌨",
    rain: "🌧",
    thunder: "⛈",
    lightning: "🌩",
    fog: ":fog:",
    hail: "🌨",
    sleet: "🌧",
    thunderstorm: "⛈️",
    wind: "🌬️",
  })[icon] || "❓";

export type Forecast = {
  forecast: {
    daily: {
      temperatureHigh: number;
      temperatureLow: number;
      icon: string;
      dateTime: string;
    }[];
    currently: {
      summary: string;
      temperature: number;
      apparentTemperature: number;
      windSpeed: number;
      icon: string;
    }[];
  };
};
export type Location = {
  id: string;
  description: string;
};

export const getForecast = async (linn: string) => {
  const locationsResponse = await axios.get<Location[]>(
    `https://services.postimees.ee/places/v1/autocomplete/${linn}?language=et`,
  );
  if (!locationsResponse.data.length) return null;
  const forecastResponse = await axios.get<Forecast>(
    `https://services.postimees.ee/weather/v4/place/${locationsResponse.data[0].id}/forecast?type=currently,hourly,daily&language=et`,
  );
  return {
    description: locationsResponse.data[0].description,
    forecast: forecastResponse.data.forecast,
  };
};
