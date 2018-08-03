const fs = require("fs-plus");
const hjson = require("hjson");
const parse = require("yargs-parser");
const bootstrap = require("../lib");

const argv = parse(process.argv.slice(2));

const configFilePath = fs.resolve(process.cwd(), "config.hjson");
const config = hjson.parse(fs.readFileSync(configFilePath, "utf8"));

const exchangeFilePath = fs.resolve(process.cwd(), "exchange.hjson");
const exchange = hjson.parse(fs.readFileSync(exchangeFilePath, "utf8"));

const app = bootstrap({ config, exchange });

process.on("SIGINT", () => {
  app.close();
});
