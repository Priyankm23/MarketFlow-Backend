import nodemailer from "nodemailer";
import { env } from "../../config/env.js";
import { logger } from "./logger.js";

const emailLogger = logger.child({ component: "email-service" });

interface WelcomeEmailPayload {
  name: string;
  email: string;
}

interface OrderInvoiceItem {
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface OrderPlacedInvoiceEmailPayload {
  orderId: string;
  customerName: string;
  customerEmail: string;
  vendorName: string;
  orderDate: string;
  paymentReference: string;
  totalAmount: number;
  shippingAddress: string;
  items: OrderInvoiceItem[];
}

export interface OrderDeliveredEmailPayload {
  orderId: string;
  customerName: string;
  customerEmail: string;
  vendorName: string;
  deliveredAt: string;
  helpUrl?: string;
  feedbackUrl?: string;
}

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: Number(env.SMTP_PORT ?? 587),
  secure: false,
  // Nodemailer supports `family` at runtime, but the installed type defs omit it.
  family: 4,
  requireTLS: true,
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
} as Parameters<typeof nodemailer.createTransport>[0]);

const formatCurrency = (amount: number) => `Rs. ${amount.toFixed(2)}`;

const logoBlock = () => {
  if (env.MARKIVO_LOGO_URL) {
    return `
      <div style="display:inline-block;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:6px 12px;">
        <img src="${env.MARKIVO_LOGO_URL}" alt="Markivo" style="height:40px;max-width:180px;object-fit:contain;display:block;" />
      </div>
    `;
  }

  return `<div style="display:inline-block;background:#ffffff;color:#e10600;border:2px solid #111111;border-radius:8px;padding:8px 14px;font-size:28px;font-weight:800;line-height:1;letter-spacing:0.5px;">Markivo</div>`;
};

async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}) {
  await transporter.sendMail({
    from: `Markivo <${env.SMTP_USER}>`,
    to: params.to || "2023002327.gcet@cvmu.edu.in",
    subject: params.subject,
    html: params.html,
  });
}

export async function sendWelcomeEmail({ name, email }: WelcomeEmailPayload) {
  await sendEmail({
    to: email,
    subject: "Welcome to Markivo",
    html: `
      <div style="background:#f3f4f6;padding:32px 16px;font-family:Arial,sans-serif;color:#111827;">
        <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,0.08);">
          <div style="padding:22px 24px 0 24px;">
            ${logoBlock()}
          </div>

          <div style="padding:18px 24px 8px 24px;">
            <p style="margin:0 0 10px 0;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Welcome to Markivo</p>
            <h1 style="margin:0 0 12px 0;font-size:28px;line-height:1.2;color:#111827;">Hi ${name}, your account is ready.</h1>
            <p style="margin:0 0 18px 0;color:#374151;font-size:16px;line-height:1.6;">
              You now have access to trusted local sellers and verified products. Start exploring top-rated listings and place your first order in minutes.
            </p>
          </div>

          <div style="padding:0 24px 22px 24px;">
            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:16px;">
              <p style="margin:0 0 8px 0;font-weight:600;color:#111827;">Need help getting started?</p>
              <p style="margin:0;color:#4b5563;font-size:14px;line-height:1.6;">Reply to this email and our support team will assist you.</p>
            </div>
          </div>

          <div style="padding:18px 24px 24px 24px;border-top:1px solid #f3f4f6;">
            <p style="margin:0;color:#9ca3af;font-size:12px;">You received this email because you created a Markivo account.</p>
          </div>
        </div>
      </div>
    `,
  });

  emailLogger.info({ recipient: email, template: "welcome" }, "Email sent");
}

export async function sendOrderPlacedInvoiceEmail(
  payload: OrderPlacedInvoiceEmailPayload,
) {
  const rowsHtml = payload.items
    .map(
      (item) => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${item.productName}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${item.quantity}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${formatCurrency(item.unitPrice)}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${formatCurrency(item.lineTotal)}</td>
        </tr>
      `,
    )
    .join("");

  await sendEmail({
    to: payload.customerEmail,
    subject: `Invoice for Order ${payload.orderId}`,
    html: `
      <div style="background:#f3f4f6;padding:32px 16px;font-family:Arial,sans-serif;color:#111827;">
        <div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,0.08);">
          <div style="padding:22px 24px 0 24px;">
            ${logoBlock()}
          </div>

          <div style="padding:18px 24px;">
            <p style="margin:0 0 10px 0;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Order Invoice</p>
            <h1 style="margin:0 0 6px 0;font-size:26px;color:#111827;">Thanks, ${payload.customerName}.</h1>
            <p style="margin:0;color:#4b5563;">Your order has been confirmed. Here is your invoice.</p>

            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;margin:18px 0;">
              <table style="width:100%;border-collapse:collapse;font-size:14px;color:#111827;">
                <tr>
                  <td style="padding:4px 0;color:#6b7280;">Order ID</td>
                  <td style="padding:4px 0;text-align:right;font-weight:600;">${payload.orderId}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0;color:#6b7280;">Order Date</td>
                  <td style="padding:4px 0;text-align:right;font-weight:600;">${payload.orderDate}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0;color:#6b7280;">Vendor</td>
                  <td style="padding:4px 0;text-align:right;font-weight:600;">${payload.vendorName}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0;color:#6b7280;">Payment Ref</td>
                  <td style="padding:4px 0;text-align:right;font-weight:600;">${payload.paymentReference}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0;color:#6b7280;">Shipping</td>
                  <td style="padding:4px 0;text-align:right;font-weight:600;">${payload.shippingAddress}</td>
                </tr>
              </table>
            </div>

            <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
              <thead>
                <tr style="background:#111827;color:#ffffff;">
                  <th style="text-align:left;padding:12px;font-size:13px;letter-spacing:0.4px;">Product</th>
                  <th style="text-align:center;padding:12px;font-size:13px;letter-spacing:0.4px;">Qty</th>
                  <th style="text-align:right;padding:12px;font-size:13px;letter-spacing:0.4px;">Unit Price</th>
                  <th style="text-align:right;padding:12px;font-size:13px;letter-spacing:0.4px;">Line Total</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>

            <div style="margin-top:16px;text-align:right;">
              <p style="font-size:20px;margin:0;color:#e10600;"><strong>Total: ${formatCurrency(payload.totalAmount)}</strong></p>
            </div>
          </div>

          <div style="padding:18px 24px 24px 24px;border-top:1px solid #f3f4f6;">
            <p style="margin:0;color:#9ca3af;font-size:12px;">This invoice was sent by Markivo.</p>
          </div>
        </div>
      </div>
    `,
  });

  emailLogger.info(
    {
      recipient: payload.customerEmail,
      template: "order-invoice",
      orderId: payload.orderId,
    },
    "Email sent",
  );
}

export async function sendOrderDeliveredEmail(
  payload: OrderDeliveredEmailPayload,
) {
  const helpLink = payload.helpUrl || "#";
  const feedbackLink = payload.feedbackUrl || "#";

  await sendEmail({
    to: payload.customerEmail,
    subject: `Your order ${payload.orderId} has been delivered`,
    html: `
      <div style="background:#f3f4f6;padding:32px 16px;font-family:Arial,sans-serif;color:#111827;">
        <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,0.08);">
          <div style="padding:22px 24px 0 24px;">
            ${logoBlock()}
          </div>

          <div style="padding:18px 24px;">
            <p style="margin:0 0 10px 0;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Delivery Confirmation</p>
            <h1 style="margin:0 0 6px 0;font-size:26px;color:#111827;">Your order is delivered.</h1>
            <p style="margin:0;color:#4b5563;">Hi ${payload.customerName}, we have successfully delivered your order from ${payload.vendorName}.</p>

            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;margin:18px 0;">
              <table style="width:100%;border-collapse:collapse;font-size:14px;color:#111827;">
                <tr>
                  <td style="padding:4px 0;color:#6b7280;">Order ID</td>
                  <td style="padding:4px 0;text-align:right;font-weight:600;">${payload.orderId}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0;color:#6b7280;">Delivered At</td>
                  <td style="padding:4px 0;text-align:right;font-weight:600;">${payload.deliveredAt}</td>
                </tr>
              </table>
            </div>

            <div style="background:#111827;border-radius:12px;padding:14px 16px;color:#ffffff;">
              <p style="margin:0 0 6px 0;font-weight:600;">Any issue with your delivery?</p>
              <p style="margin:0;color:#e5e7eb;font-size:14px;line-height:1.6;">
                If something is missing or damaged, please reach out to us or visit the help center.
              </p>
              <a href="${helpLink}" style="display:inline-block;margin-top:10px;background:#e10600;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:8px;font-size:14px;">Visit Help Center</a>
            </div>

            <div style="margin-top:18px;padding:14px 16px;border:1px solid #e5e7eb;border-radius:12px;">
              <p style="margin:0 0 6px 0;font-weight:600;color:#111827;">Share your feedback</p>
              <p style="margin:0;color:#4b5563;font-size:14px;line-height:1.6;">Rate your experience with Markivo and the products you received.</p>
              <a href="${feedbackLink}" style="display:inline-block;margin-top:10px;background:#111827;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:8px;font-size:14px;">Leave a rating</a>
            </div>
          </div>

          <div style="padding:18px 24px 24px 24px;border-top:1px solid #f3f4f6;">
            <p style="margin:0;color:#9ca3af;font-size:12px;">Thank you for shopping with Markivo.</p>
          </div>
        </div>
      </div>
    `,
  });

  emailLogger.info(
    {
      recipient: payload.customerEmail,
      template: "order-delivered",
      orderId: payload.orderId,
    },
    "Email sent",
  );
}
