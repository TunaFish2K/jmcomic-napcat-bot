import { NCWebsocket } from "node-napcat-ts";
import type { AllHandlers } from "node-napcat-ts";
import {
  NAPCAT_WS_URL,
  NAPCAT_ACCESS_TOKEN,
} from "./config.js";
import {
  parseCommand,
  isHelpCommand,
  buildHelpMessage,
  handleQuery,
  handleDownload,
} from "./commands.js";
import { setNapcatInstance, reply, buildNotificationMessage } from "./reply.js";
import { RateLimiter } from "./rate-limiter.js";

export async function startBot(): Promise<void> {
  const napcat = new NCWebsocket(
    {
      baseUrl: NAPCAT_WS_URL,
      accessToken: NAPCAT_ACCESS_TOKEN,
      reconnection: {
        enable: true,
        attempts: 10,
        delay: 5000,
      },
    },
    false,
  );

  setNapcatInstance(napcat);

  const rateLimiter = new RateLimiter();

  function extractCommandText(
    context: AllHandlers["message"],
  ): string | null {
    if (context.message_type !== "group") return null;

    const textParts: string[] = [];
    for (const segment of context.message) {
      if (segment.type === "text") {
        const text = segment.data.text;
        if (text) textParts.push(text);
      }
    }
    const raw = textParts.join("").trim();
    if (!raw.startsWith("/")) return null;
    return raw;
  }

  napcat.on("message", async (context) => {
    const text = extractCommandText(context);
    if (!text) return;

    if (!rateLimiter.try(context.user_id)) {
      await reply(
        context,
        buildNotificationMessage("操作过于频繁，请稍后再试", context.user_id),
      );
      return;
    }

    if (isHelpCommand(text)) {
      await reply(context, buildNotificationMessage(
        `\n${buildHelpMessage()}`,
        context.user_id,
      ));
      return;
    }

    const command = parseCommand(text);
    if (!command) {
      await reply(context, buildNotificationMessage(
        `\n${buildHelpMessage()}`,
        context.user_id,
      ));
      return;
    }

    if (command.type === "query") {
      await handleQuery(context, command.id);
    } else {
      await handleDownload(context, command.id);
    }
  });

  await napcat.connect();
  console.log("Connected to Napcat");
}
