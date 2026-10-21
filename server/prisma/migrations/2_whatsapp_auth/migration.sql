-- WhatsApp Web session storage (persists the QR login across restarts/redeploys).
CREATE TABLE "WhatsAppAuth" (
    "id" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppAuth_pkey" PRIMARY KEY ("id")
);

-- Keep the public Supabase API locked out (the app connects as the table owner).
ALTER TABLE "WhatsAppAuth" ENABLE ROW LEVEL SECURITY;
