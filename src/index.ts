import "dotenv/config";
import readline from "node:readline";
import { Agent } from "./agent";
import { Speech } from "./speech";

async function main() {
  const agent = new Agent();
  const speech = new Speech();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("ANNA online.\n");

  const ask = () => {
    rl.question("You: ", async (input) => {
      if (input.toLowerCase() === "exit") {
        speech.close();
        rl.close();
        return;
      }

      try {
        const response = await agent.run(input);
        console.log(`ANNA: ${response}\n`);
        speech.speak(response);
      } catch (error) {
        console.error("ANNA error:", error);
      }

      ask();
    });
  };

  ask();
}

main();