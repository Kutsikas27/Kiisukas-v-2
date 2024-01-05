import axios from "axios";
import { escapeMarkdown } from "discord.js";
import { JSDOM } from "jsdom";
export type Book = {
  imageUrl: string;
  title: string;
  bookUrl: string;
  numPages: number;
  avgRating: string;
  ratingsCount: number;
  author: Author;
  description: Description;
};
export type Author = {
  name: string;
};
export type Description = {
  html: string;
};

export const getBooksApi = async (title: string) => {
  return await axios
    .get<Book[]>(
      `https://www.goodreads.com/book/auto_complete?format=json&q=${title}`,
    )
  
};
export const getBookInfo = async (bookUrl: string) => {
  const response = await axios.get(`https://www.goodreads.com/${bookUrl}`, {
    responseType: "stream",
  });
  let html = "";
  for await (const chunk of response.data) {
    const currentChunk = chunk.toString();
    html += currentChunk;
    const { document } = new JSDOM(html).window;
    const featuredPerson = document.querySelector(".FeaturedPerson__meta");
    if (featuredPerson) {
      response.data.destroy();
      break;
    }
  }

  const { document } = new JSDOM(html.replaceAll("<br />", "\n")).window;
  const image = document.querySelector<HTMLImageElement>(
    ".BookPage__bookCover img",
  )?.src;
  const genresList = [
    ...document.querySelectorAll(
      ".BookPageMetadataSection__genres .BookPageMetadataSection__genreButton",
    ),
  ].map((e) => e.textContent);
  const textContent = document.querySelector(
    ".TruncatedContent__text.TruncatedContent__text--large",
  )?.textContent;
  if (!textContent) {
    return;
  }
  const description = escapeMarkdown(textContent, {
    bulletedList: true,
    numberedList: true,
  }).replaceAll("\n\n\n", "\n\n");
  const genres = genresList.slice(0, 3).join(", ");
  return {
    image,
    description,
    genres,
  };
};
