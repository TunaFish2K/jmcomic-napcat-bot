import {
  queryInfo,
  enqueuePDF,
  queryPDFStatus,
  readPDFBuffer,
  type TaskStatusResult,
} from "../service.js";
import {
  reply,
  buildTextMessage,
  buildImageMessage,
  buildFileMessage,
  type MessageContext,
} from "./reply.js";
import { POLL_INTERVAL_MS, MAX_POLL_ATTEMPTS } from "./config.js";

const QUERY_ALIASES = new Set(["/query", "/查询", "/本子"]);
const DOWNLOAD_ALIASES = new Set(["/pdf", "/download", "/dl"]);

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

export async function handleQuery(context: MessageContext, id: string) {
  try {
    const info = await queryInfo(id);
    const lines = [
      `名称：${info.name}`,
      info.description ? `简介：${info.description}` : null,
      info.authors?.length ? `作者：${info.authors.join(", ")}` : null,
      info.tags?.length ? `标签：${info.tags.join(", ")}` : null,
      info.works?.length ? `作品：${info.works.join(", ")}` : null,
      info.actors?.length ? `演员：${info.actors.join(", ")}` : null,
      info.views ? `浏览：${info.views}` : null,
      info.likes ? `点赞：${info.likes}` : null,
    ].filter((line): line is string => line !== null);

    await reply(context, buildTextMessage(lines.join("\n")));

    if (info.cover) {
      await reply(context, buildImageMessage(info.cover));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await reply(context, buildTextMessage(`查询失败：${message}`));
  }
}

export async function handleDownload(context: MessageContext, id: string) {
  await reply(
    context,
    buildTextMessage(`开始生成 PDF（ID: ${id}），请稍候...`),
  );

  try {
    const enqueued = await enqueuePDF(id);
    if (enqueued.status === "error") {
      await reply(context, buildTextMessage(`操作失败：${enqueued.error}`));
      return;
    }

    let ready = false;
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      await sleep(POLL_INTERVAL_MS);
      const status = await queryPDFStatus(id);
      if (status.status === "ready") {
        ready = true;
        break;
      }
      if (status.status === "error") {
        await reply(
          context,
          buildTextMessage(`PDF 生成失败：${status.error}`),
        );
        return;
      }
    }

    if (!ready) {
      await reply(context, buildTextMessage("PDF 生成超时，请稍后重试"));
      return;
    }

    const buffer = await readPDFBuffer(id);
    await reply(context, buildFileMessage(buffer, `${id}.pdf`));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await reply(context, buildTextMessage(`PDF 生成失败：${message}`));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
