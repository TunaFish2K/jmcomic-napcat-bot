import type { AllHandlers, NCWebsocket, SendMessageSegment } from "node-napcat-ts";
import { Structs } from "node-napcat-ts";

export type MessageContext = AllHandlers["message"];

export function buildTextMessage(text: string): SendMessageSegment[] {
  return [Structs.text(text)];
}

export function buildImageMessage(base64DataUrl: string, name = "cover.jpg"): SendMessageSegment[] {
  const base64 = base64DataUrl.replace(/^data:image\/\w+;base64,/, "");
  return [Structs.image(`base64://${base64}`, name)];
}

export function buildFileMessage(file: string | Buffer, name = "album.pdf"): SendMessageSegment[] {
  return [Structs.file(file, name)];
}

let globalNapcat: NCWebsocket | null = null;

export async function reply(context: MessageContext, message: SendMessageSegment[]) {
  if (!globalNapcat) {
    throw new Error("Napcat instance not initialized");
  }
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

export function setNapcatInstance(napcat: NCWebsocket) {
  globalNapcat = napcat;
}
