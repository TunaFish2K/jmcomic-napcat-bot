import { execSync } from "node:child_process";

export function encryptPDF(
  buffer: Buffer,
  password: string,
): Buffer {
  return execSync(
    `qpdf --encrypt ${password} ${password} 256 -- /dev/stdin /dev/stdout`,
    {
      input: buffer,
      maxBuffer: 500 * 1024 * 1024,
    },
  );
}
