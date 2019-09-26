#!/usr/bin/env node

import commander from "commander";
import exitHook from "exit-hook";
import fs from "fs";
import yaml from "js-yaml";

import main from "..";

async function start(): Promise<void> {
  const program = new commander.Command();

  program.option("--config <path>", "hooks path", String, "config.yml");
  program.option("--level <level>", "logging level", Number, 3);
  program.option("--test", "include test alerts", Boolean, false);

  program.parse(process.argv);

  const config = yaml.safeLoad(fs.readFileSync(program.config, "utf8"));
  const close = await main({
    files: [],
    includeTestAlerts: program.test,
    logger: {
      level: program.level,
    },
    ...config,
  });

  exitHook(close);
}

if (require.main === module) {
  start();
}
