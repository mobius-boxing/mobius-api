const pjson = require("../../../package.json");

export const getServiceVersion = (): string => {
  return pjson["version"];
};
