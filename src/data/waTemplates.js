// ---------------------------------------------------------------------------
// Catalog of 50 ready-to-use WhatsApp message templates across categories.
// Clients pick one instead of writing from scratch; the exact body is what they
// submit to Meta for approval. {{1}}, {{2}}… are WhatsApp body variables.
// metaCategory must be one of: MARKETING | UTILITY | AUTHENTICATION
// ---------------------------------------------------------------------------

const build = (category, metaCategory, items) =>
  items.map((it) => ({
    ...it,
    category,
    metaCategory,
    language: "en_US",
    variables: (it.body.match(/\{\{\d+\}\}/g) || []).length,
  }));

export const WA_TEMPLATE_CATALOG = [
  ...build("Authentication", "AUTHENTICATION", [
    { name: "otp_login_code", body: "{{1}} is your verification code. For your security, do not share this code.", sample: ["123456"] },
    { name: "otp_signup_code", body: "Welcome! Your sign-up code is {{1}}. It expires in 10 minutes.", sample: ["482190"] },
    { name: "otp_password_reset", body: "Your password reset code is {{1}}. If you didn't request this, ignore this message.", sample: ["903211"] },
    { name: "otp_transaction", body: "Use {{1}} to authorize your transaction of {{2}}. Do not share this code.", sample: ["774120", "₹4,999"] },
    { name: "two_factor_code", body: "{{1}} is your two-factor authentication code.", sample: ["558743"] },
  ]),
  ...build("Marketing", "MARKETING", [
    { name: "sale_announcement", body: "Hi {{1}}, our biggest sale is live! Enjoy up to {{2}} off. Shop now before it ends.", sample: ["Jane", "50%"] },
    { name: "flash_sale_24h", body: "⚡ Flash sale, {{1}}! {{2}} off for the next 24 hours only. Don't miss out.", sample: ["Ravi", "30%"] },
    { name: "new_arrival", body: "Hi {{1}}, fresh arrivals just dropped 🎉 Be the first to explore the new {{2}} collection.", sample: ["Asha", "Summer"] },
    { name: "discount_code", body: "Here's a gift, {{1}}! Use code {{2}} for {{3}} off your next order.", sample: ["Sam", "SAVE20", "20%"] },
    { name: "abandoned_cart", body: "Hi {{1}}, you left {{2}} in your cart. Complete your order now before it sells out!", sample: ["Mia", "2 items"] },
    { name: "festival_offer", body: "Happy {{1}}, {{2}}! Celebrate with {{3}} off everything. Wishing you joy & savings.", sample: ["Diwali", "Neha", "40%"] },
    { name: "loyalty_reward", body: "{{1}}, you've earned {{2}} loyalty points! Redeem them on your next purchase.", sample: ["Arjun", "500"] },
    { name: "referral_invite", body: "Hi {{1}}, refer a friend and you both get {{2}}. Share your link today!", sample: ["Kiran", "₹200"] },
    { name: "webinar_invite", body: "Hi {{1}}, join our free webinar on {{2}} this {{3}}. Reserve your spot now.", sample: ["Dev", "Growth Marketing", "Friday"] },
    { name: "product_launch", body: "Big news, {{1}}! We just launched {{2}}. Take a look and tell us what you think.", sample: ["Ria", "textPanda Pro"] },
    { name: "re_engagement", body: "We miss you, {{1}}! Here's {{2}} off to welcome you back.", sample: ["Omar", "25%"] },
    { name: "newsletter_update", body: "Hi {{1}}, here's what's new this {{2}}: exclusive deals, tips, and more inside.", sample: ["Lia", "week"] },
  ]),
  ...build("Orders & Shipping", "UTILITY", [
    { name: "order_confirmed", body: "Hi {{1}}, your order {{2}} is confirmed! Total: {{3}}. We'll notify you when it ships.", sample: ["Jane", "#10245", "₹1,299"] },
    { name: "order_shipped", body: "Good news {{1}}! Order {{2}} has shipped. Track it here: {{3}}", sample: ["Ravi", "#10245", "bit.ly/trk"] },
    { name: "out_for_delivery", body: "{{1}}, your order {{2}} is out for delivery and arrives today. Please keep your phone reachable.", sample: ["Asha", "#10245"] },
    { name: "order_delivered", body: "Delivered! {{1}}, your order {{2}} has arrived. Enjoy — and tell us how we did.", sample: ["Sam", "#10245"] },
    { name: "order_delayed", body: "Hi {{1}}, your order {{2}} is delayed and now expected by {{3}}. We're sorry for the wait.", sample: ["Mia", "#10245", "Jun 28"] },
    { name: "return_initiated", body: "{{1}}, your return for {{2}} is initiated. Pickup is scheduled for {{3}}.", sample: ["Neha", "#10245", "tomorrow"] },
    { name: "refund_processed", body: "Hi {{1}}, your refund of {{2}} for order {{3}} has been processed.", sample: ["Arjun", "₹1,299", "#10245"] },
    { name: "cod_confirmation", body: "Hi {{1}}, please confirm your cash-on-delivery order {{2}} of {{3}} by replying YES.", sample: ["Kiran", "#10245", "₹999"] },
  ]),
  ...build("Appointments", "UTILITY", [
    { name: "appointment_confirmed", body: "Hi {{1}}, your appointment on {{2}} at {{3}} is confirmed. See you then!", sample: ["Jane", "Jun 30", "4:00 PM"] },
    { name: "appointment_reminder", body: "Reminder: {{1}}, you have an appointment on {{2}} at {{3}}. Reply C to cancel.", sample: ["Ravi", "Jun 30", "4:00 PM"] },
    { name: "appointment_reschedule", body: "Hi {{1}}, your appointment has been moved to {{2}} at {{3}}. Reply OK to confirm.", sample: ["Asha", "Jul 2", "11:00 AM"] },
    { name: "appointment_cancelled", body: "Hi {{1}}, your appointment on {{2}} has been cancelled. Book again anytime.", sample: ["Sam", "Jun 30"] },
    { name: "appointment_followup", body: "Hi {{1}}, thanks for visiting on {{2}}. Here are your follow-up notes and next steps.", sample: ["Mia", "Jun 30"] },
    { name: "appointment_feedback", body: "Hi {{1}}, how was your appointment with {{2}}? Your feedback helps us improve.", sample: ["Neha", "Dr. Rao"] },
  ]),
  ...build("Payments & Billing", "UTILITY", [
    { name: "invoice_issued", body: "Hi {{1}}, invoice {{2}} for {{3}} is ready. Due by {{4}}.", sample: ["Jane", "INV-901", "₹4,999", "Jul 5"] },
    { name: "payment_received", body: "Thank you {{1}}! We've received your payment of {{2}} for {{3}}.", sample: ["Ravi", "₹4,999", "INV-901"] },
    { name: "payment_reminder", body: "Hi {{1}}, a friendly reminder: {{2}} for {{3}} is due on {{4}}.", sample: ["Asha", "₹4,999", "INV-901", "Jul 5"] },
    { name: "payment_failed", body: "Hi {{1}}, your payment of {{2}} for {{3}} failed. Please update your payment method.", sample: ["Sam", "₹4,999", "INV-901"] },
    { name: "subscription_renewal", body: "Hi {{1}}, your {{2}} subscription renews on {{3}} for {{4}}.", sample: ["Mia", "Growth", "Jul 10", "₹99"] },
    { name: "low_balance_alert", body: "Hi {{1}}, your balance is low ({{2}}). Top up to avoid service interruption.", sample: ["Neha", "₹50"] },
  ]),
  ...build("Account", "UTILITY", [
    { name: "welcome_message", body: "Welcome to {{1}}, {{2}}! We're thrilled to have you. Reply HELP anytime.", sample: ["textPanda", "Jane"] },
    { name: "profile_updated", body: "Hi {{1}}, your profile was updated successfully on {{2}}.", sample: ["Ravi", "Jun 26"] },
    { name: "password_changed", body: "Hi {{1}}, your password was changed. If this wasn't you, contact support immediately.", sample: ["Asha"] },
    { name: "account_verification", body: "Hi {{1}}, please verify your account to unlock all features. It takes under a minute.", sample: ["Sam"] },
    { name: "plan_upgraded", body: "Nice, {{1}}! You're now on the {{2}} plan with {{3}}. Enjoy the new limits.", sample: ["Mia", "Scale", "100k msgs/mo"] },
  ]),
  ...build("Support", "UTILITY", [
    { name: "ticket_created", body: "Hi {{1}}, we've received your request. Your ticket number is {{2}}. We'll be in touch soon.", sample: ["Jane", "#T-552"] },
    { name: "ticket_resolved", body: "Hi {{1}}, your ticket {{2}} has been resolved. Reply if you need anything else.", sample: ["Ravi", "#T-552"] },
    { name: "agent_reply", body: "Hi {{1}}, {{2}} from support here regarding {{3}}. How can I help further?", sample: ["Asha", "Sara", "#T-552"] },
    { name: "csat_survey", body: "Hi {{1}}, how would you rate your support experience today? Reply 1-5 (5 = excellent).", sample: ["Sam"] },
  ]),
  ...build("Travel & Logistics", "UTILITY", [
    { name: "booking_ticket", body: "Hi {{1}}, your booking {{2}} is confirmed for {{3}}. Show this message at check-in.", sample: ["Jane", "BK-2210", "Jul 4"] },
    { name: "checkin_reminder", body: "Hi {{1}}, check-in for {{2}} opens now. Complete it to save time at the counter.", sample: ["Ravi", "Flight AI-202"] },
    { name: "trip_status_update", body: "Update {{1}}: your {{2}} is now {{3}}. Track live updates anytime.", sample: ["Asha", "shipment", "in transit"] },
    { name: "itinerary_share", body: "Hi {{1}}, here's your itinerary for {{2}}. Have a great trip!", sample: ["Sam", "Goa, Jul 4-7"] },
  ]),
];

export const WA_CATEGORIES = [...new Set(WA_TEMPLATE_CATALOG.map((t) => t.category))];
export const findCatalogTemplate = (name) => WA_TEMPLATE_CATALOG.find((t) => t.name === name);
