// Subscription orchestration — MANUAL approval model.
//   • Client requests a plan  → a `pending` transaction is created.
//   • Operator approves        → plan activates, transaction marked `approved`.
//   • Operator rejects         → transaction marked `rejected`, plan unchanged.
// Free plans activate instantly (no approval needed).
import { db, insert, newId, now, update } from "../store/db.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

const planBySlug = (slug) => db.plans.find((p) => p.slug === slug);
const planById = (id) => db.plans.find((p) => p.id === id);
const addDays = (d) => new Date(Date.now() + d * 86400000).toISOString();

function activatePlan(tenant, plan) {
  update("tenants", tenant.id, {
    planId: plan.id,
    status: "active",
    subscriptionStatus: "active",
    periodStart: now(),
    periodEnd: addDays(30),
  });
}

export const pendingRequestFor = (tenantId) =>
  db.transactions.find((t) => t.tenantId === tenantId && t.status === "pending");

/** Client requests a plan change. */
export function requestPlan(tenant, planSlug) {
  const plan = planBySlug(planSlug);
  if (!plan) {
    const e = new Error("Plan not found");
    e.status = 404;
    throw e;
  }
  if (plan.id === tenant.planId) {
    const e = new Error("You are already on this plan.");
    e.status = 400;
    throw e;
  }
  if (pendingRequestFor(tenant.id)) {
    const e = new Error("You already have a pending request awaiting approval.");
    e.status = 409;
    throw e;
  }

  // Free plan: activate immediately, no approval.
  if (plan.priceCents === 0) {
    activatePlan(tenant, plan);
    const txn = insert("transactions", {
      id: newId("txn"), tenantId: tenant.id, planId: plan.id, planName: plan.name,
      amountCents: 0, currency: config.razorpay.currency, status: "approved", provider: "manual",
      razorpayOrderId: null, razorpayPaymentId: null,
      description: `Switched to ${plan.name}`, createdAt: now(),
    });
    return { pending: false, activated: true, transaction: txn };
  }

  const txn = insert("transactions", {
    id: newId("txn"), tenantId: tenant.id, planId: plan.id, planName: plan.name,
    amountCents: plan.priceCents, currency: config.razorpay.currency,
    status: "pending", provider: "manual", razorpayOrderId: null, razorpayPaymentId: null,
    description: `Requested ${plan.name} plan`, createdAt: now(),
  });
  update("tenants", tenant.id, { subscriptionStatus: "pending" });
  logger.info(`[billing] ${tenant.company} requested ${plan.name} (txn ${txn.id})`);
  return { pending: true, activated: false, transaction: txn };
}

/** Operator approves a pending request → activates the plan. */
export function approveRequest(txnId) {
  const txn = db.transactions.find((t) => t.id === txnId);
  if (!txn) {
    const e = new Error("Request not found");
    e.status = 404;
    throw e;
  }
  if (txn.status !== "pending") {
    const e = new Error("Request is not pending");
    e.status = 400;
    throw e;
  }
  const tenant = db.tenants.find((t) => t.id === txn.tenantId);
  const plan = planById(txn.planId);
  if (!tenant || !plan) {
    const e = new Error("Tenant or plan missing");
    e.status = 404;
    throw e;
  }
  update("transactions", txn.id, { status: "approved" });
  activatePlan(tenant, plan);
  logger.info(`[billing] approved ${tenant.company} → ${plan.name}`);
  return { transaction: txn, tenant };
}

/** Operator rejects a pending request → plan unchanged. */
export function rejectRequest(txnId) {
  const txn = db.transactions.find((t) => t.id === txnId);
  if (!txn) {
    const e = new Error("Request not found");
    e.status = 404;
    throw e;
  }
  if (txn.status !== "pending") {
    const e = new Error("Request is not pending");
    e.status = 400;
    throw e;
  }
  update("transactions", txn.id, { status: "rejected" });
  const tenant = db.tenants.find((t) => t.id === txn.tenantId);
  if (tenant && tenant.subscriptionStatus === "pending") {
    update("tenants", tenant.id, { subscriptionStatus: "active" });
  }
  return { transaction: txn };
}
