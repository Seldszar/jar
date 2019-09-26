import { SubscriptionPlan } from "./types";

export const allSubscriptionPlans: Record<string, SubscriptionPlan> = {
  Prime: {
    name: "Twitch Prime Subscription",
    amount: 4.99,
  },
  "1000": {
    name: "Tier 1 Subscription",
    amount: 4.99,
  },
  "2000": {
    name: "Tier 2 Subscription",
    amount: 9.99,
  },
  "3000": {
    name: "Tier 3 Subscription",
    amount: 24.99,
  },
};
