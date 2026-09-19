import { describe, expect, it } from "vitest";
import { currentWeek, formatDateTimeBr, parseIsoDate, resolvePeriod, startOfDayUtc } from "@/lib/dates";

// 19/09/2026 (sábado) 14:32 em Brasília = 17:32 UTC
const NOW = new Date("2026-09-19T17:32:00Z");

describe("datas no fuso da loja (America/Sao_Paulo)", () => {
  it("início do dia em Brasília é 03:00 UTC", () => {
    expect(startOfDayUtc(2026, 9, 19).toISOString()).toBe("2026-09-19T03:00:00.000Z");
  });

  it("'hoje' vai de 00:00 a 00:00 de Brasília, mesmo com o servidor em UTC", () => {
    const r = resolvePeriod("hoje", { now: NOW });
    expect(r.from.toISOString()).toBe("2026-09-19T03:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-09-20T03:00:00.000Z");
  });

  it("22h30 de Brasília (01:30 UTC do dia seguinte) ainda é 'hoje' de Brasília", () => {
    const lateNight = new Date("2026-09-20T01:30:00Z"); // 19/09 22:30 BRT
    const r = resolvePeriod("hoje", { now: lateNight });
    expect(r.from.toISOString()).toBe("2026-09-19T03:00:00.000Z");
    expect(lateNight >= r.from && lateNight < r.to).toBe(true);
  });

  it("ontem, 7 dias, 30 dias e mês atual", () => {
    expect(resolvePeriod("ontem", { now: NOW }).from.toISOString()).toBe("2026-09-18T03:00:00.000Z");
    expect(resolvePeriod("ontem", { now: NOW }).to.toISOString()).toBe("2026-09-19T03:00:00.000Z");
    expect(resolvePeriod("7d", { now: NOW }).from.toISOString()).toBe("2026-09-13T03:00:00.000Z"); // hoje + 6 dias antes
    expect(resolvePeriod("30d", { now: NOW }).from.toISOString()).toBe("2026-08-21T03:00:00.000Z");
    const mes = resolvePeriod("mes", { now: NOW });
    expect(mes.from.toISOString()).toBe("2026-09-01T03:00:00.000Z");
    expect(mes.to.toISOString()).toBe("2026-10-01T03:00:00.000Z");
  });

  it("virada de ano", () => {
    const dec = new Date("2026-12-31T20:00:00Z");
    expect(resolvePeriod("mes", { now: dec }).to.toISOString()).toBe("2027-01-01T03:00:00.000Z");
  });

  it("período personalizado é inclusivo nas duas pontas; inválido cai no mês atual", () => {
    const r = resolvePeriod("custom", { now: NOW, from: "2026-09-10", to: "2026-09-12" });
    expect(r.from.toISOString()).toBe("2026-09-10T03:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-09-13T03:00:00.000Z");
    expect(resolvePeriod("custom", { now: NOW, from: "lixo", to: "2026-09-12" }).label).toBe("Mês atual");
    expect(resolvePeriod("custom", { now: NOW, from: "2026-09-12", to: "2026-09-10" }).label).toBe("Mês atual"); // invertido
  });

  it("semana vai de segunda a domingo", () => {
    const w = currentWeek(NOW); // sábado 19/09 → segunda 14/09
    expect(w.from.toISOString()).toBe("2026-09-14T03:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-09-21T03:00:00.000Z");
    const monday = currentWeek(new Date("2026-09-14T15:00:00Z"));
    expect(monday.from.toISOString()).toBe("2026-09-14T03:00:00.000Z");
  });

  it("formata data e hora como no Telegram do CEO", () => {
    expect(formatDateTimeBr(NOW)).toBe("19/09/2026 às 14:32");
    expect(formatDateTimeBr("2026-09-20T01:30:00Z")).toBe("19/09/2026 às 22:30");
  });

  it("rejeita datas impossíveis", () => {
    expect(parseIsoDate("2026-02-30")).toBeNull();
    expect(parseIsoDate("2026-13-01")).toBeNull();
    expect(parseIsoDate("2026-09-19")).toEqual({ year: 2026, month: 9, day: 19 });
  });
});
