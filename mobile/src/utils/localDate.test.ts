import { APP_TIMEZONE, formatScanResetAtIST, istDateFromWallClock } from "./localDate";

describe("formatScanResetAtIST", () => {
  it("formats reset time in IST without duplicating the timezone label", () => {
    // 2026-08-28 18:30 UTC -> 2026-08-29 00:00 IST
    const label = formatScanResetAtIST("2026-08-28T18:30:00.000Z");
    expect(label).not.toMatch(/IST/i);
    expect(label).toMatch(/12:00/);
  });

  it("uses the app IST timezone constant", () => {
    expect(APP_TIMEZONE).toBe("Asia/Kolkata");
  });
});

describe("istDateFromWallClock", () => {
  it("maps plan wall-clock time to the correct absolute instant in IST", () => {
    const date = istDateFromWallClock(2026, 8, 29, 9, 0);
    expect(date.toISOString()).toBe("2026-08-29T03:30:00.000Z");
  });
});
