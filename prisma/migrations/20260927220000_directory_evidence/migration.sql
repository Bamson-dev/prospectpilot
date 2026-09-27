-- Directory listings can be stored before a company website is known.
ALTER TABLE "DiscoverySource" ALTER COLUMN "prospectId" DROP NOT NULL;
