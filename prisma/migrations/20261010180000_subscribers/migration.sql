CREATE TYPE "SubscriberStatus" AS ENUM ('PENDING', 'CONFIRMED', 'UNSUBSCRIBED');

CREATE TABLE "Subscriber" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "company" TEXT,
    "status" "SubscriberStatus" NOT NULL DEFAULT 'PENDING',
    "consentText" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "confirmTokenHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "contactId" TEXT,
    CONSTRAINT "Subscriber_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Subscriber_organizationId_email_key" ON "Subscriber"("organizationId", "email");
CREATE INDEX "Subscriber_confirmTokenHash_idx" ON "Subscriber"("confirmTokenHash");

ALTER TABLE "Subscriber" ADD CONSTRAINT "Subscriber_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
