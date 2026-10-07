import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";

export class Speech {
  private process: ChildProcessWithoutNullStreams;

  constructor() {
    const ttsFolder = path.resolve(__dirname, "..", "ANNA-tts");
    const python = path.join(ttsFolder, ".venv", "Scripts", "python.exe");
    const worker = path.join(ttsFolder, "speak.py");

    this.process = spawn(python, ["-u", worker], {
      cwd: ttsFolder,
      stdio: "pipe",
    });

    this.process.stderr.on("data", (data: Buffer) => {
      console.error("ANNA speech error:", data.toString().trim());
    });
    this.process.on("error", (error) => {
      console.error("ANNA speech process error:", error.message);
    });
  }

  speak(text: string): void {
    if (!this.process.stdin.destroyed) {
      this.process.stdin.write(`${text.replace(/[\r\n]+/g, " ")}\n`);
    }
  }

  close(): void {
    this.process.stdin.end();
  }
}