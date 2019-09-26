import { allSubscriptionPlans } from "./constants";
import { SubscriptionPlan } from "./types";

export function findSubscriptionPlan(name: string): SubscriptionPlan {
  return allSubscriptionPlans[name];
}
