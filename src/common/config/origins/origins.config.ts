export const getAllowedOrigins = (): string[] => {
  let origins: string = process.env.CORS_ALLOWED_ORIGINS || "localhost";
  origins = origins
    .split("\n")
    .join("")
    .split("\r")
    .join("")
    .split(" ")
    .join("");
  return origins.split(",");
};
