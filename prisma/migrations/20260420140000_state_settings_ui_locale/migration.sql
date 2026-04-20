-- Official UI locale for the State (SSR default before cookie / Accept-Language).
ALTER TABLE "StateSettings" ADD COLUMN "uiLocale" TEXT;
