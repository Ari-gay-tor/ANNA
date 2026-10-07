import { Model } from "./model";

export class Agent {
  private model: Model;

  constructor() {
    this.model = new Model();
  }

  async run(input: string): Promise<string> {
    return this.model.generate(input);
  }
}