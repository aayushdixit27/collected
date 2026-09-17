// Overage arithmetic shared by the API and the seed. Deliberately tiny and pure: no record
// shape, no I/O. overLb is whatever exceeds the stop's included weight; charge is that
// overage priced by the ton, rounded to the cent the way a bill would be.
export function overage({ netLb, includedLb, ratePerTon }) {
  const overLb = Math.max(0, netLb - includedLb);
  const charge = Math.round((overLb / 2000) * ratePerTon * 100) / 100;
  return { overLb, charge };
}
