import {
  queryInfo,
  enqueuePDF,
  queryPDFStatus,
  readPDFBuffer,
  isInfoCached,
  extractErrorMessage,
  type InfoResponse,
} from "../service.js";
import {
  reply,
  buildNotificationMessage,
  buildFileNotification,
  atOnly,
  forwardNodes,
  sendForward,
  textContent,
  imageContent,
  type MessageContext,
} from "./reply.js";
import { POLL_INTERVAL_MS, MAX_POLL_ATTEMPTS } from "./config.js";
import { runQueryMiddlewares, runDownloadMiddlewares } from "./middleware.js";

const QUERY_ALIASES = new Set(["/query", "/查询", "/本子"]);
const DOWNLOAD_ALIASES = new Set(["/pdf", "/download", "/dl", "/下载"]);

let botUserId = "0";
let botNickname = "JMComic Bot";

export function setBotInfo(userId: number, nickname: string) {
  botUserId = String(userId);
  botNickname = nickname;
}

export interface ParsedCommand {
  type: "query" | "download";
  id: string;
}

export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return null;

  const command = parts[0];
  const id = parts[1];
  if (!command || !id) return null;

  if (QUERY_ALIASES.has(command)) {
    return { type: "query", id };
  }
  if (DOWNLOAD_ALIASES.has(command)) {
    return { type: "download", id };
  }
  return null;
}

export function isHelpCommand(text: string): boolean {
  const cmd = text.trim().split(/\s+/)[0];
  return cmd === "/help" || cmd === "/帮助" || cmd === "/?";
}

export function buildHelpMessage(): string {
  const lines = [
    "指令　　　功能　　　　别名",
    "────────────────────────────",
    "/query  查询本子信息  /查询, /本子",
    "/pdf    下载本子PDF   /download, /dl",
    "/help   帮助信息     /帮助, /?",
  ];
  return lines.join("\n");
}

function buildInfoText(info: InfoResponse): string {
  const lines = [
    `名称：${info.name}`,
    info.description ? `简介：${info.description}` : null,
    info.authors?.length ? `作者：${info.authors.join(", ")}` : null,
    info.tags?.length ? `标签：${info.tags.join(", ")}` : null,
    info.works?.length ? `作品：${info.works.join(", ")}` : null,
    info.actors?.length ? `演员：${info.actors.join(", ")}` : null,
    info.views ? `浏览：${info.views}` : null,
    info.likes ? `点赞：${info.likes}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n\n");
  return lines;
}

export async function handleQuery(context: MessageContext, id: string) {
  const block = await runQueryMiddlewares({ id, userId: context.user_id });
  if (block) {
    await reply(context, block);
    return;
  }

  const isCached = isInfoCached(id);

  if (!isCached) {
    await reply(
      context,
      buildNotificationMessage("查询中，请稍候...", context.user_id),
    );
  }

  try {
    const info = await queryInfo(id);
    const text = buildInfoText(info);

    const ok = await trySendForwardSafe(context, text, info.cover);
    if (ok) {
      if (context.message_type !== "private") {
        await reply(context, atOnly(context.user_id));
      }
    } else {
      await reply(context, buildNotificationMessage(text, context.user_id));
    }
  } catch (err) {
    const message = extractErrorMessage(err);
    await reply(
      context,
      buildNotificationMessage(`查询失败：${message}`, context.user_id),
    );
  }
}

async function trySendForwardSafe(
  context: MessageContext,
  text: string,
  cover: string | null,
): Promise<boolean> {
  const textNode = { content: textContent(text), userId: botUserId, nickname: botNickname };

  try {
    const nodes = cover
      ? [textNode, { content: imageContent(cover), userId: botUserId, nickname: botNickname }]
      : [textNode];
    await sendForward(context, forwardNodes(nodes));
    return true;
  } catch (err) {
    console.warn("sendForward (with cover) failed, trying text-only:", extractErrorMessage(err));
  }

  try {
    await sendForward(context, forwardNodes([textNode]));
    return true;
  } catch (err) {
    console.warn("sendForward (text-only) failed, falling back to plain message:", extractErrorMessage(err));
    return false;
  }
}

export async function handleDownload(context: MessageContext, id: string) {
  const block = await runDownloadMiddlewares({ id, userId: context.user_id });
  if (block) {
    await reply(context, block);
    return;
  }

  await reply(
    context,
    buildNotificationMessage("下载中", context.user_id),
  );

  try {
    const enqueued = await enqueuePDF(id);
    if (enqueued.status === "error") {
      await reply(
        context,
        buildNotificationMessage(`操作失败：${enqueued.error}`, context.user_id),
      );
      return;
    }

    let sentEstimate = false;
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      await sleep(POLL_INTERVAL_MS);
      const status = await queryPDFStatus(id);
      if (status.status === "ready") {
        const buffer = await readPDFBuffer(id);
        await reply(
          context,
          buildFileNotification(buffer, `${id}.pdf`, context.user_id),
        );
        return;
      }
      if (status.status === "error") {
        await reply(
          context,
          buildNotificationMessage(`PDF 生成失败：${status.error}`, context.user_id),
        );
        return;
      }
      if (status.status === "processing" && status.progress?.etaSeconds && !sentEstimate) {
        await reply(
          context,
          buildNotificationMessage(`预计还需要 ${status.progress.etaSeconds} 秒`, context.user_id),
        );
        sentEstimate = true;
      }
    }

    await reply(
      context,
      buildNotificationMessage("PDF 生成超时，请稍后重试", context.user_id),
    );
  } catch (err) {
    const message = extractErrorMessage(err);
    await reply(
      context,
      buildNotificationMessage(`PDF 生成失败：${message}`, context.user_id),
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
