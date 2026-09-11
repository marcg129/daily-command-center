export function isLocalTaskCaptureEnabled(nodeEnv = process.env.NODE_ENV) {
  return nodeEnv !== "production";
}
