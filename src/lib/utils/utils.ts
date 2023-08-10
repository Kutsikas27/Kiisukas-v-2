export const noop = () => undefined;
export const trim = (str: string, max: number) =>
  str.length > max ? `${str.slice(0, max - 3)}...` : str;
export const delay = (milliseconds: number) => {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
};
