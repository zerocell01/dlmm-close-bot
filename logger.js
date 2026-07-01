export function log(tag, message) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${tag}] ${message}`);
}
