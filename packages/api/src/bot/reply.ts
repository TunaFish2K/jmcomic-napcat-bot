import type { AllHandlers, NCWebsocket, SendMessageSegment, NodeSegment } from "node-napcat-ts";
import { Structs } from "node-napcat-ts";

export type MessageContext = AllHandlers["message"];

let globalNapcat: NCWebsocket | null = null;

export function setNapcatInstance(napcat: NCWebsocket) {
  globalNapcat = napcat;
}

// --- message builders ---

export function buildNotificationMessage(
  text: string,
  userId?: number,
): SendMessageSegment[] {
  const segments: SendMessageSegment[] = [];
  if (userId) segments.push(Structs.at(userId));
  segments.push(Structs.text(`\n${text}`));
  return segments;
}

export function buildImageNotification(
  base64DataUrl: string,
  userId?: number,
): SendMessageSegment[] {
  const base64 = base64DataUrl.replace(/^data:image\/\w+;base64,/, "");
  const segments: SendMessageSegment[] = [];
  if (userId) segments.push(Structs.at(userId));
  segments.push(Structs.image(`base64://${base64}`, "cover.jpg"));
  return segments;
}

export function buildTextAndCoverMessage(
  text: string,
  base64DataUrl: string | null,
  userId?: number,
): SendMessageSegment[] {
  const segments: SendMessageSegment[] = [];
  if (userId) segments.push(Structs.at(userId));
  segments.push(Structs.text(`\n${text}`));
  if (base64DataUrl) {
    const base64 = base64DataUrl.replace(/^data:image\/\w+;base64,/, "");
    segments.push(Structs.image(`base64://${base64}`, "cover.jpg"));
  }
  return segments;
}

export function buildFileNotification(
  file: string | Buffer,
  name: string,
  userId?: number,
): SendMessageSegment[] {
  const segments: SendMessageSegment[] = [];
  if (userId) segments.push(Structs.at(userId));
  segments.push(Structs.file(file, name));
  return segments;
}

// --- forward message builders ---

export function atOnly(userId: number): SendMessageSegment[] {
  return [Structs.at(userId)];
}

export function textContent(text: string): SendMessageSegment[] {
  return [Structs.text(text)];
}

export function imageContent(base64DataUrl: string): SendMessageSegment[] {
  const base64 = base64DataUrl.replace(/^data:image\/\w+;base64,/, "");
  return [Structs.image(`base64://${base64}`, "cover.jpg")];
}

export function fileContent(
  file: string | Buffer,
  name: string,
): SendMessageSegment[] {
  return [Structs.file(file, name)];
}

export function forwardNodes(
  items: { content: SendMessageSegment[]; userId: string; nickname: string; summary?: string }[],
): NodeSegment[] {
  return items.map((item) =>
    Structs.customNode(item.content, item.userId, item.nickname, undefined, undefined, item.summary),
  );
}

export async function sendForward(
  context: MessageContext,
  nodes: NodeSegment[],
): Promise<{ message_id: number; res_id?: string }> {
  if (!globalNapcat) throw new Error("Napcat instance not initialized");
  if (context.message_type === "private") {
    return globalNapcat.send_private_forward_msg({
      user_id: context.user_id,
      message: nodes,
    });
  }
  return globalNapcat.send_forward_msg({
    group_id: context.group_id!,
    message: nodes,
  });
}

// --- reply helper ---

export async function reply(
  context: MessageContext,
  message: SendMessageSegment[],
) {
  if (!globalNapcat) throw new Error("Napcat instance not initialized");
  if (context.message_type === "private") {
    return await globalNapcat.send_msg({
      user_id: context.user_id,
      message: message.filter((m) => m.type !== "at"),
    });
  }
  return await globalNapcat.send_msg({
    group_id: context.group_id,
    message,
  });
}
