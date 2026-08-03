-- CreateIndex
CREATE INDEX "Event_startsAt_idx" ON "Event"("startsAt");

ALTER TABLE "Event"
    ADD CONSTRAINT "event_capacity_positive"     CHECK ("capacity" > 0),
    ADD CONSTRAINT "event_available_non_negative" CHECK ("availableSeats" >= 0),
    ADD CONSTRAINT "event_available_lte_capacity" CHECK ("availableSeats" <= "capacity");