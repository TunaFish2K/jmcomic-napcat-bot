import { mkdtemp, writeFile, readFile, unlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function encryptPDF(
  buffer: Buffer,
  password: string,
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "qpdf-"));
  const inputPath = join(dir, "input.pdf");
  const outputPath = join(dir, "output.pdf");

  try {
    await writeFile(inputPath, buffer);

    await execFileAsync("qpdf", [
      "--encrypt",
      password,
      password,
      "256",
      "--",
      inputPath,
      outputPath,
    ]);

    return await readFile(outputPath);
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
    await rm(dir, { recursive: true }).catch(() => {});
  }
}
