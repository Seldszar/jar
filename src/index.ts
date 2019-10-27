import camelcaseKeys from "camelcase-keys";
import consola from "consola";
import EventEmitter from "events";
import got from "got";
import lodash from "lodash";
import makeDir from "make-dir";
import path from "path";
import io from "socket.io-client";
import stripIndent from "strip-indent";
import writeFileAtomic from "write-file-atomic";

import { EventType } from "./constants";
import { findSubscriptionPlan } from "./helpers";
import { State } from "./state";

interface MainLoggerOptions {
  level: number;
}

interface MainFileOptions {
  name: string;
  content: string;
}

interface MainOptions {
  token: string;
  currency: string;
  includeTestAlerts: boolean;
  logger: MainLoggerOptions;
  files: MainFileOptions[];
}

export default async function main(options: MainOptions): Promise<() => void> {
  const emitter = new EventEmitter();
  const handledMessages = new Set<string>();
  const fileWriters = new Set<() => void>();

  const logger = consola.create({
    level: options.logger.level,
  });

  const state = new State("data/state.json", {
    defaultValue: {
      total: 0,
    },
  });

  const {
    body: { rates },
  } = await got.get("https://api.exchangeratesapi.io/latest", {
    json: true,
    query: {
      base: typeof options.currency === "string" ? options.currency : undefined,
    },
  });

  const socket = io("https://sockets.streamlabs.com", {
    query: {
      token: options.token,
    },
  });

  const shouldHandleMessage = (message: any): boolean => {
    if (handledMessages.has(message.id)) {
      return false;
    }

    handledMessages.add(message.id);

    if ((!options.includeTestAlerts && message.isTest) || message.repeat || message.forceRepeat) {
      return false;
    }

    return true;
  };

  socket.on("connecting", (): void => {
    logger.info("Connecting to Streamlabs...");
  });

  socket.on("connect", (): void => {
    logger.info("Connected to Streamlabs");
  });

  socket.on("disconnect", (reason: string): void => {
    logger.info("Disconnected from Streamlabs (%s)", reason);
  });

  socket.on("event", (event: any): void => {
    if (!Array.isArray(event.message)) {
      return;
    }

    event = camelcaseKeys(event, {
      deep: true,
    });

    event.message.forEach((data: any): void => {
      if (!shouldHandleMessage(data)) {
        return;
      }

      logger.debug("New event received", { event });

      switch (event.type) {
        case "bits": {
          emitter.emit(EventType.CHEER, {
            name: data.name,
            amount: Number.parseInt(data.amount, 10),
          });

          break;
        }

        case "donation": {
          emitter.emit(EventType.DONATION, {
            name: data.name,
            currency: data.currency,
            amount: Number.parseFloat(data.amount),
          });

          break;
        }

        case "resub":
        case "subscription": {
          emitter.emit(EventType.SUBSCRIPTION, {
            name: data.name,
            months: data.months,
            plan: findSubscriptionPlan(data.subPlan),
          });

          break;
        }
      }
    });
  });

  state.on("change", newValue => {
    logger.debug("State changed", {
      state: newValue,
    });

    fileWriters.forEach(write => {
      write();
    });
  });

  emitter.on(EventType.CHEER, cheer => {
    let { amount } = cheer;
    const { name } = cheer;

    logger.info("Cheer: %s bit(s) from %s", amount, name, {
      cheer,
    });

    amount /= 100;

    if (options.currency) {
      amount /= rates["USD"];
    }

    state.update("total", value => value + amount);
  });

  emitter.on(EventType.DONATION, donation => {
    const { currency, name } = donation;
    let { amount } = donation;

    logger.info("Donation: %s %f from %s", currency, amount, name, {
      donation,
    });

    if (options.currency) {
      amount /= rates[donation.currency];
    }

    state.update("total", value => value + amount);
  });

  emitter.on(EventType.SUBSCRIPTION, subscription => {
    const { months, name, plan } = subscription;
    let { amount } = plan;

    logger.info("Subscription: %s for %d month(s) (%s)", name, months, plan.name, {
      subscription,
    });

    if (options.currency) {
      amount /= rates["USD"];
    }

    state.update("total", value => value + amount);
  });

  lodash.forEach(options.files, (file: any): void => {
    const compiled = lodash.template(file.content);

    const write = (): void => {
      const filePath = `data/files/${file.name}`;
      const contents = compiled({
        state,
      });

      makeDir.sync(path.dirname(filePath));
      writeFileAtomic.sync(filePath, stripIndent(contents));
    };

    fileWriters.add(write);
  });

  fileWriters.forEach(write => {
    write();
  });

  return (): void => {
    logger.info("Closing application...");
    socket.close();
  };
}
