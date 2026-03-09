import { OrderStatus } from "../../../generated/prisma/index.js";
import { ApiError } from "../../core/errors/ApiError.js";

// Mapping valid next states for each state
const validTransitions: Record<OrderStatus, OrderStatus[]> = {
  CREATED: ["PAYMENT_PENDING", "CANCELLED"],
  PAYMENT_PENDING: ["PAID", "CANCELLED"],
  PAID: ["CONFIRMED", "CANCELLED", "REFUNDED"],
  CONFIRMED: ["PACKED", "CANCELLED"],
  PACKED: ["READY_FOR_PICKUP"],
  READY_FOR_PICKUP: ["OUT_FOR_DELIVERY"],
  OUT_FOR_DELIVERY: ["DELIVERED", "CANCELLED"],
  DELIVERED: ["REFUNDED"], // Can be refunded after delivery if returned
  CANCELLED: ["REFUNDED"], // If payment was made
  REFUNDED: [], // Terminal state
};

export class OrderStateMachine {
  /**
   * Validate if a transition from current to target is allowed.
   * Throws an error if invalid.
   */
  static validateTransition(current: OrderStatus, target: OrderStatus) {
    if (!validTransitions[current].includes(target)) {
      throw new ApiError(
        400,
        `Invalid order state transition from ${current} to ${target}`
      );
    }
  }

  /**
   * Check if the target transition is allowed without throwing (boolean).
   */
  static canTransition(current: OrderStatus, target: OrderStatus): boolean {
    return validTransitions[current].includes(target);
  }
}
