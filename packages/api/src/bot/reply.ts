import type { AllHandlers, NCWebsocket, SendMessageSegment } from "node-napcat-ts";
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

// --- reply helper ---

export async function reply(
  context: MessageContext,
  message: SendMessageSegment[],
) {
  if (!globalNapcat) throw new Error("Napcat instance not initialized");
  if (context.message_type === "private") {
    return await globalNapcat.send_msg({
      user_id: context.user_id,
      message,
    });
  }
  return await globalNapcat.send_msg({
    group_id: context.group_id,
    message,
  });
}
