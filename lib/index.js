const camelcaseKeys = require("camelcase-keys");
const { stripIndent } = require("common-tags");
const EventEmitter = require("events");
const fs = require("fs");
const lodash = require("lodash");
const low = require("lowdb");
const FileSync = require("lowdb/adapters/FileSync");
const fx = require("money");
const signale = require("signale");
const io = require("socket.io-client");

const subscriptionPlans = {
  Prime: {
    label: "Twitch Prime Subscription",
    amount: 4.99,
  },
  1000: {
    label: "$4.99 Subscription",
    amount: 4.99,
  },
  2000: {
    label: "$9.99 Subscription",
    amount: 9.99,
  },
  3000: {
    label: "$24.99 Subscription",
    amount: 24.99,
  },
};

function createApplication({ config, exchange }) {
  const emitter = new EventEmitter();
  const handledMessages = new Set();

  const state = low(
    new FileSync("state.json", {
      defaultValue: {
        total: 0,
      },
    }),
  );

  const socket = io("https://sockets.streamlabs.com", {
    autoConnect: false,
    query: {
      token: config.token,
    },
  });

  fx.base = exchange.base;
  fx.rates = exchange.rates;

  /**
   * Indicate if the given message should be handled.
   * @param {Object} message The message object
   * @return {boolean} True if the message can be handled; otherwise false
   */
  function shouldHandleMessage(message) {
    if (!config.includeTestAlerts) {
      if (message.isTest) {
        return false;
      }
    }

    if (!config.includeRepeatAlerts) {
      if (message.repeat || message.forceRepeat) {
        return false;
      }
    }

    if (handledMessages.has(message.id)) {
      return false;
    }

    handledMessages.add(message.id);

    return true;
  }

  socket.on("connecting", () => {
    signale.info("Connecting to Streamlabs socket server...");
  });

  socket.on("connect", () => {
    signale.info("Connected to Streamlabs socket server");
  });

  socket.on("disconnect", reason => {
    signale.info("Disconnected from Streamlabs socket server", {
      reason,
    });
  });

  socket.on("event", event => {
    emitter.emit("eventReceived", camelcaseKeys(event));
  });

  emitter.on("eventReceived", event => {
    signale.debug("Event received", { event });

    if (event.type === "donation") {
      event.message.forEach(donation => {
        if (shouldHandleMessage(donation)) {
          emitter.emit(
            "donationReceived",
            lodash.assign(donation, {
              amount: Number.parseFloat(donation.amount),
            }),
          );
        }
      });
    }

    if (event.for === "twitch_account" && event.type === "subscription") {
      event.message.forEach(subscription => {
        if (shouldHandleMessage(subscription)) {
          const plan = subscriptionPlans[subscription.subPlan];

          if (!plan) {
            signale.warn('Subscription plan "%s" not found', subscription.subPlan, {
              subscription,
            });
            return;
          }

          emitter.emit(
            "subscriptionReceived",
            lodash.assign(subscription, {
              label: plan.label,
              amount: plan.amount,
              currency: "USD",
            }),
          );
        }
      });
    }

    if (event.for === "twitch_account" && event.type === "bits") {
      event.message.forEach(bits => {
        if (shouldHandleMessage(bits)) {
          emitter.emit(
            "bitsReceived",
            lodash.assign(bits, {
              amount: Number.parseInt(bits.amount, 10),
            }),
          );
        }
      });
    }
  });

  emitter.on("stateChanged", () => {
    signale.debug("State changed", {
      state: state.getState(),
    });
  });

  emitter.on("donationReceived", donation => {
    let { amount } = donation;
    const { currency, name } = donation;

    signale.info("Donation: %s %f from %s", currency, amount, name, {
      donation,
    });

    if (config.currency) {
      amount = fx(amount).convert({
        from: donation.currency,
        to: config.currency,
      });
    }

    state.update("total", total => total + amount).write();
  });

  emitter.on("subscriptionReceived", subscription => {
    let { amount } = subscription;
    const { name, months, label } = subscription;

    signale.info("Subscription: %s for %d month(s) (%s)", name, months, label, {
      subscription,
    });

    if (config.currency) {
      amount = fx(amount).convert({
        from: subscription.currency,
        to: config.currency,
      });
    }

    state.update("total", total => total + amount).write();
  });

  emitter.on("bitsReceived", bits => {
    let { amount } = bits;
    const { name } = bits;

    signale.info("Cheer: %s bit(s) from %s", amount, name, {
      bits,
    });

    // Convert the bit amount into real money
    amount /= 100;

    if (config.currency) {
      amount = fx(amount).convert({
        from: bits.currency,
        to: config.currency,
      });
    }

    state.update("total", total => total + amount).write();
  });

  lodash.forEach(config.templates, ({ file, template }) => {
    const compiled = lodash.template(template);

    const write = () => {
      const contents = compiled({
        state: state.getState(),
      });

      fs.writeFileSync(file, stripIndent(contents));
    };

    emitter.on("stateChanged", () => write());
    write();
  });

  const watcher = fs.watch(
    "state.json",
    lodash.debounce(() => {
      state.read();
      emitter.emit("stateChanged");
    }, 5000),
  );

  socket.connect();

  return {
    close() {
      signale.info("Closing application...");

      watcher.close();
      socket.close();
    },
  };
}

module.exports = createApplication;
