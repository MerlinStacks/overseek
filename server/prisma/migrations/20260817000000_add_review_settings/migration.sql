ALTER TABLE "Account"
ADD COLUMN "reviewShowCountryFlags" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "reviewerNameDisplay" TEXT NOT NULL DEFAULT 'full',
ADD COLUMN "reviewShowTransparencyBadge" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "reviewShowVerifiedCountBadge" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "reviewModerationMode" TEXT NOT NULL DEFAULT 'hold_all',
ADD COLUMN "reviewModerationThreshold" INTEGER NOT NULL DEFAULT 4;

-- Existing accounts previously submitted all OverSeek reviews as pending.
-- Keep that behaviour for upgraded accounts while new accounts use the
-- Prisma schema default of normal WordPress moderation.
ALTER TABLE "Account"
ALTER COLUMN "reviewModerationMode" SET DEFAULT 'auto_publish';

ALTER TABLE "Account"
ADD CONSTRAINT "Account_reviewerNameDisplay_check"
CHECK ("reviewerNameDisplay" IN ('full', 'first_initial_last', 'initials', 'first_last_initial'));

ALTER TABLE "Account"
ADD CONSTRAINT "Account_reviewModerationMode_check"
CHECK ("reviewModerationMode" IN ('auto_publish', 'hold_all', 'hold_below')),
ADD CONSTRAINT "Account_reviewModerationThreshold_check"
CHECK ("reviewModerationThreshold" BETWEEN 1 AND 5);
