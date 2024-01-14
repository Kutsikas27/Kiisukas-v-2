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
  bookId: string;
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
  return await axios.get<Book[]>(
    `https://www.goodreads.com/book/auto_complete?format=json&q=${title}`,
  );
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
  const textContent =
    document.querySelector(
      ".TruncatedContent__text.TruncatedContent__text--large",
    )?.textContent || "";

  const description = escapeMarkdown(textContent, {
    bulletedList: true,
    numberedList: true,
  }).replaceAll("\n\n\n", "\n\n");
  const genres = genresList.slice(0, 3).join(", ");

  const title = document.querySelector(".BookPageTitleSection__title h1")
    ?.textContent!;

  const pagesAndYearPublished = [
    ...document.querySelectorAll(".FeaturedDetails p"),
  ]
    .map((e) => e.textContent)
    .join("\n");

  const author = document
    .querySelector(".ContributorLinksList")
    ?.textContent!.replace("...more", "and others");

  const reviewsCount = document
    .querySelector(".RatingStatistics__meta ")
    ?.getAttribute("aria-label");
  const rating = document.querySelector(
    ".RatingStatistics .RatingStatistics__rating",
  )?.textContent!;

  return {
    rating,
    reviewsCount,
    author,
    pagesAndYearPublished,
    title,
    image,
    description,
    genres,
  };
};
