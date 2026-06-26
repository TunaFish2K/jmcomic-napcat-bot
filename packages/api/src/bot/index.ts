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

  let botUserId: number | null = null;

  function extractTextAndCheckMention(
    context: AllHandlers["message"],
  ): string | null {
    if (context.message_type !== "group") return null;

    const segments = context.message;
    let textParts: string[] = [];
    let mentioned = false;

    for (const segment of segments) {
      if (segment.type === "at") {
        const qq = segment.data.qq;
        if (qq === String(botUserId) || qq === "all") {
          mentioned = true;
        }
      } else if (segment.type === "text") {
        const text = segment.data.text;
        if (text) textParts.push(text);
      }
    }

    if (!mentioned) return null;
    return textParts.join("").trim();
  }

  napcat.on("message", async (context) => {
    const text = extractTextAndCheckMention(context);
    if (!text) return;

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

  try {
    const loginInfo = (await napcat.get_login_info()) as {
      user_id: number;
      nickname: string;
    };
    botUserId = loginInfo.user_id;
    console.log(`Bot logged in: ${loginInfo.nickname} (${botUserId})`);
  } catch (err) {
    console.error("Failed to get login info:", err);
  }
}
