import { Resend } from "resend";
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

const resend = new Resend(env.RESEND_API_KEY);

const formatCurrency = (amount: number) => `Rs. ${amount.toFixed(2)}`;

const logoBlock = () => {
  if (env.MARKETFLOW_LOGO_URL) {
    return `<img src="${env.MARKETFLOW_LOGO_URL}" alt="MarketFlow" style="height:40px;max-width:180px;object-fit:contain;display:block;" />`;
  }

  return `<div style="display:inline-block;background:#ffffff;color:#e10600;border:2px solid #111111;border-radius:8px;padding:8px 14px;font-size:28px;font-weight:800;line-height:1;letter-spacing:0.5px;">MarketFlow</div>`;
};

async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}) {
  const { error } = await resend.emails.send({
    from: env.RESEND_FROM_EMAIL,
    to: params.to || "2023002327.gcet@cvmu.edu.in",
    subject: params.subject,
    html: params.html,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}

export async function sendWelcomeEmail({ name, email }: WelcomeEmailPayload) {
  await sendEmail({
    to: email,
    subject: "Welcome to MarketFlow",
    html: `
      <div style="background:#f5f5f5;padding:28px 16px;font-family:Arial,sans-serif;color:#111111;">
        <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #d5d5d5;border-radius:14px;overflow:hidden;">
          <div style="background:#e10600;padding:20px 24px;border-bottom:4px solid #111111;">
            ${logoBlock()}
          </div>

          <div style="padding:26px 24px;">
            <h1 style="margin:0 0 10px 0;font-size:28px;line-height:1.2;color:#111111;">Welcome to MarketFlow, ${name}</h1>
            <p style="margin:0 0 18px 0;color:#3f3f46;font-size:16px;line-height:1.5;">
              Your account is ready. Discover trusted products from local sellers and place your first order in minutes.
            </p>

            <div style="background:#111111;border-left:4px solid #e10600;border-radius:8px;padding:14px 16px;color:#ffffff;">
              <p style="margin:0;font-size:14px;line-height:1.5;">
                Need help? Reply to this email and our support team will assist you.
              </p>
            </div>

            <p style="margin:20px 0 0 0;color:#71717a;font-size:13px;">This is an automated email from MarketFlow.</p>
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
      <div style="background:#f5f5f5;padding:28px 16px;font-family:Arial,sans-serif;color:#111111;">
        <div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #d5d5d5;border-radius:14px;overflow:hidden;">
          <div style="background:#e10600;padding:20px 24px;border-bottom:4px solid #111111;">
            ${logoBlock()}
          </div>

          <div style="padding:22px 24px;">
            <h1 style="margin:0 0 6px 0;font-size:26px;color:#111111;">Order Invoice</h1>
            <p style="margin:0;color:#3f3f46;">Thank you for your purchase, ${payload.customerName}.</p>

            <div style="background:#ffffff;border:1px solid #111111;border-radius:10px;padding:12px;margin:18px 0;">
              <p style="margin:4px 0;"><strong>Order ID:</strong> ${payload.orderId}</p>
              <p style="margin:4px 0;"><strong>Order Date:</strong> ${payload.orderDate}</p>
              <p style="margin:4px 0;"><strong>Vendor:</strong> ${payload.vendorName}</p>
              <p style="margin:4px 0;"><strong>Payment Ref:</strong> ${payload.paymentReference}</p>
              <p style="margin:4px 0;"><strong>Shipping Address:</strong> ${payload.shippingAddress}</p>
            </div>

            <table style="width:100%;border-collapse:collapse;border:1px solid #111111;">
              <thead>
                <tr style="background:#111111;color:#ffffff;">
                  <th style="text-align:left;padding:10px;">Product</th>
                  <th style="text-align:center;padding:10px;">Qty</th>
                  <th style="text-align:right;padding:10px;">Unit Price</th>
                  <th style="text-align:right;padding:10px;">Line Total</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>

            <div style="margin-top:16px;text-align:right;">
              <p style="font-size:20px;margin:0;color:#e10600;"><strong>Total: ${formatCurrency(payload.totalAmount)}</strong></p>
            </div>

            <p style="margin:16px 0 0 0;color:#71717a;font-size:13px;">This invoice was sent by MarketFlow.</p>
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
