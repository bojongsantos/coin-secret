import { handlePaymentNotification } from "@/infrastructure/billing/notification-handler";

export async function POST(request: Request) {
  return handlePaymentNotification(request, "nowpayments-sandbox");
}
