import camelcaseKeys from "camelcase-keys";
import consola from "consola";
import EventEmitter from "events";
import fs from "fs";
import got from "got";
import lodash from "lodash";
import io from "socket.io-client";
import stripIndent from "strip-indent";

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
      base: options.currency,
    },
  });

  const socket = io("https://sockets.streamlabs.com", {
    query: {
      token: options.token,
    },
  });

  const shouldHandleMessage = (message: any): boolean => {
    if (handledMessages.has(message._id)) {
      return false;
    }

    handledMessages.add(message._id);

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

    event.message.forEach((data: any): void => {
      if (shouldHandleMessage(data)) {
        emitter.emit("eventReceived", camelcaseKeys({ ...event, data }, { deep: true }));
      }
    });
  });

  emitter.on("eventReceived", (event: any): void => {
    logger.debug("Event received", { event });

    switch (event.type) {
      case "bits": {
        emitter.emit("bitsReceived", {
          name: event.data.name,
          amount: Number.parseInt(event.data.amount, 10),
        });

        break;
      }

      case "donation": {
        emitter.emit("donationReceived", {
          name: event.data.name,
          currency: event.data.currency,
          amount: Number.parseFloat(event.data.amount),
        });

        break;
      }

      case "subscription": {
        const plan = findSubscriptionPlan(event.data.subPlan);

        if (!plan) {
          logger.warn('Subscription plan "%s" not found', event.data.subPlan, {
            subscription: event.data,
          });

          return;
        }

        emitter.emit("subscriptionReceived", {
          months: event.data.months,
          name: event.data.name,
          plan,
        });

        break;
      }
    }
  });

  state.on("change", newValue => {
    logger.debug("State changed", {
      state: newValue,
    });

    fileWriters.forEach(write => {
      write();
    });
  });

  emitter.on("donationReceived", donation => {
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

  emitter.on("subscriptionReceived", subscription => {
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

  emitter.on("bitsReceived", bits => {
    let { amount } = bits;
    const { name } = bits;

    logger.info("Cheer: %s bit(s) from %s", amount, name, {
      bits,
    });

    amount /= 100;

    if (options.currency) {
      amount /= rates["USD"];
    }

    state.update("total", value => value + amount);
  });

  lodash.forEach(options.files, (file: any): void => {
    const compiled = lodash.template(file.content);

    const write = (): void => {
      const contents = compiled({
        state,
      });

      fs.writeFileSync(`data/files/${file.name}`, stripIndent(contents));
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
