import type { NextConfig } from "next";

const config: NextConfig = {
  // `next dev` otherwise writes an AGENTS.md into the repo; agent rules live in CLAUDE.md.
  agentRules: false,
};

export default config;
