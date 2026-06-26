import { initService, startWorkers, shutdownService } from "./service.js";
import { startBot } from "./bot/index.js";

async function main() {
  await initService();
  startWorkers();

  console.log("Starting Napcat bot...");
  startBot().catch((err) => {
    console.error("Bot failed:", err);
  });
}

process.on("SIGTERM", async () => {
  await shutdownService();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await shutdownService();
  process.exit(0);
});

main().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});
