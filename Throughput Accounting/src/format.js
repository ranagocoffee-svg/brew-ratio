"use strict";

const numberFmt = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const pctFmt = new Intl.NumberFormat("ko-KR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const ratioFmt = new Intl.NumberFormat("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function money(v) {
  if (v === null || v === undefined) return "-";
  return numberFmt.format(Math.round(v));
}

function pct(v) {
  if (v === null || v === undefined) return "-";
  return pctFmt.format(v);
}

function ratio(v) {
  if (v === null || v === undefined) return "-";
  return ratioFmt.format(v);
}

function row(label, ...values) {
  return `  ${label.padEnd(28)} ${values.join("  ")}`;
}

module.exports = { money, pct, ratio, row };
