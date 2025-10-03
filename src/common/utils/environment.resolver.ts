export const getServiceEnvironment = (): string => {
  const serEnv: string = process.env.ENVIRONMENT || "undefined";
  return serEnv.charAt(0).toUpperCase() + serEnv.slice(1);
};
