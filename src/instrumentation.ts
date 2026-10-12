// Runs once when the server starts: refuse to start with missing or unsafe settings.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkStartupEnv } = await import("@/server/env");
    checkStartupEnv();
  }
}
